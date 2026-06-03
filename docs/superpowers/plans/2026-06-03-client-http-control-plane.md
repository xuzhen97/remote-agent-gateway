# Client HTTP Control Plane Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace server-dispatched task execution with direct client HTTP/SSE operation endpoints exposed through one sticky FRP control tunnel per client, and rebuild the admin UI with React + Ant Design.

**Architecture:** WebSocket remains the control plane for registration, heartbeat, and configuration coordination. Client HTTP becomes the data/operation plane for jobs, SSE, files, and mapping management. Server provides discovery, sticky port allocation, token coordination, and lightweight admin JSON orchestration without proxying files or SSE streams.

**Tech Stack:** TypeScript, Node.js 22, Fastify, native Node HTTP/SSE on client, sql.js SQLite, Vitest, pnpm workspace, React, Vite, Ant Design.

---

## Scope Check

This plan intentionally covers the full architecture migration because the pieces must interoperate before the product is usable:

- Shared protocol and schemas.
- Server DB/config/coordinator/discovery APIs.
- Client HTTP service, jobs/SSE/files/mapping APIs.
- FRPC single-daemon protected control mapping.
- Removal of formal task execution routes.
- React admin UI rebuild.

Implement task-by-task with a commit after every task. Do not batch backend and frontend changes in one commit.

---

## File Structure

### Shared package

- Modify `packages/shared/src/types.ts`: add client HTTP metadata, capabilities, job and client mapping types; keep old task types only until task-removal task.
- Modify `packages/shared/src/protocol.ts`: add `client.http_ready`, `client.http_failed`, and `httpControl` ack typing.
- Modify `packages/shared/src/schemas.ts`: add schemas for register HTTP metadata, ready/failed payloads, jobs, files, and client FRP mapping requests.
- Modify `packages/shared/src/__tests__/schemas.test.ts`: schema coverage for new protocol.

### Server

- Modify `apps/server/src/config/server.config.ts`: parse `clientHttp` config.
- Modify `apps/server/src/config/env.ts`: expose `CLIENT_HTTP_*` env constants and build HTTP public URL helper.
- Modify `apps/server/src/db/migrate.ts`: add idempotent migrations for new client and mapping columns.
- Create `apps/server/src/modules/client-http/client-http-token.service.ts`: HMAC token derivation.
- Create `apps/server/src/modules/client-http/client-http-coordinator.service.ts`: sticky remote-port coordination.
- Create `apps/server/src/modules/client-http/client-http-admin.service.ts`: short JSON calls from server to client HTTP for admin UI.
- Create `apps/server/src/modules/client-http/client-http-admin.routes.ts`: admin management endpoints.
- Modify `apps/server/src/modules/clients/clients.service.ts`: persist and serialize HTTP endpoint fields.
- Modify `apps/server/src/modules/clients/clients.routes.ts`: return discovery fields and remove frpc task routes.
- Modify `apps/server/src/modules/frp/frp.service.ts`: support business mapping metadata columns and admin-created records.
- Modify `apps/server/src/modules/ports/port-allocator.service.ts`: include `clients.http_remote_port` in occupied-port checks.
- Modify `apps/server/src/ws/ws-handlers.ts`: coordinate HTTP endpoint on register; handle ready/failed; stop task messages as formal flow.
- Modify `apps/server/src/main.ts`: register client HTTP admin routes; stop registering formal task/agent operation routes after migration task.

### Client

- Modify `apps/client/src/config/client.config.ts`: parse `http` job config.
- Create `apps/client/src/runtime/control-http/types.ts`: local control HTTP shared types.
- Create `apps/client/src/runtime/control-http/response.ts`: JSON/SSE response helpers.
- Create `apps/client/src/runtime/control-http/auth.ts`: bearer-token middleware for native HTTP.
- Create `apps/client/src/runtime/control-http/router.ts`: simple native HTTP router.
- Create `apps/client/src/runtime/control-http/job-manager.ts`: async command/script job manager.
- Create `apps/client/src/runtime/control-http/job-routes.ts`: job REST + SSE routes.
- Create `apps/client/src/runtime/control-http/file-routes.ts`: direct file routes using allowed roots.
- Create `apps/client/src/runtime/control-http/frp-mapping-store.ts`: local business mapping persistence.
- Create `apps/client/src/runtime/control-http/frp-routes.ts`: client mapping management endpoints.
- Create `apps/client/src/runtime/control-http/server.ts`: start/stop control HTTP server.
- Modify `apps/client/src/runtime/frpc-daemon.ts`: accept protected system mapping plus business mappings and still manage one process.
- Modify `apps/client/src/core/register.ts`: include HTTP metadata and capabilities.
- Modify `apps/client/src/main.ts`: start local HTTP server before registration; apply `server.ack.httpControl`; start protected control tunnel; send ready/failed.

### React admin UI

- Create `apps/web/package.json`.
- Create `apps/web/tsconfig.json`.
- Create `apps/web/index.html`.
- Create `apps/web/vite.config.ts`.
- Create `apps/web/src/main.tsx`.
- Create `apps/web/src/App.tsx`.
- Create `apps/web/src/api/http.ts`.
- Create `apps/web/src/api/clients.ts`.
- Create `apps/web/src/api/adminClientHttp.ts`.
- Create `apps/web/src/components/AppLayout.tsx`.
- Create `apps/web/src/components/StatusTag.tsx`.
- Create `apps/web/src/components/TokenLogin.tsx`.
- Create `apps/web/src/pages/DashboardPage.tsx`.
- Create `apps/web/src/pages/ClientsPage.tsx`.
- Create `apps/web/src/pages/ClientDetailPage.tsx`.
- Create `apps/web/src/pages/MappingsPage.tsx`.
- Create `apps/web/src/styles/theme.css`.
- Modify `scripts/build-all.ts`: build and copy `apps/web/dist` to `dist/web`.
- Modify `apps/server/src/main.ts`: serve built React assets and SPA fallback.
- Replace `apps/server/src/web/index.html` with a small fallback or remove it after build integration works.

### Docs and tests

- Modify `README.md`: document new discovery and direct client HTTP/SSE flow.
- Modify `server.config.example.yaml`: add `clientHttp` defaults.
- Modify `client.config.example.yaml`: add `http` defaults.
- Modify `scripts/e2e-test.ts`: verify discovery, direct job, SSE, file API, and mapping API.

---

## Task 1: Shared Protocol and Schema Foundation

**Files:**
- Modify: `packages/shared/src/types.ts`
- Modify: `packages/shared/src/protocol.ts`
- Modify: `packages/shared/src/schemas.ts`
- Modify: `packages/shared/src/__tests__/schemas.test.ts`

- [ ] **Step 1: Write failing shared schema tests**

Add tests to `packages/shared/src/__tests__/schemas.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import {
  ClientHttpCapabilitiesSchema,
  ClientHttpInfoSchema,
  ClientHttpReadyPayloadSchema,
  ClientHttpFailedPayloadSchema,
  ClientRegisterPayloadSchema,
  ServerAckPayloadSchema,
  ClientJobCommandPayloadSchema,
  ClientJobScriptPayloadSchema,
  ClientFrpMappingCreatePayloadSchema,
} from '../schemas.js';

describe('client HTTP control schemas', () => {
  it('accepts registration with HTTP metadata and capabilities', () => {
    const parsed = ClientRegisterPayloadSchema.parse({
      clientId: 'dev-client-01',
      name: 'Development Machine',
      http: { localHost: '127.0.0.1', localPort: 17890, protocol: 'http' },
      capabilities: { httpControl: true, jobs: true, sse: true, files: true, frpMappings: true },
    });

    expect(parsed.http?.localPort).toBe(17890);
    expect(parsed.capabilities?.sse).toBe(true);
  });

  it('validates server ack HTTP control payload', () => {
    const parsed = ServerAckPayloadSchema.parse({
      message: 'registered',
      frp: { serverAddr: 'frps.example.com', serverPort: 7000, authToken: 'frp-token' },
      httpControl: {
        localHost: '127.0.0.1',
        localPort: 17890,
        remotePort: 20317,
        publicBaseUrl: 'http://frps.example.com:20317',
        token: 'client-token',
      },
    });

    expect(parsed.httpControl?.remotePort).toBe(20317);
  });

  it('validates ready and failed payloads', () => {
    expect(ClientHttpReadyPayloadSchema.parse({
      clientId: 'dev-client-01',
      remotePort: 20317,
      baseUrl: 'http://frps.example.com:20317',
    }).remotePort).toBe(20317);

    expect(ClientHttpFailedPayloadSchema.parse({
      clientId: 'dev-client-01',
      remotePort: 20317,
      reason: 'frpc exited',
    }).reason).toContain('frpc');
  });

  it('validates job and mapping payloads', () => {
    expect(ClientJobCommandPayloadSchema.parse({ command: 'node', args: ['-v'] }).command).toBe('node');
    expect(ClientJobScriptPayloadSchema.parse({ runtime: 'node', script: 'console.log(1)' }).runtime).toBe('node');
    expect(ClientFrpMappingCreatePayloadSchema.parse({
      name: 'vite',
      type: 'tcp',
      localHost: '127.0.0.1',
      localPort: 5173,
    }).localPort).toBe(5173);
  });

  it('rejects invalid local ports', () => {
    expect(() => ClientHttpInfoSchema.parse({ localHost: '127.0.0.1', localPort: 70000, protocol: 'http' })).toThrow();
    expect(() => ClientHttpCapabilitiesSchema.parse({ httpControl: true, jobs: true, sse: true, files: true, frpMappings: true })).not.toThrow();
  });
});
```

- [ ] **Step 2: Run tests and confirm they fail**

Run:

```bash
pnpm --filter @rag/shared test -- --runInBand packages/shared/src/__tests__/schemas.test.ts
```

Expected: FAIL because the new exported schemas do not exist.

- [ ] **Step 3: Add shared types**

Add to `packages/shared/src/types.ts`:

```ts
export interface ClientHttpInfo {
  localHost: string;
  localPort: number;
  protocol: 'http';
}

export interface ClientHttpCapabilities {
  httpControl: boolean;
  jobs: boolean;
  sse: boolean;
  files: boolean;
  frpMappings: boolean;
}

export interface ClientHttpControl {
  localHost: string;
  localPort: number;
  remotePort: number;
  publicBaseUrl: string;
  token: string;
}

export interface ClientHttpReadyPayload {
  clientId: string;
  remotePort: number;
  baseUrl: string;
}

export interface ClientHttpFailedPayload {
  clientId: string;
  remotePort?: number;
  reason: string;
}

export type ClientJobStatus = 'queued' | 'running' | 'success' | 'failed' | 'cancelled';
export type ClientJobType = 'command' | 'script';

export interface ClientJobCommandPayload {
  command: string;
  args?: string[];
  cwd?: string;
  timeoutMs?: number;
  env?: Record<string, string>;
}

export interface ClientJobScriptPayload {
  runtime?: 'node' | 'python' | 'bash' | 'powershell';
  script: string;
  cwd?: string;
  timeoutMs?: number;
  env?: Record<string, string>;
}

export interface ClientJobLogEntry {
  seq: number;
  stream: 'stdout' | 'stderr';
  content: string;
  timestamp: number;
}

export interface ClientFrpMappingCreatePayload {
  name: string;
  type: 'tcp' | 'http' | 'https';
  localHost: string;
  localPort: number;
  remotePort?: number | null;
  customDomain?: string;
}
```

Extend `ClientInfo`:

```ts
export interface ClientInfo {
  clientId: string;
  name: string;
  hostname?: string;
  os?: string;
  arch?: string;
  version?: string;
  tags?: string[];
  http?: ClientHttpInfo;
  capabilities?: ClientHttpCapabilities;
}
```

- [ ] **Step 4: Add protocol message types**

Modify `packages/shared/src/protocol.ts`:

```ts
import type {
  ClientHttpFailedPayload,
  ClientHttpReadyPayload,
  ClientHttpControl,
  ClientInfo,
  TaskType,
  TaskStatus,
  TaskPayloadMap,
} from './types.js';

export type ClientMessageType =
  | 'client.register'
  | 'client.heartbeat'
  | 'client.http_ready'
  | 'client.http_failed'
  | 'task.log'
  | 'task.result';

export type ServerAckPayload = {
  message: string;
  frp?: { serverAddr: string; serverPort: number; authToken: string };
  httpControl?: ClientHttpControl;
};

export type ClientHttpReadyMessage = WsMessage<'client.http_ready', ClientHttpReadyPayload>;
export type ClientHttpFailedMessage = WsMessage<'client.http_failed', ClientHttpFailedPayload>;

export type ServerAckMessage = WsMessage<'server.ack', ServerAckPayload>;

export type ClientMessage =
  | ClientRegisterMessage
  | ClientHeartbeatMessage
  | ClientHttpReadyMessage
  | ClientHttpFailedMessage
  | TaskLogMessage
  | TaskResultMessage;
```

Keep task message types temporarily so the codebase compiles until Task 9 removes formal task routes.

- [ ] **Step 5: Add Zod schemas**

Add to `packages/shared/src/schemas.ts`:

```ts
export const ClientHttpInfoSchema = z.object({
  localHost: z.string().min(1).default('127.0.0.1'),
  localPort: z.number().int().min(1).max(65535),
  protocol: z.literal('http').default('http'),
});

export const ClientHttpCapabilitiesSchema = z.object({
  httpControl: z.boolean(),
  jobs: z.boolean(),
  sse: z.boolean(),
  files: z.boolean(),
  frpMappings: z.boolean(),
});

export const ClientHttpControlSchema = z.object({
  localHost: z.string().min(1),
  localPort: z.number().int().min(1).max(65535),
  remotePort: z.number().int().min(1).max(65535),
  publicBaseUrl: z.string().url(),
  token: z.string().min(16),
});

export const FrpConnectionInfoSchema = z.object({
  serverAddr: z.string().min(1),
  serverPort: z.number().int().min(1).max(65535),
  authToken: z.string().min(1),
});

export const ServerAckPayloadSchema = z.object({
  message: z.string().min(1),
  frp: FrpConnectionInfoSchema.optional(),
  httpControl: ClientHttpControlSchema.optional(),
});

export const ClientHttpReadyPayloadSchema = z.object({
  clientId: z.string().min(1),
  remotePort: z.number().int().min(1).max(65535),
  baseUrl: z.string().url(),
});

export const ClientHttpFailedPayloadSchema = z.object({
  clientId: z.string().min(1),
  remotePort: z.number().int().min(1).max(65535).optional(),
  reason: z.string().min(1),
});

export const ClientJobCommandPayloadSchema = z.object({
  command: z.string().min(1),
  args: z.array(z.string()).optional().default([]),
  cwd: z.string().optional(),
  timeoutMs: z.number().int().positive().max(1_800_000).optional(),
  env: z.record(z.string()).optional(),
});

export const ClientJobScriptPayloadSchema = z.object({
  runtime: z.enum(['node', 'python', 'bash', 'powershell']).optional().default('node'),
  script: z.string().min(1).max(1_000_000),
  cwd: z.string().optional(),
  timeoutMs: z.number().int().positive().max(1_800_000).optional(),
  env: z.record(z.string()).optional(),
});

export const ClientFrpMappingCreatePayloadSchema = z.object({
  name: z.string().min(1).max(128),
  type: z.enum(['tcp', 'http', 'https']),
  localHost: z.string().min(1).default('127.0.0.1'),
  localPort: z.number().int().min(1).max(65535),
  remotePort: z.number().int().min(1).max(65535).nullable().optional(),
  customDomain: z.string().optional(),
});
```

Update `ClientRegisterPayloadSchema`:

```ts
export const ClientRegisterPayloadSchema = z.object({
  clientId: z.string().min(1).max(64),
  name: z.string().min(1).max(128),
  hostname: z.string().optional(),
  os: z.string().optional(),
  arch: z.string().optional(),
  version: z.string().optional(),
  tags: z.array(z.string()).optional(),
  http: ClientHttpInfoSchema.optional(),
  capabilities: ClientHttpCapabilitiesSchema.optional(),
});
```

- [ ] **Step 6: Run shared tests and typecheck**

Run:

```bash
pnpm --filter @rag/shared test
pnpm --filter @rag/shared typecheck
```

Expected: all shared tests pass and typecheck exits 0.

- [ ] **Step 7: Commit**

```bash
git add packages/shared/src/types.ts packages/shared/src/protocol.ts packages/shared/src/schemas.ts packages/shared/src/__tests__/schemas.test.ts
git commit -m "feat(shared): add client http control protocol"
```

---

## Task 2: Server Config, DB Columns, Token Derivation, and Sticky Coordinator

**Files:**
- Modify: `apps/server/src/config/server.config.ts`
- Modify: `apps/server/src/config/env.ts`
- Modify: `apps/server/src/db/migrate.ts`
- Create: `apps/server/src/modules/client-http/client-http-token.service.ts`
- Create: `apps/server/src/modules/client-http/client-http-coordinator.service.ts`
- Modify: `apps/server/src/modules/ports/port-allocator.service.ts`
- Modify: `apps/server/src/modules/clients/clients.service.ts`
- Test: `apps/server/src/modules/client-http/client-http-token.service.test.ts`
- Test: `apps/server/src/modules/client-http/client-http-coordinator.service.test.ts`

- [ ] **Step 1: Write token service tests**

Create `apps/server/src/modules/client-http/client-http-token.service.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { deriveClientHttpToken } from './client-http-token.service.js';

describe('deriveClientHttpToken', () => {
  it('is stable for the same secret, version, and client id', () => {
    const a = deriveClientHttpToken({ tokenSecret: 'secret-a', tokenVersion: 1, clientId: 'client-1' });
    const b = deriveClientHttpToken({ tokenSecret: 'secret-a', tokenVersion: 1, clientId: 'client-1' });
    expect(a).toBe(b);
    expect(a.length).toBeGreaterThanOrEqual(43);
  });

  it('changes when tokenVersion changes', () => {
    const v1 = deriveClientHttpToken({ tokenSecret: 'secret-a', tokenVersion: 1, clientId: 'client-1' });
    const v2 = deriveClientHttpToken({ tokenSecret: 'secret-a', tokenVersion: 2, clientId: 'client-1' });
    expect(v1).not.toBe(v2);
  });
});
```

- [ ] **Step 2: Write coordinator tests**

Create `apps/server/src/modules/client-http/client-http-coordinator.service.test.ts`:

```ts
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ClientHttpCoordinatorService } from './client-http-coordinator.service.js';

function makeService(overrides: Partial<ConstructorParameters<typeof ClientHttpCoordinatorService>[0]> = {}) {
  const clients = new Map<string, any>();
  return new ClientHttpCoordinatorService({
    frpsPublicHost: 'frps.example.com',
    tokenSecret: 'secret',
    tokenVersion: 1,
    getClient: (clientId) => clients.get(clientId),
    updateClientHttp: (clientId, patch) => {
      const current = clients.get(clientId) ?? { id: clientId };
      clients.set(clientId, { ...current, ...patch });
    },
    isHttpPortAvailable: vi.fn(async (port, clientId) => port !== 20002),
    allocatePort: vi.fn(async () => 20003),
    ...overrides,
  });
}

describe('ClientHttpCoordinatorService', () => {
  it('allocates a new sticky HTTP endpoint for first registration', async () => {
    const allocatePort = vi.fn(async () => 20001);
    const service = makeService({ allocatePort });
    const result = await service.coordinate('client-1', { localHost: '127.0.0.1', localPort: 17890, protocol: 'http' });

    expect(result.remotePort).toBe(20001);
    expect(result.publicBaseUrl).toBe('http://frps.example.com:20001');
    expect(result.reused).toBe(false);
  });

  it('reuses historical port when available', async () => {
    const getClient = vi.fn(() => ({ id: 'client-1', http_remote_port: 20001 }));
    const service = makeService({ getClient, isHttpPortAvailable: vi.fn(async () => true) });
    const result = await service.coordinate('client-1', { localHost: '127.0.0.1', localPort: 17890, protocol: 'http' });

    expect(result.remotePort).toBe(20001);
    expect(result.reused).toBe(true);
  });

  it('reallocates when historical port conflicts', async () => {
    const getClient = vi.fn(() => ({ id: 'client-1', http_remote_port: 20002 }));
    const allocatePort = vi.fn(async () => 20004);
    const service = makeService({ getClient, isHttpPortAvailable: vi.fn(async () => false), allocatePort });
    const result = await service.coordinate('client-1', { localHost: '127.0.0.1', localPort: 17890, protocol: 'http' });

    expect(result.remotePort).toBe(20004);
    expect(result.reused).toBe(false);
  });
});
```

- [ ] **Step 3: Run tests and confirm they fail**

Run:

```bash
pnpm --filter @rag/server test -- apps/server/src/modules/client-http/client-http-token.service.test.ts apps/server/src/modules/client-http/client-http-coordinator.service.test.ts
```

Expected: FAIL because service files do not exist.

- [ ] **Step 4: Add server config and env fields**

In `apps/server/src/config/server.config.ts`, extend `ServerConfigSchema`:

```ts
clientHttp: z.object({
  tokenSecret: z.string().min(16).default('change-me-client-http-secret'),
  tokenVersion: z.coerce.number().int().positive().default(1),
  requestTimeoutMs: z.coerce.number().int().positive().default(10_000),
}).default({}),
```

In `apps/server/src/config/env.ts`, add constants:

```ts
CLIENT_HTTP_TOKEN_SECRET: serverConfig.clientHttp.tokenSecret,
CLIENT_HTTP_TOKEN_VERSION: serverConfig.clientHttp.tokenVersion,
CLIENT_HTTP_REQUEST_TIMEOUT_MS: serverConfig.clientHttp.requestTimeoutMs,
```

Add helper:

```ts
export function buildClientHttpPublicUrl(remotePort: number): string {
  const host = env.FRPS_PUBLIC_HOST || env.FRPS_HOST;
  if (!host) throw new Error('FRPS_PUBLIC_HOST or FRPS_HOST is required');
  return `http://${host}:${remotePort}`;
}
```

- [ ] **Step 5: Make DB migration idempotent**

Modify `apps/server/src/db/migrate.ts` after the existing `CREATE TABLE` block:

```ts
function addColumnIfMissing(db: Database, table: string, column: string, definition: string): void {
  const stmt = db.prepare(`PRAGMA table_info(${table})`);
  const columns = new Set<string>();
  while (stmt.step()) {
    const row = stmt.getAsObject() as { name: string };
    columns.add(row.name);
  }
  stmt.free();
  if (!columns.has(column)) db.run(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
}
```

At the end of `migrate(db)` call:

```ts
addColumnIfMissing(db, 'clients', 'http_local_host', 'TEXT');
addColumnIfMissing(db, 'clients', 'http_local_port', 'INTEGER');
addColumnIfMissing(db, 'clients', 'http_remote_port', 'INTEGER');
addColumnIfMissing(db, 'clients', 'http_base_url', 'TEXT');
addColumnIfMissing(db, 'clients', 'http_token', 'TEXT');
addColumnIfMissing(db, 'clients', 'http_ready', 'INTEGER DEFAULT 0');
addColumnIfMissing(db, 'clients', 'http_last_ready_at', 'INTEGER');
addColumnIfMissing(db, 'clients', 'capabilities', 'TEXT');
addColumnIfMissing(db, 'port_mappings', 'kind', "TEXT DEFAULT 'business'");
addColumnIfMissing(db, 'port_mappings', 'protected', 'INTEGER DEFAULT 0');
addColumnIfMissing(db, 'port_mappings', 'source', "TEXT DEFAULT 'client_http'");
```

- [ ] **Step 6: Implement token service**

Create `apps/server/src/modules/client-http/client-http-token.service.ts`:

```ts
import { createHmac } from 'node:crypto';

export function deriveClientHttpToken(input: {
  tokenSecret: string;
  tokenVersion: number;
  clientId: string;
}): string {
  return createHmac('sha256', input.tokenSecret)
    .update(`${input.clientId}:${input.tokenVersion}`)
    .digest('base64url');
}
```

- [ ] **Step 7: Extend clients service row and API mapping**

In `apps/server/src/modules/clients/clients.service.ts`, extend `ClientRow` with:

```ts
http_local_host: string | null;
http_local_port: number | null;
http_remote_port: number | null;
http_base_url: string | null;
http_token: string | null;
http_ready: number | null;
http_last_ready_at: number | null;
capabilities: string | null;
```

Add methods:

```ts
updateHttpEndpoint(clientId: string, patch: {
  localHost: string;
  localPort: number;
  remotePort: number;
  baseUrl: string;
  token: string;
  capabilities?: unknown;
  ready?: boolean;
}): void {
  const db = getDb();
  db.run(
    `UPDATE clients SET http_local_host = ?, http_local_port = ?, http_remote_port = ?, http_base_url = ?, http_token = ?, http_ready = ?, capabilities = ?, updated_at = ? WHERE id = ?`,
    [patch.localHost, patch.localPort, patch.remotePort, patch.baseUrl, patch.token, patch.ready ? 1 : 0, JSON.stringify(patch.capabilities ?? {}), Date.now(), clientId],
  );
}

markHttpReady(clientId: string, baseUrl: string, remotePort: number): void {
  const now = Date.now();
  getDb().run(
    `UPDATE clients SET http_ready = 1, http_base_url = ?, http_remote_port = ?, http_last_ready_at = ?, updated_at = ? WHERE id = ?`,
    [baseUrl, remotePort, now, now, clientId],
  );
}

markHttpFailed(clientId: string): void {
  getDb().run('UPDATE clients SET http_ready = 0, updated_at = ? WHERE id = ?', [Date.now(), clientId]);
}
```

Update `toApi(client)` to include:

```ts
httpReady: client.http_ready === 1,
clientHttpBaseUrl: client.http_base_url,
clientHttpRemotePort: client.http_remote_port,
capabilities: client.capabilities ? JSON.parse(client.capabilities) : {},
```

Add optional detail token support:

```ts
if ((client as ClientRow).http_token) {
  result.clientHttpToken = client.http_token;
}
```

- [ ] **Step 8: Implement coordinator service**

Create `apps/server/src/modules/client-http/client-http-coordinator.service.ts`:

```ts
import type { ClientHttpInfo, ClientHttpCapabilities } from '@rag/shared';
import { env, buildClientHttpPublicUrl } from '../../config/env.js';
import { clientsService, type ClientRow } from '../clients/clients.service.js';
import { portAllocatorService } from '../ports/port-allocator.service.js';
import { deriveClientHttpToken } from './client-http-token.service.js';

interface Deps {
  frpsPublicHost?: string;
  tokenSecret?: string;
  tokenVersion?: number;
  getClient?: (clientId: string) => ClientRow | undefined | { id: string; http_remote_port?: number | null };
  updateClientHttp?: (clientId: string, patch: {
    localHost: string;
    localPort: number;
    remotePort: number;
    baseUrl: string;
    token: string;
    capabilities?: ClientHttpCapabilities;
    ready?: boolean;
  }) => void;
  isHttpPortAvailable?: (port: number, clientId: string) => Promise<boolean>;
  allocatePort?: (clientId: string) => Promise<number>;
}

export class ClientHttpCoordinatorService {
  constructor(private readonly deps: Deps = {}) {}

  async coordinate(clientId: string, http: ClientHttpInfo, capabilities?: ClientHttpCapabilities) {
    const existing = this.deps.getClient?.(clientId) ?? clientsService.getClient(clientId);
    const preferred = typeof existing?.http_remote_port === 'number' ? existing.http_remote_port : undefined;
    let remotePort: number;
    let reused = false;

    if (preferred && await this.isAvailable(preferred, clientId)) {
      remotePort = preferred;
      reused = true;
    } else {
      remotePort = await (this.deps.allocatePort?.(clientId) ?? portAllocatorService.allocate(clientId));
    }

    const baseUrl = this.deps.frpsPublicHost
      ? `http://${this.deps.frpsPublicHost}:${remotePort}`
      : buildClientHttpPublicUrl(remotePort);
    const token = deriveClientHttpToken({
      tokenSecret: this.deps.tokenSecret ?? env.CLIENT_HTTP_TOKEN_SECRET,
      tokenVersion: this.deps.tokenVersion ?? env.CLIENT_HTTP_TOKEN_VERSION,
      clientId,
    });

    const patch = {
      localHost: http.localHost,
      localPort: http.localPort,
      remotePort,
      baseUrl,
      token,
      capabilities,
      ready: false,
    };
    if (this.deps.updateClientHttp) this.deps.updateClientHttp(clientId, patch);
    else clientsService.updateHttpEndpoint(clientId, patch);

    return {
      localHost: http.localHost,
      localPort: http.localPort,
      remotePort,
      publicBaseUrl: baseUrl,
      token,
      reused,
    };
  }

  private async isAvailable(port: number, clientId: string): Promise<boolean> {
    if (this.deps.isHttpPortAvailable) return this.deps.isHttpPortAvailable(port, clientId);
    return portAllocatorService.isAvailableForClientHttp(port, clientId);
  }
}

export const clientHttpCoordinatorService = new ClientHttpCoordinatorService();
```

- [ ] **Step 9: Extend port allocator occupied checks**

In `apps/server/src/modules/ports/port-allocator.service.ts`, add:

```ts
async isAvailableForClientHttp(port: number, clientId: string): Promise<boolean> {
  try {
    this.assertInRange(port);
  } catch {
    return false;
  }

  const db = getDb();
  const stmt = db.prepare('SELECT id FROM clients WHERE http_remote_port = ? AND id <> ?');
  stmt.bind([port, clientId]);
  const usedByOtherClient = stmt.step();
  stmt.free();
  if (usedByOtherClient) return false;

  return this.isAvailable(port);
}
```

Also update `loadUsedDbPorts()` to include client HTTP ports:

```ts
const clientStmt = db.prepare('SELECT http_remote_port FROM clients WHERE http_remote_port IS NOT NULL');
while (clientStmt.step()) {
  const row = clientStmt.getAsObject() as { http_remote_port: number };
  if (typeof row.http_remote_port === 'number') used.add(row.http_remote_port);
}
clientStmt.free();
```

- [ ] **Step 10: Run server tests**

Run:

```bash
pnpm --filter @rag/server test -- apps/server/src/modules/client-http/client-http-token.service.test.ts apps/server/src/modules/client-http/client-http-coordinator.service.test.ts apps/server/src/modules/ports/port-allocator.service.test.ts apps/server/src/modules/clients/clients.service.test.ts
pnpm --filter @rag/server typecheck
```

Expected: all listed tests pass and typecheck exits 0.

- [ ] **Step 11: Commit**

```bash
git add apps/server/src/config apps/server/src/db/migrate.ts apps/server/src/modules/client-http apps/server/src/modules/clients/clients.service.ts apps/server/src/modules/ports/port-allocator.service.ts
git commit -m "feat(server): coordinate sticky client http endpoints"
```

---

## Task 3: WebSocket Registration Coordination and Discovery APIs

**Files:**
- Modify: `apps/server/src/ws/ws-handlers.ts`
- Modify: `apps/server/src/ws/ws-handlers.test.ts`
- Modify: `apps/server/src/modules/clients/clients.routes.ts`
- Modify: `apps/server/src/modules/clients/clients.routes.test.ts`
- Modify: `apps/client/src/core/register.ts`
- Modify: `apps/client/src/main.ts`

- [ ] **Step 1: Write WebSocket handler tests**

Add cases to `apps/server/src/ws/ws-handlers.test.ts`:

```ts
it('returns HTTP control coordination in register ack', async () => {
  const ws = makeWs();
  await handleWsMessage(ws, JSON.stringify({
    type: 'client.register',
    requestId: 'reg_1',
    payload: {
      clientId: 'client-1',
      name: 'Client 1',
      http: { localHost: '127.0.0.1', localPort: 17890, protocol: 'http' },
      capabilities: { httpControl: true, jobs: true, sse: true, files: true, frpMappings: true },
    },
  }));

  const sent = JSON.parse(ws.send.mock.calls.at(-1)![0]);
  expect(sent.type).toBe('server.ack');
  expect(sent.payload.httpControl.remotePort).toBeGreaterThan(0);
  expect(sent.payload.httpControl.publicBaseUrl).toMatch(/^http:\/\//);
  expect(sent.payload.httpControl.token).toBeTruthy();
});

it('marks client HTTP ready and failed', async () => {
  const ws = makeWs();
  await handleWsMessage(ws, JSON.stringify({
    type: 'client.http_ready',
    requestId: 'ready_1',
    payload: { clientId: 'client-1', remotePort: 20317, baseUrl: 'http://frps.example.com:20317' },
  }));
  let sent = JSON.parse(ws.send.mock.calls.at(-1)![0]);
  expect(sent.payload.message).toBe('HTTP endpoint ready');

  await handleWsMessage(ws, JSON.stringify({
    type: 'client.http_failed',
    requestId: 'failed_1',
    payload: { clientId: 'client-1', remotePort: 20317, reason: 'frpc failed' },
  }));
  sent = JSON.parse(ws.send.mock.calls.at(-1)![0]);
  expect(sent.payload.message).toBe('HTTP endpoint failure recorded');
});
```

Use existing test helpers in the file. If there is no `makeWs`, add:

```ts
function makeWs() {
  return { send: vi.fn() } as unknown as WebSocket & { send: ReturnType<typeof vi.fn> };
}
```

- [ ] **Step 2: Run test and confirm it fails**

Run:

```bash
pnpm --filter @rag/server test -- apps/server/src/ws/ws-handlers.test.ts
```

Expected: FAIL because WebSocket handler does not include HTTP coordination.

- [ ] **Step 3: Update server WS handler**

In `apps/server/src/ws/ws-handlers.ts`:

- Import new schemas:

```ts
import {
  ClientRegisterPayloadSchema,
  ClientHeartbeatPayloadSchema,
  ClientHttpReadyPayloadSchema,
  ClientHttpFailedPayloadSchema,
} from '@rag/shared';
```

- Import coordinator:

```ts
import { clientHttpCoordinatorService } from '../modules/client-http/client-http-coordinator.service.js';
```

- In `client.register`, after `clientsService.upsertClient(info)`, add:

```ts
if (info.http && info.capabilities?.httpControl) {
  const httpControl = await clientHttpCoordinatorService.coordinate(info.clientId, info.http, info.capabilities);
  ackPayload.httpControl = {
    localHost: httpControl.localHost,
    localPort: httpControl.localPort,
    remotePort: httpControl.remotePort,
    publicBaseUrl: httpControl.publicBaseUrl,
    token: httpControl.token,
  };
}
```

- Add cases:

```ts
case 'client.http_ready': {
  const parsed = ClientHttpReadyPayloadSchema.safeParse(message.payload);
  if (!parsed.success) {
    ws.send(JSON.stringify({ type: 'server.error', requestId: message.requestId, payload: { code: 'INVALID_PAYLOAD', message: parsed.error.message } }));
    return;
  }
  clientsService.markHttpReady(parsed.data.clientId, parsed.data.baseUrl, parsed.data.remotePort);
  ws.send(JSON.stringify({ type: 'server.ack', requestId: message.requestId, payload: { message: 'HTTP endpoint ready' } }));
  saveDb();
  break;
}

case 'client.http_failed': {
  const parsed = ClientHttpFailedPayloadSchema.safeParse(message.payload);
  if (!parsed.success) {
    ws.send(JSON.stringify({ type: 'server.error', requestId: message.requestId, payload: { code: 'INVALID_PAYLOAD', message: parsed.error.message } }));
    return;
  }
  clientsService.markHttpFailed(parsed.data.clientId);
  auditService.log({
    actor: parsed.data.clientId,
    action: 'client.http_failed',
    targetType: 'client',
    targetId: parsed.data.clientId,
    detail: parsed.data.reason,
  });
  ws.send(JSON.stringify({ type: 'server.ack', requestId: message.requestId, payload: { message: 'HTTP endpoint failure recorded' } }));
  saveDb();
  break;
}
```

Keep `task.log` and `task.result` until Task 9.

- [ ] **Step 4: Write client registration tests**

Create or extend `apps/client/src/core/register.test.ts`:

```ts
import { describe, expect, it, vi } from 'vitest';
import { sendRegister } from './register.js';

it('sends HTTP metadata and capabilities during registration', async () => {
  const conn = { send: vi.fn() } as any;
  await sendRegister(conn, {
    clientId: 'client-1',
    clientName: 'Client 1',
    serverUrl: 'ws://localhost:3000/ws/client',
    apiBaseUrl: 'http://localhost:3000',
    token: 'token',
    workspaceDir: './workspace',
    allowedRoots: ['./workspace'],
    tags: [],
    httpHost: '127.0.0.1',
    httpPort: 17890,
    jobMaxConcurrent: 4,
    jobDefaultTimeoutMs: 300000,
    jobMaxTimeoutMs: 1800000,
    jobLogBufferLines: 5000,
  });

  expect(conn.send).toHaveBeenCalledWith(expect.objectContaining({
    type: 'client.register',
    payload: expect.objectContaining({
      http: { localHost: '127.0.0.1', localPort: 17890, protocol: 'http' },
      capabilities: { httpControl: true, jobs: true, sse: true, files: true, frpMappings: true },
    }),
  }));
});
```

- [ ] **Step 5: Update client registration**

In `apps/client/src/core/register.ts`, add to payload:

```ts
http: {
  localHost: config.httpHost,
  localPort: config.httpPort,
  protocol: 'http' as const,
},
capabilities: {
  httpControl: true,
  jobs: true,
  sse: true,
  files: true,
  frpMappings: true,
},
```

- [ ] **Step 6: Update discovery route tests**

Add to `apps/server/src/modules/clients/clients.routes.test.ts`:

```ts
it('returns token on client detail but not on list', async () => {
  clientsService.updateHttpEndpoint('client-1', {
    localHost: '127.0.0.1',
    localPort: 17890,
    remotePort: 20317,
    baseUrl: 'http://frps.example.com:20317',
    token: 'client-token',
    capabilities: { httpControl: true, jobs: true, sse: true, files: true, frpMappings: true },
    ready: true,
  });

  const list = await app.inject({ method: 'GET', url: '/api/clients', headers: authHeaders });
  expect(list.json()[0].clientHttpToken).toBeUndefined();

  const detail = await app.inject({ method: 'GET', url: '/api/clients/client-1', headers: authHeaders });
  expect(detail.json().clientHttpToken).toBe('client-token');
});
```

- [ ] **Step 7: Update clients route detail serialization**

In `apps/server/src/modules/clients/clients.routes.ts`, use:

```ts
return reply.send(clientsService.toApi(client, { includeHttpToken: true }));
```

Update `ClientsService.toApi` signature:

```ts
toApi(client: ClientRow, options?: { includeHttpToken?: boolean }): Record<string, unknown> {
  const result: Record<string, unknown> = { ... };
  if (options?.includeHttpToken) result.clientHttpToken = client.http_token;
  return result;
}
```

- [ ] **Step 8: Run tests**

Run:

```bash
pnpm --filter @rag/server test -- apps/server/src/ws/ws-handlers.test.ts apps/server/src/modules/clients/clients.routes.test.ts
pnpm --filter @rag/client test -- apps/client/src/core/register.test.ts
pnpm typecheck
```

Expected: all pass.

- [ ] **Step 9: Commit**

```bash
git add apps/server/src/ws apps/server/src/modules/clients apps/client/src/core/register.ts apps/client/src/core/register.test.ts
git commit -m "feat: coordinate client http endpoint during registration"
```

---

## Task 4: Client Config and Persistent HTTP Control Server Skeleton

**Files:**
- Modify: `apps/client/src/config/client.config.ts`
- Modify: `client.config.example.yaml`
- Create: `apps/client/src/runtime/control-http/response.ts`
- Create: `apps/client/src/runtime/control-http/auth.ts`
- Create: `apps/client/src/runtime/control-http/router.ts`
- Create: `apps/client/src/runtime/control-http/server.ts`
- Test: `apps/client/src/config/client.config.test.ts`
- Test: `apps/client/src/runtime/control-http/server.test.ts`

- [ ] **Step 1: Write client config tests**

Extend `apps/client/src/config/client.config.test.ts`:

```ts
it('loads HTTP control defaults from YAML', () => {
  const dir = makeTempDir();
  fs.writeFileSync(path.join(dir, 'client.config.yaml'), `
client:
  id: client-1
  name: Client 1
server:
  wsUrl: ws://localhost:3000/ws/client
  apiBaseUrl: http://localhost:3000
  token: token
workspace:
  dir: ./workspace
  allowedRoots:
    - ./workspace
frp:
  workDir: ./frp
http:
  host: 127.0.0.1
  port: 17890
  job:
    maxConcurrent: 3
    defaultTimeoutMs: 1000
    maxTimeoutMs: 5000
    logBufferLines: 200
`);

  const config = loadConfig(undefined, { cwd: dir });
  expect(config.httpHost).toBe('127.0.0.1');
  expect(config.httpPort).toBe(17890);
  expect(config.jobMaxConcurrent).toBe(3);
  expect(config.jobDefaultTimeoutMs).toBe(1000);
  expect(config.jobMaxTimeoutMs).toBe(5000);
  expect(config.jobLogBufferLines).toBe(200);
});
```

- [ ] **Step 2: Write control HTTP server tests**

Create `apps/client/src/runtime/control-http/server.test.ts`:

```ts
import { afterEach, describe, expect, it } from 'vitest';
import { startControlHttpServer, stopControlHttpServer } from './server.js';

describe('control HTTP server', () => {
  afterEach(async () => { await stopControlHttpServer(); });

  it('requires bearer token for health', async () => {
    const state = await startControlHttpServer({
      clientId: 'client-1',
      host: '127.0.0.1',
      port: 0,
      token: 'client-token',
      workspaceDir: process.cwd(),
      allowedRoots: [process.cwd()],
      job: { maxConcurrent: 1, defaultTimeoutMs: 1000, maxTimeoutMs: 5000, logBufferLines: 100 },
    });

    const unauthorized = await fetch(`http://127.0.0.1:${state.port}/health`);
    expect(unauthorized.status).toBe(401);

    const ok = await fetch(`http://127.0.0.1:${state.port}/health`, { headers: { Authorization: 'Bearer client-token' } });
    expect(ok.status).toBe(200);
    expect(await ok.json()).toMatchObject({ ok: true, data: { clientId: 'client-1' } });
  });

  it('exposes public low-information ping', async () => {
    const state = await startControlHttpServer({
      clientId: 'client-1',
      host: '127.0.0.1',
      port: 0,
      token: 'client-token',
      workspaceDir: process.cwd(),
      allowedRoots: [process.cwd()],
      job: { maxConcurrent: 1, defaultTimeoutMs: 1000, maxTimeoutMs: 5000, logBufferLines: 100 },
    });

    const res = await fetch(`http://127.0.0.1:${state.port}/ping`);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
  });
});
```

- [ ] **Step 3: Run tests and confirm failure**

Run:

```bash
pnpm --filter @rag/client test -- apps/client/src/config/client.config.test.ts apps/client/src/runtime/control-http/server.test.ts
```

Expected: FAIL because HTTP config fields and control server files do not exist.

- [ ] **Step 4: Extend client config**

In `apps/client/src/config/client.config.ts`, extend schema:

```ts
http: z.object({
  host: z.string().default('127.0.0.1'),
  port: z.coerce.number().int().min(0).max(65535).default(17890),
  job: z.object({
    maxConcurrent: z.coerce.number().int().positive().default(4),
    defaultTimeoutMs: z.coerce.number().int().positive().default(300_000),
    maxTimeoutMs: z.coerce.number().int().positive().default(1_800_000),
    logBufferLines: z.coerce.number().int().positive().default(5000),
  }).default({}),
}).default({}),
```

Extend `ClientConfig`:

```ts
httpHost: string;
httpPort: number;
jobMaxConcurrent: number;
jobDefaultTimeoutMs: number;
jobMaxTimeoutMs: number;
jobLogBufferLines: number;
```

Return from `normalizeYamlConfig`:

```ts
httpHost: raw.http.host,
httpPort: raw.http.port,
jobMaxConcurrent: raw.http.job.maxConcurrent,
jobDefaultTimeoutMs: raw.http.job.defaultTimeoutMs,
jobMaxTimeoutMs: raw.http.job.maxTimeoutMs,
jobLogBufferLines: raw.http.job.logBufferLines,
```

- [ ] **Step 5: Update client config example**

Add to `client.config.example.yaml`:

```yaml
http:
  host: 127.0.0.1
  port: 17890
  job:
    maxConcurrent: 4
    defaultTimeoutMs: 300000
    maxTimeoutMs: 1800000
    logBufferLines: 5000
```

- [ ] **Step 6: Implement response helpers**

Create `apps/client/src/runtime/control-http/response.ts`:

```ts
import type { ServerResponse } from 'node:http';

export function setCorsHeaders(res: ServerResponse): void {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type, Last-Event-ID, Accept');
}

export function sendJson(res: ServerResponse, status: number, body: unknown): void {
  setCorsHeaders(res);
  const payload = Buffer.from(JSON.stringify(body));
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Content-Length': payload.length });
  res.end(payload);
}

export function sendOk(res: ServerResponse, data: unknown): void {
  sendJson(res, 200, { ok: true, data });
}

export function sendError(res: ServerResponse, status: number, code: string, message: string): void {
  sendJson(res, status, { ok: false, error: { code, message } });
}

export async function readBody(req: NodeJS.ReadableStream): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  return Buffer.concat(chunks);
}

export async function readJson<T>(req: NodeJS.ReadableStream): Promise<T> {
  return JSON.parse((await readBody(req)).toString('utf-8')) as T;
}
```

- [ ] **Step 7: Implement auth helper**

Create `apps/client/src/runtime/control-http/auth.ts`:

```ts
import type { IncomingMessage, ServerResponse } from 'node:http';
import { sendError } from './response.js';

export function requireBearerToken(req: IncomingMessage, res: ServerResponse, token: string): boolean {
  const auth = req.headers.authorization;
  if (!auth) {
    sendError(res, 401, 'UNAUTHORIZED', 'Missing authorization header');
    return false;
  }
  if (auth !== `Bearer ${token}`) {
    sendError(res, 403, 'FORBIDDEN', 'Invalid token');
    return false;
  }
  return true;
}
```

- [ ] **Step 8: Implement minimal router and server**

Create `apps/client/src/runtime/control-http/router.ts`:

```ts
import type { IncomingMessage, ServerResponse } from 'node:http';

export type RouteHandler = (req: IncomingMessage, res: ServerResponse, url: URL) => Promise<void> | void;

interface Route { method: string; path: RegExp; handler: RouteHandler }

export class ControlHttpRouter {
  private readonly routes: Route[] = [];

  add(method: string, path: RegExp, handler: RouteHandler): void {
    this.routes.push({ method, path, handler });
  }

  async handle(req: IncomingMessage, res: ServerResponse): Promise<boolean> {
    const url = new URL(req.url ?? '/', 'http://127.0.0.1');
    const route = this.routes.find((candidate) => candidate.method === (req.method ?? 'GET') && candidate.path.test(url.pathname));
    if (!route) return false;
    await route.handler(req, res, url);
    return true;
  }
}
```

Create `apps/client/src/runtime/control-http/server.ts`:

```ts
import * as http from 'node:http';
import { once } from 'node:events';
import { ControlHttpRouter } from './router.js';
import { requireBearerToken } from './auth.js';
import { sendError, sendJson, sendOk, setCorsHeaders } from './response.js';

interface StartOptions {
  clientId: string;
  host: string;
  port: number;
  token: string;
  workspaceDir: string;
  allowedRoots: string[];
  job: { maxConcurrent: number; defaultTimeoutMs: number; maxTimeoutMs: number; logBufferLines: number };
}

export interface ControlHttpServerState {
  running: true;
  host: string;
  port: number;
  startedAt: number;
}

let activeServer: http.Server | null = null;
let activeState: ControlHttpServerState | null = null;

export async function startControlHttpServer(options: StartOptions): Promise<ControlHttpServerState> {
  await stopControlHttpServer();
  const router = new ControlHttpRouter();

  router.add('GET', /^\/ping$/, (_req, res) => sendJson(res, 200, { ok: true }));
  router.add('GET', /^\/health$/, (req, res) => {
    if (!requireBearerToken(req, res, options.token)) return;
    sendOk(res, { clientId: options.clientId, status: 'ready', version: '0.1.0', httpReady: true, frpcRunning: false });
  });

  activeServer = http.createServer(async (req, res) => {
    try {
      if (req.method === 'OPTIONS') {
        setCorsHeaders(res);
        res.writeHead(204);
        res.end();
        return;
      }
      if (await router.handle(req, res)) return;
      sendError(res, 404, 'NOT_FOUND', 'Route not found');
    } catch (err) {
      sendError(res, 500, 'INTERNAL_ERROR', err instanceof Error ? err.message : String(err));
    }
  });

  activeServer.listen(options.port, options.host);
  await once(activeServer, 'listening');
  const address = activeServer.address();
  const port = typeof address === 'object' && address ? address.port : options.port;
  activeState = { running: true, host: options.host, port, startedAt: Date.now() };
  return activeState;
}

export async function stopControlHttpServer(): Promise<void> {
  if (!activeServer) return;
  const server = activeServer;
  activeServer = null;
  activeState = null;
  server.close();
  await once(server, 'close');
}

export function getControlHttpServerState(): ControlHttpServerState | null {
  return activeState;
}
```

- [ ] **Step 9: Run tests**

Run:

```bash
pnpm --filter @rag/client test -- apps/client/src/config/client.config.test.ts apps/client/src/runtime/control-http/server.test.ts
pnpm --filter @rag/client typecheck
```

Expected: pass.

- [ ] **Step 10: Commit**

```bash
git add apps/client/src/config client.config.example.yaml apps/client/src/runtime/control-http
git commit -m "feat(client): add persistent control http server"
```

---

## Task 5: Protected Control FRP Mapping and Client Ready/Failed Reporting

**Files:**
- Modify: `apps/client/src/runtime/frpc-daemon.ts`
- Modify: `apps/client/src/runtime/frpc-daemon.test.ts`
- Modify: `apps/client/src/main.ts`
- Create: `apps/client/src/runtime/control-http/control-tunnel.ts`
- Test: `apps/client/src/runtime/control-http/control-tunnel.test.ts`

- [ ] **Step 1: Write frpc daemon test for protected mapping**

Add to `apps/client/src/runtime/frpc-daemon.test.ts`:

```ts
it('includes protected HTTP control proxy in combined config', () => {
  const workDir = makeWorkDir();
  spawnMock.mockReturnValue(makeFakeProcess(9876));
  setFrpsInfo({ serverAddr: 'frps.example.com', serverPort: 7000, authToken: 'frp-token' });

  rebuildFrpcDaemon(makeClientConfig(workDir), {
    name: 'rag-client-1-http-control',
    type: 'tcp',
    localIP: '127.0.0.1',
    localPort: 17890,
    remotePort: 20317,
    protected: true,
  });

  const combined = fs.readFileSync(path.join(workDir, 'frpc-combined.toml'), 'utf-8');
  expect(combined).toContain('rag-client-1-http-control');
  expect(combined).toContain('localPort = 17890');
  expect(combined).toContain('remotePort = 20317');
});
```

- [ ] **Step 2: Run test and confirm failure**

Run:

```bash
pnpm --filter @rag/client test -- apps/client/src/runtime/frpc-daemon.test.ts
```

Expected: FAIL because `rebuildFrpcDaemon` does not accept a protected control proxy.

- [ ] **Step 3: Extend frpc daemon API**

In `apps/client/src/runtime/frpc-daemon.ts`, add:

```ts
export interface FrpcProxyConfig {
  name: string;
  type: 'tcp' | 'http' | 'https';
  localIP: string;
  localPort: number;
  remotePort?: number;
  customDomains?: string[];
  subdomain?: string;
  protected?: boolean;
}

function serializeProxy(proxy: FrpcProxyConfig): string {
  const lines = [
    '[[proxies]]',
    `name = "${proxy.name}"`,
    `type = "${proxy.type}"`,
    `localIP = "${proxy.localIP}"`,
    `localPort = ${proxy.localPort}`,
  ];
  if (typeof proxy.remotePort === 'number' && proxy.type === 'tcp') lines.push(`remotePort = ${proxy.remotePort}`);
  if (proxy.customDomains?.length) lines.push(`customDomains = ${JSON.stringify(proxy.customDomains)}`);
  if (proxy.subdomain) lines.push(`subdomain = "${proxy.subdomain}"`);
  return lines.join('\n');
}
```

Update signature:

```ts
export function rebuildFrpcDaemon(config: ClientConfig, protectedProxy?: FrpcProxyConfig): { proxyCount: number } | null {
```

Before reading mapping files:

```ts
if (protectedProxy) proxies.push(serializeProxy(protectedProxy));
```

- [ ] **Step 4: Add control tunnel helper**

Create `apps/client/src/runtime/control-http/control-tunnel.ts`:

```ts
import type { ClientHttpControl } from '@rag/shared';
import type { ClientConfig } from '../../config/client.config.js';
import { rebuildFrpcDaemon, type FrpcProxyConfig } from '../frpc-daemon.js';

export function buildControlProxy(config: ClientConfig, control: ClientHttpControl): FrpcProxyConfig {
  return {
    name: `rag-${config.clientId}-http-control`,
    type: 'tcp',
    localIP: control.localHost,
    localPort: control.localPort,
    remotePort: control.remotePort,
    protected: true,
  };
}

export function startControlTunnel(config: ClientConfig, control: ClientHttpControl): { proxyCount: number } | null {
  return rebuildFrpcDaemon(config, buildControlProxy(config, control));
}
```

- [ ] **Step 5: Write control tunnel test**

Create `apps/client/src/runtime/control-http/control-tunnel.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { buildControlProxy } from './control-tunnel.js';

it('builds protected control proxy from ack data', () => {
  const proxy = buildControlProxy({ clientId: 'client-1' } as any, {
    localHost: '127.0.0.1',
    localPort: 17890,
    remotePort: 20317,
    publicBaseUrl: 'http://frps.example.com:20317',
    token: 'client-token',
  });

  expect(proxy).toEqual({
    name: 'rag-client-1-http-control',
    type: 'tcp',
    localIP: '127.0.0.1',
    localPort: 17890,
    remotePort: 20317,
    protected: true,
  });
});
```

- [ ] **Step 6: Update client main flow**

In `apps/client/src/main.ts`:

- Import:

```ts
import { startControlHttpServer, stopControlHttpServer } from './runtime/control-http/server.js';
import { startControlTunnel } from './runtime/control-http/control-tunnel.js';
import type { ClientHttpControl } from '@rag/shared';
```

- Start HTTP server before WebSocket connection using a bootstrap token first:

```ts
let activeHttpToken = 'pending-bootstrap-token';
await startControlHttpServer({
  clientId: config.clientId,
  host: config.httpHost,
  port: config.httpPort,
  token: activeHttpToken,
  workspaceDir: config.workspaceDir,
  allowedRoots: config.allowedRoots,
  job: {
    maxConcurrent: config.jobMaxConcurrent,
    defaultTimeoutMs: config.jobDefaultTimeoutMs,
    maxTimeoutMs: config.jobMaxTimeoutMs,
    logBufferLines: config.jobLogBufferLines,
  },
});
```

- In `server.ack`, when `httpControl` exists:

```ts
const control = ackPayload.httpControl as ClientHttpControl | undefined;
if (control) {
  activeHttpToken = control.token;
  await stopControlHttpServer();
  await startControlHttpServer({
    clientId: config.clientId,
    host: config.httpHost,
    port: control.localPort,
    token: control.token,
    workspaceDir: config.workspaceDir,
    allowedRoots: config.allowedRoots,
    job: {
      maxConcurrent: config.jobMaxConcurrent,
      defaultTimeoutMs: config.jobDefaultTimeoutMs,
      maxTimeoutMs: config.jobMaxTimeoutMs,
      logBufferLines: config.jobLogBufferLines,
    },
  });

  try {
    const result = startControlTunnel(config, control);
    conn.send({
      type: 'client.http_ready',
      requestId: `http_ready_${config.clientId}`,
      payload: { clientId: config.clientId, remotePort: control.remotePort, baseUrl: control.publicBaseUrl },
    });
    console.log(`Client HTTP endpoint ready: ${control.publicBaseUrl} (${result?.proxyCount ?? 0} proxies)`);
  } catch (err) {
    conn.send({
      type: 'client.http_failed',
      requestId: `http_failed_${config.clientId}`,
      payload: { clientId: config.clientId, remotePort: control.remotePort, reason: err instanceof Error ? err.message : String(err) },
    });
  }
}
```

Ensure shutdown also calls `stopControlHttpServer()`.

- [ ] **Step 7: Run tests and typecheck**

Run:

```bash
pnpm --filter @rag/client test -- apps/client/src/runtime/frpc-daemon.test.ts apps/client/src/runtime/control-http/control-tunnel.test.ts
pnpm --filter @rag/client typecheck
```

Expected: pass.

- [ ] **Step 8: Commit**

```bash
git add apps/client/src/main.ts apps/client/src/runtime/frpc-daemon.ts apps/client/src/runtime/frpc-daemon.test.ts apps/client/src/runtime/control-http/control-tunnel.ts apps/client/src/runtime/control-http/control-tunnel.test.ts
git commit -m "feat(client): expose control http through protected frp tunnel"
```

---

## Task 6: Client Job API and Mandatory SSE

**Files:**
- Create: `apps/client/src/runtime/control-http/job-manager.ts`
- Create: `apps/client/src/runtime/control-http/job-routes.ts`
- Modify: `apps/client/src/runtime/control-http/server.ts`
- Test: `apps/client/src/runtime/control-http/job-manager.test.ts`
- Test: `apps/client/src/runtime/control-http/job-routes.test.ts`

- [ ] **Step 1: Write job manager tests**

Create `apps/client/src/runtime/control-http/job-manager.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { JobManager } from './job-manager.js';

it('runs a command job and buffers stdout', async () => {
  const manager = new JobManager({ maxConcurrent: 1, defaultTimeoutMs: 5000, maxTimeoutMs: 5000, logBufferLines: 100, workspaceDir: process.cwd() });
  const job = manager.createCommand({ command: process.execPath, args: ['-e', 'console.log("hello-job")'] });
  const completed = await manager.wait(job.jobId);

  expect(completed.status).toBe('success');
  expect(manager.getLogs(job.jobId, 0, 10).logs.map((l) => l.content).join('')).toContain('hello-job');
});

it('enforces max concurrent jobs', () => {
  const manager = new JobManager({ maxConcurrent: 0, defaultTimeoutMs: 5000, maxTimeoutMs: 5000, logBufferLines: 100, workspaceDir: process.cwd() });
  expect(() => manager.createCommand({ command: process.execPath, args: ['-v'] })).toThrow(/concurrent/i);
});
```

- [ ] **Step 2: Write HTTP route and SSE tests**

Create `apps/client/src/runtime/control-http/job-routes.test.ts`:

```ts
import { afterEach, describe, expect, it } from 'vitest';
import { startControlHttpServer, stopControlHttpServer } from './server.js';

async function start() {
  return startControlHttpServer({
    clientId: 'client-1',
    host: '127.0.0.1',
    port: 0,
    token: 'client-token',
    workspaceDir: process.cwd(),
    allowedRoots: [process.cwd()],
    job: { maxConcurrent: 2, defaultTimeoutMs: 5000, maxTimeoutMs: 5000, logBufferLines: 100 },
  });
}

describe('job HTTP routes', () => {
  afterEach(async () => { await stopControlHttpServer(); });

  it('creates command job and exposes logs', async () => {
    const state = await start();
    const create = await fetch(`http://127.0.0.1:${state.port}/jobs/command`, {
      method: 'POST',
      headers: { Authorization: 'Bearer client-token', 'Content-Type': 'application/json' },
      body: JSON.stringify({ command: process.execPath, args: ['-e', 'console.log("route-job")'] }),
    });
    expect(create.status).toBe(200);
    const created = await create.json();
    const jobId = created.data.jobId;

    await new Promise((resolve) => setTimeout(resolve, 500));
    const logs = await fetch(`http://127.0.0.1:${state.port}/jobs/${jobId}/logs?sinceSeq=0`, { headers: { Authorization: 'Bearer client-token' } });
    expect((await logs.json()).data.logs.map((l: any) => l.content).join('')).toContain('route-job');
  });

  it('streams SSE events', async () => {
    const state = await start();
    const create = await fetch(`http://127.0.0.1:${state.port}/jobs/command`, {
      method: 'POST',
      headers: { Authorization: 'Bearer client-token', 'Content-Type': 'application/json' },
      body: JSON.stringify({ command: process.execPath, args: ['-e', 'console.log("sse-job")'] }),
    });
    const jobId = (await create.json()).data.jobId;
    const events = await fetch(`http://127.0.0.1:${state.port}/jobs/${jobId}/events`, { headers: { Authorization: 'Bearer client-token', Accept: 'text/event-stream' } });
    const text = await events.text();
    expect(text).toContain('event: job.');
  });
});
```

- [ ] **Step 3: Run tests and confirm failure**

Run:

```bash
pnpm --filter @rag/client test -- apps/client/src/runtime/control-http/job-manager.test.ts apps/client/src/runtime/control-http/job-routes.test.ts
```

Expected: FAIL because job manager and routes do not exist.

- [ ] **Step 4: Implement JobManager**

Create `apps/client/src/runtime/control-http/job-manager.ts` with these public methods:

```ts
export class JobManager {
  constructor(options: JobManagerOptions);
  createCommand(payload: ClientJobCommandPayload): JobRecord;
  createScript(payload: ClientJobScriptPayload): JobRecord;
  getJob(jobId: string): JobRecord | undefined;
  getLogs(jobId: string, sinceSeq: number, limit: number): { logs: ClientJobLogEntry[]; nextSeq: number };
  cancel(jobId: string): JobRecord;
  wait(jobId: string): Promise<JobRecord>;
  subscribe(jobId: string, listener: (event: JobEvent) => void): () => void;
}
```

Implementation details:

```ts
import { spawn, type ChildProcess } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { randomUUID } from 'node:crypto';
import type { ClientJobCommandPayload, ClientJobLogEntry, ClientJobScriptPayload, ClientJobStatus, ClientJobType } from '@rag/shared';

export interface JobManagerOptions {
  maxConcurrent: number;
  defaultTimeoutMs: number;
  maxTimeoutMs: number;
  logBufferLines: number;
  workspaceDir: string;
}

export interface JobRecord {
  jobId: string;
  type: ClientJobType;
  status: ClientJobStatus;
  startedAt?: number;
  finishedAt?: number;
  exitCode?: number | null;
  error?: string | null;
}

export type JobEvent =
  | { event: 'job.started'; data: JobRecord; id?: number }
  | { event: 'job.stdout' | 'job.stderr'; data: ClientJobLogEntry; id: number }
  | { event: 'job.completed' | 'job.failed' | 'job.cancelled'; data: JobRecord; id?: number }
  | { event: 'heartbeat'; data: { timestamp: number }; id?: number };
```

Use `spawn(command, args, { cwd, env: { ...process.env, ...payload.env }, shell: process.platform === 'win32' })` for command jobs. For script jobs, write scripts under `workspaceDir/jobs/<jobId>/script.<ext>` and spawn the runtime.

For logging, increment `seq`, append to per-job buffer, trim to `logBufferLines`, and notify subscribers.

- [ ] **Step 5: Implement job routes**

Create `apps/client/src/runtime/control-http/job-routes.ts`:

```ts
import type { IncomingMessage, ServerResponse } from 'node:http';
import { ClientJobCommandPayloadSchema, ClientJobScriptPayloadSchema } from '@rag/shared';
import type { ControlHttpRouter } from './router.js';
import { readJson, sendError, sendOk, setCorsHeaders } from './response.js';
import { requireBearerToken } from './auth.js';
import type { JobManager, JobEvent } from './job-manager.js';

function writeSse(res: ServerResponse, item: JobEvent): void {
  if (typeof item.id === 'number') res.write(`id: ${item.id}\n`);
  res.write(`event: ${item.event}\n`);
  res.write(`data: ${JSON.stringify(item.data)}\n\n`);
}

export function registerJobRoutes(router: ControlHttpRouter, manager: JobManager, token: string): void {
  router.add('POST', /^\/jobs\/command$/, async (req, res) => {
    if (!requireBearerToken(req, res, token)) return;
    const payload = ClientJobCommandPayloadSchema.parse(await readJson(req));
    const job = manager.createCommand(payload);
    sendOk(res, { jobId: job.jobId, status: job.status });
  });

  router.add('POST', /^\/jobs\/script$/, async (req, res) => {
    if (!requireBearerToken(req, res, token)) return;
    const payload = ClientJobScriptPayloadSchema.parse(await readJson(req));
    const job = manager.createScript(payload);
    sendOk(res, { jobId: job.jobId, status: job.status });
  });

  router.add('GET', /^\/jobs\/[^/]+$/, (req, res, url) => {
    if (!requireBearerToken(req, res, token)) return;
    const jobId = url.pathname.split('/')[2];
    const job = manager.getJob(jobId);
    if (!job) return sendError(res, 404, 'NOT_FOUND', 'Job not found');
    sendOk(res, job);
  });

  router.add('GET', /^\/jobs\/[^/]+\/logs$/, (req, res, url) => {
    if (!requireBearerToken(req, res, token)) return;
    const jobId = url.pathname.split('/')[2];
    const sinceSeq = Number(url.searchParams.get('sinceSeq') ?? '0');
    const limit = Number(url.searchParams.get('limit') ?? '500');
    sendOk(res, { jobId, ...manager.getLogs(jobId, sinceSeq, limit) });
  });

  router.add('POST', /^\/jobs\/[^/]+\/cancel$/, (req, res, url) => {
    if (!requireBearerToken(req, res, token)) return;
    const jobId = url.pathname.split('/')[2];
    sendOk(res, manager.cancel(jobId));
  });

  router.add('GET', /^\/jobs\/[^/]+\/events$/, (req, res, url) => {
    if (!requireBearerToken(req, res, token)) return;
    const jobId = url.pathname.split('/')[2];
    setCorsHeaders(res);
    res.writeHead(200, {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
    });
    const lastEventId = Number(req.headers['last-event-id'] ?? '0');
    for (const log of manager.getLogs(jobId, lastEventId, 500).logs) {
      writeSse(res, { event: log.stream === 'stdout' ? 'job.stdout' : 'job.stderr', data: log, id: log.seq });
    }
    const unsubscribe = manager.subscribe(jobId, (event) => writeSse(res, event));
    req.on('close', unsubscribe);
  });
}
```

- [ ] **Step 6: Register job routes in server skeleton**

In `apps/client/src/runtime/control-http/server.ts`, create `JobManager` and call `registerJobRoutes(router, jobManager, options.token)`.

- [ ] **Step 7: Run job tests and typecheck**

Run:

```bash
pnpm --filter @rag/client test -- apps/client/src/runtime/control-http/job-manager.test.ts apps/client/src/runtime/control-http/job-routes.test.ts
pnpm --filter @rag/client typecheck
```

Expected: pass.

- [ ] **Step 8: Commit**

```bash
git add apps/client/src/runtime/control-http
git commit -m "feat(client): add job api with sse events"
```

---

## Task 7: Client Direct File API on Control HTTP

**Files:**
- Create: `apps/client/src/runtime/control-http/file-routes.ts`
- Modify: `apps/client/src/runtime/control-http/server.ts`
- Test: `apps/client/src/runtime/control-http/file-routes.test.ts`

- [ ] **Step 1: Write file route tests**

Create `apps/client/src/runtime/control-http/file-routes.test.ts`:

```ts
import { afterEach, describe, expect, it } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { startControlHttpServer, stopControlHttpServer } from './server.js';

async function startWithRoot(root: string) {
  return startControlHttpServer({
    clientId: 'client-1',
    host: '127.0.0.1',
    port: 0,
    token: 'client-token',
    workspaceDir: root,
    allowedRoots: [root],
    job: { maxConcurrent: 1, defaultTimeoutMs: 1000, maxTimeoutMs: 5000, logBufferLines: 100 },
  });
}

describe('file routes', () => {
  afterEach(async () => { await stopControlHttpServer(); });

  it('writes and reads a file inside allowed root', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'rag-file-routes-'));
    const state = await startWithRoot(root);
    const base = `http://127.0.0.1:${state.port}`;
    const headers = { Authorization: 'Bearer client-token' };

    const write = await fetch(`${base}/files/write?rootId=root_0&path=hello.txt`, { method: 'PUT', headers, body: 'hello' });
    expect(write.status).toBe(200);

    const read = await fetch(`${base}/files/read?rootId=root_0&path=hello.txt`, { headers });
    expect(await read.text()).toBe('hello');
  });

  it('rejects path traversal', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'rag-file-routes-'));
    const state = await startWithRoot(root);
    const res = await fetch(`http://127.0.0.1:${state.port}/files/read?rootId=root_0&path=../secret.txt`, { headers: { Authorization: 'Bearer client-token' } });
    expect(res.status).toBe(400);
  });
});
```

- [ ] **Step 2: Run test and confirm failure**

Run:

```bash
pnpm --filter @rag/client test -- apps/client/src/runtime/control-http/file-routes.test.ts
```

Expected: FAIL because `/files/*` routes are not registered.

- [ ] **Step 3: Implement file routes**

Create `apps/client/src/runtime/control-http/file-routes.ts`. Reuse `resolveAllowedRoots`, `resolveRootPath`, `toClientFileEntry`, and `toClientFileStat` from existing runtime files.

Public route mapping:

```ts
export function registerFileRoutes(router: ControlHttpRouter, options: {
  token: string;
  workspaceDir: string;
  allowedRoots: string[];
}): void
```

Routes:

- `GET /files/roots` returns `{ ok: true, data: { roots } }`.
- `GET /files?rootId=...&path=...` lists entries.
- `GET /files/stat?rootId=...&path=...` returns stat.
- `GET /files/read?rootId=...&path=...` sends text/binary content directly.
- `GET /files/download?rootId=...&path=...` sends content with attachment headers.
- `PUT /files/write?rootId=...&path=...` writes request body.
- `POST /files/upload?rootId=...&path=...&filename=...` writes uploaded body.
- `POST /files/mkdir`, `DELETE /files`, `POST /files/move`, `POST /files/copy` mirror existing file HTTP behavior.

Use exact root IDs from `resolveAllowedRoots`. If existing helper returns different IDs, update tests to assert the helper-defined ID and keep route behavior stable.

- [ ] **Step 4: Register file routes**

In `apps/client/src/runtime/control-http/server.ts`:

```ts
import { registerFileRoutes } from './file-routes.js';

registerFileRoutes(router, {
  token: options.token,
  workspaceDir: options.workspaceDir,
  allowedRoots: options.allowedRoots,
});
```

- [ ] **Step 5: Run file tests and existing file safety tests**

Run:

```bash
pnpm --filter @rag/client test -- apps/client/src/runtime/control-http/file-routes.test.ts apps/client/src/runtime/file-roots.test.ts apps/client/src/runtime/file-paths.test.ts
pnpm --filter @rag/client typecheck
```

Expected: pass.

- [ ] **Step 6: Commit**

```bash
git add apps/client/src/runtime/control-http/file-routes.ts apps/client/src/runtime/control-http/file-routes.test.ts apps/client/src/runtime/control-http/server.ts
git commit -m "feat(client): serve direct file api from control http"
```

---

## Task 8: Business FRP Mapping API Through Client HTTP and Server Allocation

**Files:**
- Create: `apps/client/src/runtime/control-http/frp-mapping-store.ts`
- Create: `apps/client/src/runtime/control-http/frp-routes.ts`
- Modify: `apps/client/src/runtime/control-http/server.ts`
- Modify: `apps/client/src/runtime/frpc-daemon.ts`
- Create: `apps/server/src/modules/client-http/client-http-port.routes.ts`
- Modify: `apps/server/src/main.ts`
- Test: `apps/client/src/runtime/control-http/frp-routes.test.ts`
- Test: `apps/server/src/modules/client-http/client-http-port.routes.test.ts`

- [ ] **Step 1: Write server port reservation route tests**

Create `apps/server/src/modules/client-http/client-http-port.routes.test.ts`:

```ts
import { describe, expect, it } from 'vitest';

it('allocates a business port for a client', async () => {
  const res = await app.inject({
    method: 'POST',
    url: '/api/clients/client-1/http/ports/allocate',
    headers: authHeaders,
    payload: { name: 'vite', proxyType: 'tcp', localIp: '127.0.0.1', localPort: 5173 },
  });

  expect(res.statusCode).toBe(200);
  expect(res.json().remotePort).toBeGreaterThan(0);
  expect(res.json().mappingId).toMatch(/^pm_/);
});
```

Use existing app setup helpers from nearby route tests.

- [ ] **Step 2: Write client FRP route tests**

Create `apps/client/src/runtime/control-http/frp-routes.test.ts`:

```ts
import { afterEach, describe, expect, it, vi } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { startControlHttpServer, stopControlHttpServer } from './server.js';

it('rejects deletion of protected HTTP control mapping', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'rag-frp-routes-'));
  const state = await startControlHttpServer({
    clientId: 'client-1',
    host: '127.0.0.1',
    port: 0,
    token: 'client-token',
    workspaceDir: root,
    allowedRoots: [root],
    job: { maxConcurrent: 1, defaultTimeoutMs: 1000, maxTimeoutMs: 5000, logBufferLines: 100 },
    controlMapping: { id: 'http-control', remotePort: 20317, publicUrl: 'http://frps.example.com:20317' },
  } as any);

  const res = await fetch(`http://127.0.0.1:${state.port}/frp/mappings/http-control`, {
    method: 'DELETE',
    headers: { Authorization: 'Bearer client-token' },
  });
  expect(res.status).toBe(409);
});
```

- [ ] **Step 3: Run tests and confirm failure**

Run:

```bash
pnpm --filter @rag/server test -- apps/server/src/modules/client-http/client-http-port.routes.test.ts
pnpm --filter @rag/client test -- apps/client/src/runtime/control-http/frp-routes.test.ts
```

Expected: fail because routes do not exist.

- [ ] **Step 4: Implement server allocation route**

Create `apps/server/src/modules/client-http/client-http-port.routes.ts`:

```ts
import type { FastifyInstance } from 'fastify';
import { authMiddleware } from '../auth/auth.middleware.js';
import { frpService } from '../frp/frp.service.js';
import { auditService } from '../audit/audit.service.js';

export async function clientHttpPortRoutes(app: FastifyInstance): Promise<void> {
  app.addHook('preHandler', authMiddleware);

  app.post<{ Params: { clientId: string }; Body: { name: string; proxyType: string; localIp: string; localPort: number; remotePort?: number; customDomain?: string } }>(
    '/api/clients/:clientId/http/ports/allocate',
    async (request, reply) => {
      const mapping = await frpService.createMapping({
        clientId: request.params.clientId,
        name: request.body.name,
        proxyType: request.body.proxyType,
        localIp: request.body.localIp,
        localPort: request.body.localPort,
        remotePort: request.body.remotePort,
        customDomain: request.body.customDomain,
      });
      auditService.log({
        actor: (request as unknown as { authRole: string }).authRole,
        action: 'client_http.business_port.allocate',
        targetType: 'port_mapping',
        targetId: mapping.id,
      });
      return reply.send({ mappingId: mapping.id, remotePort: mapping.remote_port, publicUrl: mapping.public_url });
    },
  );

  app.post<{ Params: { mappingId: string } }>('/api/client-http/ports/:mappingId/active', async (request, reply) => {
    frpService.updateMappingStatus(request.params.mappingId, 'active');
    return reply.send({ ok: true });
  });
}
```

Register in `apps/server/src/main.ts`.

- [ ] **Step 5: Implement client mapping store and routes**

Create `apps/client/src/runtime/control-http/frp-mapping-store.ts` with JSON persistence under `frpcWorkDir/mappings.json`:

```ts
export interface ClientBusinessMapping {
  id: string;
  kind: 'business';
  name: string;
  type: 'tcp' | 'http' | 'https';
  localHost: string;
  localPort: number;
  remotePort?: number;
  customDomain?: string;
  publicUrl?: string;
}
```

Create `apps/client/src/runtime/control-http/frp-routes.ts`:

- `GET /frp/mappings` returns protected `http-control` plus business mappings.
- `POST /frp/mappings` validates payload, calls server allocation endpoint with `config.apiBaseUrl` and `config.token`, persists mapping, rebuilds frpc daemon with protected control mapping, and returns public URL.
- `DELETE /frp/mappings/:id` rejects `http-control` with `409 CONFLICT`, deletes business mapping, rebuilds frpc daemon.

- [ ] **Step 6: Register FRP routes in control server**

Extend `StartOptions` in `server.ts` with:

```ts
apiBaseUrl: string;
serverToken: string;
frpcWorkDir?: string;
controlMapping?: { id: 'http-control'; remotePort: number; publicUrl: string };
```

Register:

```ts
registerFrpRoutes(router, { token: options.token, config: options });
```

- [ ] **Step 7: Run mapping tests**

Run:

```bash
pnpm --filter @rag/server test -- apps/server/src/modules/client-http/client-http-port.routes.test.ts apps/server/src/modules/frp/frp.service.test.ts
pnpm --filter @rag/client test -- apps/client/src/runtime/control-http/frp-routes.test.ts apps/client/src/runtime/frpc-daemon.test.ts
pnpm typecheck
```

Expected: pass.

- [ ] **Step 8: Commit**

```bash
git add apps/server/src/modules/client-http apps/server/src/main.ts apps/client/src/runtime/control-http apps/client/src/runtime/frpc-daemon.ts
git commit -m "feat: manage business frp mappings through client http"
```

---

## Task 9: Server Lightweight Admin Orchestration and Task Route Removal

**Files:**
- Create: `apps/server/src/modules/client-http/client-http-admin.service.ts`
- Create: `apps/server/src/modules/client-http/client-http-admin.routes.ts`
- Modify: `apps/server/src/main.ts`
- Modify: `apps/server/src/modules/agent/agent.routes.ts`
- Modify: `apps/server/src/modules/tasks/tasks.routes.ts`
- Modify: `apps/server/src/ws/ws-handlers.ts`
- Test: `apps/server/src/modules/client-http/client-http-admin.routes.test.ts`
- Test: `apps/server/src/ws/ws-handlers.test.ts`

- [ ] **Step 1: Write admin orchestration tests**

Create `apps/server/src/modules/client-http/client-http-admin.routes.test.ts`:

```ts
import { afterEach, describe, expect, it, vi } from 'vitest';

const fetchMock = vi.hoisted(() => vi.fn());
vi.stubGlobal('fetch', fetchMock);

describe('client HTTP admin routes', () => {
  afterEach(() => fetchMock.mockReset());

  it('calls client HTTP health with client token', async () => {
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({ ok: true, data: { status: 'ready' } }), { status: 200 }));
    const res = await app.inject({ method: 'GET', url: '/api/clients/client-1/http/health', headers: authHeaders });
    expect(res.statusCode).toBe(200);
    expect(fetchMock).toHaveBeenCalledWith('http://frps.example.com:20317/health', expect.objectContaining({
      headers: expect.objectContaining({ Authorization: 'Bearer client-token' }),
    }));
  });

  it('does not expose file or SSE proxy routes', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/clients/client-1/http/jobs/job-1/events', headers: authHeaders });
    expect(res.statusCode).toBe(404);
  });
});
```

- [ ] **Step 2: Run tests and confirm failure**

Run:

```bash
pnpm --filter @rag/server test -- apps/server/src/modules/client-http/client-http-admin.routes.test.ts
```

Expected: fail because admin routes do not exist.

- [ ] **Step 3: Implement admin service**

Create `apps/server/src/modules/client-http/client-http-admin.service.ts`:

```ts
import { env } from '../../config/env.js';
import { clientsService } from '../clients/clients.service.js';

export class ClientHttpAdminService {
  async request(clientId: string, input: { method: string; path: string; body?: unknown }): Promise<{ status: number; body: unknown }> {
    const client = clientsService.getClient(clientId);
    if (!client?.http_base_url || !client.http_token) {
      return { status: 409, body: { ok: false, error: { code: 'CLIENT_HTTP_UNAVAILABLE', message: 'Client HTTP endpoint is not ready' } } };
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), env.CLIENT_HTTP_REQUEST_TIMEOUT_MS);
    try {
      const response = await fetch(`${client.http_base_url}${input.path}`, {
        method: input.method,
        headers: {
          Authorization: `Bearer ${client.http_token}`,
          ...(input.body ? { 'Content-Type': 'application/json' } : {}),
        },
        body: input.body ? JSON.stringify(input.body) : undefined,
        signal: controller.signal,
      });
      const text = await response.text();
      let body: unknown = text;
      try { body = JSON.parse(text); } catch { body = text; }
      return { status: response.status, body };
    } catch {
      return { status: 502, body: { ok: false, error: { code: 'CLIENT_HTTP_UNREACHABLE', message: 'Failed to reach client HTTP endpoint' } } };
    } finally {
      clearTimeout(timer);
    }
  }
}

export const clientHttpAdminService = new ClientHttpAdminService();
```

- [ ] **Step 4: Implement allowed admin routes only**

Create `apps/server/src/modules/client-http/client-http-admin.routes.ts`:

```ts
import type { FastifyInstance } from 'fastify';
import { authMiddleware } from '../auth/auth.middleware.js';
import { auditService } from '../audit/audit.service.js';
import { clientHttpAdminService } from './client-http-admin.service.js';

export async function clientHttpAdminRoutes(app: FastifyInstance): Promise<void> {
  app.addHook('preHandler', authMiddleware);

  app.get<{ Params: { clientId: string } }>('/api/clients/:clientId/http/health', async (request, reply) => {
    const result = await clientHttpAdminService.request(request.params.clientId, { method: 'GET', path: '/health' });
    return reply.code(result.status).send(result.body);
  });

  app.get<{ Params: { clientId: string } }>('/api/clients/:clientId/http/frp/mappings', async (request, reply) => {
    const result = await clientHttpAdminService.request(request.params.clientId, { method: 'GET', path: '/frp/mappings' });
    return reply.code(result.status).send(result.body);
  });

  app.post<{ Params: { clientId: string }; Body: unknown }>('/api/clients/:clientId/http/frp/mappings', async (request, reply) => {
    const result = await clientHttpAdminService.request(request.params.clientId, { method: 'POST', path: '/frp/mappings', body: request.body });
    auditService.log({ actor: (request as unknown as { authRole: string }).authRole, action: 'client_http.frp_mapping.create', targetType: 'client', targetId: request.params.clientId });
    return reply.code(result.status).send(result.body);
  });

  app.delete<{ Params: { clientId: string; mappingId: string } }>('/api/clients/:clientId/http/frp/mappings/:mappingId', async (request, reply) => {
    const result = await clientHttpAdminService.request(request.params.clientId, { method: 'DELETE', path: `/frp/mappings/${encodeURIComponent(request.params.mappingId)}` });
    auditService.log({ actor: (request as unknown as { authRole: string }).authRole, action: 'client_http.frp_mapping.delete', targetType: 'port_mapping', targetId: request.params.mappingId });
    return reply.code(result.status).send(result.body);
  });
}
```

Register `clientHttpAdminRoutes` in `apps/server/src/main.ts`.

- [ ] **Step 5: Remove formal task route registration**

In `apps/server/src/main.ts`, remove registration of:

```ts
await app.register(taskRoutes);
await app.register(clientFilesRoutes);
await app.register(agentRoutes);
```

Keep `fileRoutes` only if server-side file upload storage remains useful for release artifacts. If no API uses it, remove it in a later cleanup commit after E2E passes.

In `ws-handlers.ts`, make `task.log` and `task.result` return an explicit error:

```ts
case 'task.log':
case 'task.result': {
  ws.send(JSON.stringify({ type: 'server.error', requestId: message.requestId, payload: { code: 'TASKS_DISABLED', message: 'Task WebSocket execution is disabled; use client HTTP jobs' } }));
  break;
}
```

- [ ] **Step 6: Run tests**

Run:

```bash
pnpm --filter @rag/server test -- apps/server/src/modules/client-http/client-http-admin.routes.test.ts apps/server/src/ws/ws-handlers.test.ts apps/server/src/modules/clients/clients.routes.test.ts
pnpm --filter @rag/server typecheck
```

Expected: pass; route tests for removed task APIs must be updated or removed in the same commit.

- [ ] **Step 7: Commit**

```bash
git add apps/server/src/main.ts apps/server/src/modules/client-http apps/server/src/ws/ws-handlers.ts apps/server/src/ws/ws-handlers.test.ts apps/server/src/modules/tasks apps/server/src/modules/agent
git commit -m "feat(server): route operations to client http discovery model"
```

---

## Task 10: React + Ant Design Admin App Scaffold and Build Integration

**Files:**
- Create: `apps/web/package.json`
- Create: `apps/web/tsconfig.json`
- Create: `apps/web/index.html`
- Create: `apps/web/vite.config.ts`
- Create: `apps/web/src/main.tsx`
- Create: `apps/web/src/App.tsx`
- Create: `apps/web/src/styles/theme.css`
- Modify: `scripts/build-all.ts`
- Modify: `apps/server/src/main.ts`
- Modify: `package.json`

- [ ] **Step 1: Add web package files**

Create `apps/web/package.json`:

```json
{
  "name": "@rag/web",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "vite",
    "build": "tsc --noEmit && vite build",
    "typecheck": "tsc --noEmit",
    "test": "vitest run"
  },
  "dependencies": {
    "@vitejs/plugin-react": "^4.3.4",
    "vite": "^6.0.0",
    "typescript": "^5.7.0",
    "react": "^19.0.0",
    "react-dom": "^19.0.0",
    "antd": "^5.22.0",
    "@ant-design/icons": "^5.5.0"
  },
  "devDependencies": {
    "@types/react": "^19.0.0",
    "@types/react-dom": "^19.0.0",
    "vitest": "^3.0.0",
    "jsdom": "^25.0.0"
  }
}
```

Create `apps/web/tsconfig.json`:

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "jsx": "react-jsx",
    "lib": ["ES2022", "DOM", "DOM.Iterable"],
    "types": ["vite/client", "vitest/globals"],
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "allowSyntheticDefaultImports": true
  },
  "include": ["src", "vite.config.ts"]
}
```

Create `apps/web/vite.config.ts`:

```ts
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  build: { outDir: 'dist', emptyOutDir: true },
  server: { port: 5174, proxy: { '/api': 'http://localhost:3000' } },
});
```

Create `apps/web/index.html`:

```html
<!doctype html>
<html lang="zh-CN">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Remote Agent Gateway</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/main.tsx"></script>
  </body>
</html>
```

Create minimal `main.tsx`, `App.tsx`, and `theme.css`:

```tsx
// apps/web/src/main.tsx
import React from 'react';
import { createRoot } from 'react-dom/client';
import 'antd/dist/reset.css';
import './styles/theme.css';
import { App } from './App';

createRoot(document.getElementById('root')!).render(<React.StrictMode><App /></React.StrictMode>);
```

```tsx
// apps/web/src/App.tsx
import { ConfigProvider, Result, theme } from 'antd';

export function App() {
  return (
    <ConfigProvider theme={{ algorithm: theme.darkAlgorithm }}>
      <Result status="success" title="Remote Agent Gateway" subTitle="React admin console is ready." />
    </ConfigProvider>
  );
}
```

```css
/* apps/web/src/styles/theme.css */
html, body, #root { margin: 0; min-height: 100%; background: #0f1117; }
```

- [ ] **Step 2: Install dependencies**

Run:

```bash
pnpm install
```

Expected: lockfile updates and `@rag/web` is part of workspace.

- [ ] **Step 3: Add root scripts**

Modify root `package.json` scripts:

```json
"dev:web": "pnpm --filter @rag/web dev",
"build:web": "pnpm --filter @rag/web build"
```

- [ ] **Step 4: Build web assets in distribution script**

Modify `scripts/build-all.ts` to build web before copying console:

```ts
import { execFileSync } from 'node:child_process';

console.log('[web] Building React admin console...');
execFileSync('pnpm', ['--filter', '@rag/web', 'build'], { cwd: ROOT, stdio: 'inherit', shell: process.platform === 'win32' });
const webBuildSrc = path.join(ROOT, 'apps', 'web', 'dist');
const webDst = path.join(DIST, 'web');
if (fs.existsSync(webBuildSrc)) {
  fs.rmSync(webDst, { recursive: true, force: true });
  fs.cpSync(webBuildSrc, webDst, { recursive: true });
  console.log('  Copied React web console');
}
```

Replace the old copy block that copies `apps/server/src/web` into `dist/web`.

- [ ] **Step 5: Serve SPA assets**

Modify `apps/server/src/main.ts` web-serving section:

```ts
const webDir = path.resolve(typeof __dirname !== 'undefined' ? __dirname : import.meta.dirname, 'web');
const webIndexPath = path.join(webDir, 'index.html');

function sendWebAsset(reply: any, filePath: string) {
  const ext = path.extname(filePath);
  const types: Record<string, string> = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png' };
  reply.header('Content-Type', types[ext] ?? 'application/octet-stream');
  return reply.send(fs.readFileSync(filePath));
}

app.get('/', async (_req, reply) => fs.existsSync(webIndexPath) ? sendWebAsset(reply, webIndexPath) : reply.redirect('/api/health'));
app.get('/admin', async (_req, reply) => reply.redirect('/'));
app.get('/assets/*', async (request, reply) => {
  const wildcard = (request.params as { '*': string })['*'];
  const filePath = path.resolve(webDir, 'assets', wildcard);
  if (!filePath.startsWith(path.resolve(webDir, 'assets')) || !fs.existsSync(filePath)) return reply.code(404).send('Not found');
  return sendWebAsset(reply, filePath);
});
```

- [ ] **Step 6: Run build checks**

Run:

```bash
pnpm --filter @rag/web build
pnpm build:dist
```

Expected: `apps/web/dist/index.html` exists and `dist/web/index.html` exists.

- [ ] **Step 7: Commit**

```bash
git add package.json pnpm-lock.yaml apps/web scripts/build-all.ts apps/server/src/main.ts
git commit -m "feat(web): scaffold react admin console"
```

---

## Task 11: React Admin Login, Layout, Dashboard, and Client Discovery Pages

**Files:**
- Create: `apps/web/src/api/http.ts`
- Create: `apps/web/src/api/clients.ts`
- Create: `apps/web/src/components/AppLayout.tsx`
- Create: `apps/web/src/components/StatusTag.tsx`
- Create: `apps/web/src/components/TokenLogin.tsx`
- Create: `apps/web/src/pages/DashboardPage.tsx`
- Create: `apps/web/src/pages/ClientsPage.tsx`
- Create: `apps/web/src/pages/ClientDetailPage.tsx`
- Modify: `apps/web/src/App.tsx`
- Test: `apps/web/src/api/http.test.ts`

- [ ] **Step 1: Write API helper test**

Create `apps/web/src/api/http.test.ts`:

```ts
import { describe, expect, it, vi } from 'vitest';
import { createApiClient } from './http';

it('sends bearer token and parses JSON', async () => {
  const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ ok: true }), { status: 200 }));
  const api = createApiClient({ baseUrl: 'http://server', getToken: () => 'admin-token', fetchImpl: fetchMock as any });
  const result = await api.get('/api/health');

  expect(fetchMock).toHaveBeenCalledWith('http://server/api/health', expect.objectContaining({ headers: { Authorization: 'Bearer admin-token' } }));
  expect(result).toEqual({ ok: true });
});
```

- [ ] **Step 2: Implement API helpers**

Create `apps/web/src/api/http.ts`:

```ts
export interface ApiClientOptions {
  baseUrl?: string;
  getToken: () => string;
  fetchImpl?: typeof fetch;
}

export function createApiClient(options: ApiClientOptions) {
  const fetcher = options.fetchImpl ?? fetch;
  const baseUrl = options.baseUrl ?? window.location.origin;

  async function request(method: string, path: string, body?: unknown) {
    const headers: Record<string, string> = { Authorization: `Bearer ${options.getToken()}` };
    const init: RequestInit = { method, headers };
    if (body !== undefined) {
      headers['Content-Type'] = 'application/json';
      init.body = JSON.stringify(body);
    }
    const res = await fetcher(`${baseUrl}${path}`, init);
    const text = await res.text();
    const data = text ? JSON.parse(text) : null;
    if (!res.ok) throw new Error(data?.error?.message ?? data?.error ?? `HTTP ${res.status}`);
    return data;
  }

  return {
    get: (path: string) => request('GET', path),
    post: (path: string, body?: unknown) => request('POST', path, body),
    delete: (path: string) => request('DELETE', path),
  };
}
```

Create `apps/web/src/api/clients.ts`:

```ts
import type { createApiClient } from './http';

export interface ClientSummary {
  id: string;
  name: string;
  online: boolean;
  status: string;
  httpReady: boolean;
  clientHttpBaseUrl?: string;
  clientHttpRemotePort?: number;
  capabilities?: Record<string, boolean>;
  lastSeenAt?: number;
}

export type Api = ReturnType<typeof createApiClient>;

export function listClients(api: Api): Promise<ClientSummary[]> {
  return api.get('/api/clients');
}

export function getClient(api: Api, clientId: string): Promise<ClientSummary & { clientHttpToken?: string }> {
  return api.get(`/api/clients/${encodeURIComponent(clientId)}`);
}
```

- [ ] **Step 3: Implement login and layout components**

Create `TokenLogin.tsx`, `AppLayout.tsx`, and `StatusTag.tsx` using Ant Design `Layout`, `Menu`, `Form`, `Input.Password`, `Button`, `Tag`.

`TokenLogin` props:

```ts
interface TokenLoginProps { onLogin: (token: string) => void }
```

`AppLayout` props:

```ts
interface AppLayoutProps { current: string; onNavigate: (key: string) => void; onLogout: () => void; children: React.ReactNode }
```

- [ ] **Step 4: Implement pages**

Dashboard should show:

- total clients.
- online clients.
- HTTP-ready clients.
- clients missing HTTP readiness.

Clients page should show table columns:

- ID.
- name.
- online.
- HTTP ready.
- client HTTP base URL.
- capabilities.
- actions: detail, mappings.

Client detail should show:

- discovery JSON.
- `clientHttpBaseUrl` copyable text.
- token visible only after clicking a reveal button.
- warning that direct file/SSE traffic does not go through server.

- [ ] **Step 5: Wire App state**

`App.tsx` should:

- read token from `localStorage.rag_token`.
- render `TokenLogin` when absent.
- create API client.
- navigate between `dashboard`, `clients`, `client-detail:<id>`, and `mappings:<id>` using React state.
- render Ant Design dark theme.

- [ ] **Step 6: Run web checks**

Run:

```bash
pnpm --filter @rag/web test
pnpm --filter @rag/web build
```

Expected: pass.

- [ ] **Step 7: Commit**

```bash
git add apps/web/src
git commit -m "feat(web): add client discovery admin pages"
```

---

## Task 12: React Admin Mapping Management

**Files:**
- Create: `apps/web/src/api/adminClientHttp.ts`
- Create: `apps/web/src/pages/MappingsPage.tsx`
- Modify: `apps/web/src/App.tsx`
- Test: `apps/web/src/api/adminClientHttp.test.ts`

- [ ] **Step 1: Write admin client HTTP API tests**

Create `apps/web/src/api/adminClientHttp.test.ts`:

```ts
import { describe, expect, it, vi } from 'vitest';
import { createApiClient } from './http';
import { listClientMappings } from './adminClientHttp';

it('loads mappings through lightweight server admin route', async () => {
  const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ ok: true, data: { mappings: [] } }), { status: 200 }));
  const api = createApiClient({ baseUrl: 'http://server', getToken: () => 'admin-token', fetchImpl: fetchMock as any });
  const result = await listClientMappings(api, 'client-1');

  expect(fetchMock).toHaveBeenCalledWith('http://server/api/clients/client-1/http/frp/mappings', expect.anything());
  expect(result).toEqual({ ok: true, data: { mappings: [] } });
});
```

- [ ] **Step 2: Implement admin client HTTP API module**

Create `apps/web/src/api/adminClientHttp.ts`:

```ts
import type { Api } from './clients';

export interface MappingCreateInput {
  name: string;
  type: 'tcp' | 'http' | 'https';
  localHost: string;
  localPort: number;
  remotePort?: number | null;
  customDomain?: string;
}

export function healthClientHttp(api: Api, clientId: string) {
  return api.get(`/api/clients/${encodeURIComponent(clientId)}/http/health`);
}

export function listClientMappings(api: Api, clientId: string) {
  return api.get(`/api/clients/${encodeURIComponent(clientId)}/http/frp/mappings`);
}

export function createClientMapping(api: Api, clientId: string, input: MappingCreateInput) {
  return api.post(`/api/clients/${encodeURIComponent(clientId)}/http/frp/mappings`, input);
}

export function deleteClientMapping(api: Api, clientId: string, mappingId: string) {
  return api.delete(`/api/clients/${encodeURIComponent(clientId)}/http/frp/mappings/${encodeURIComponent(mappingId)}`);
}
```

- [ ] **Step 3: Implement MappingsPage**

`MappingsPage.tsx` should:

- Load mappings via `listClientMappings`.
- Render Ant Design `Table` with `name`, `kind`, `type`, `localHost`, `localPort`, `remotePort`, `publicUrl`, `protected`.
- Disable delete button for protected mappings.
- Provide create modal with fields:
  - name.
  - type.
  - localHost default `127.0.0.1`.
  - localPort.
  - remotePort optional.
- On create/delete, call server lightweight admin route and reload table.

- [ ] **Step 4: Wire navigation**

In `ClientsPage`, add action button:

```tsx
<Button onClick={() => onOpenMappings(record.id)}>映射管理</Button>
```

In `App.tsx`, handle `mappings:<clientId>` route and render `MappingsPage`.

- [ ] **Step 5: Run web checks**

Run:

```bash
pnpm --filter @rag/web test
pnpm --filter @rag/web build
```

Expected: pass.

- [ ] **Step 6: Commit**

```bash
git add apps/web/src
git commit -m "feat(web): manage client frp mappings"
```

---

## Task 13: Docs, Config Examples, E2E, and Final Verification

**Files:**
- Modify: `README.md`
- Modify: `server.config.example.yaml`
- Modify: `client.config.example.yaml`
- Modify: `scripts/e2e-test.ts`
- Modify: `docs/superpowers/specs/2026-06-03-client-http-control-plane-design.md` only if implementation discovers a documented mismatch.

- [ ] **Step 1: Update server config example**

Add to `server.config.example.yaml`:

```yaml
clientHttp:
  tokenSecret: change-me-client-http-secret
  tokenVersion: 1
  requestTimeoutMs: 10000
```

- [ ] **Step 2: Update README architecture and API docs**

In `README.md`, replace task-centric operation docs with:

```markdown
### Client HTTP Control Endpoint

The server is the discovery and coordination plane. Client operations are performed by calling the client HTTP endpoint directly through FRP.

1. Discover a client:

```bash
curl -H "Authorization: Bearer $AGENT_TOKEN" \
  http://server:3000/api/clients/dev-client-01
```

2. Run a command directly on the client:

```bash
curl -H "Authorization: Bearer $CLIENT_HTTP_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"command":"node","args":["-v"]}' \
  http://frps-public-host:20317/jobs/command
```

3. Stream logs:

```bash
curl -N -H "Authorization: Bearer $CLIENT_HTTP_TOKEN" \
  -H "Accept: text/event-stream" \
  http://frps-public-host:20317/jobs/JOB_ID/events
```
```

Also document:

- server does not proxy files or SSE.
- `/api/clients` omits token.
- `/api/clients/:id` includes `clientHttpToken`.
- admin UI uses React and lightweight management APIs.

- [ ] **Step 3: Update E2E test path**

Modify `scripts/e2e-test.ts` to verify:

```text
1. Start server.
2. Start client.
3. Poll /api/clients/:id until httpReady is true.
4. Read clientHttpBaseUrl and clientHttpToken.
5. POST /jobs/command directly to client HTTP.
6. GET /jobs/:id/events and assert stdout/completed events.
7. PUT /files/write and GET /files/read directly through client HTTP.
8. POST /frp/mappings directly through client HTTP or through server lightweight admin route.
```

Use Node `fetch` and `AbortController` for SSE read timeout. Assert no `/api/tasks` call is used in the new E2E path.

- [ ] **Step 4: Run targeted tests**

Run:

```bash
pnpm --filter @rag/shared test
pnpm --filter @rag/server test
pnpm --filter @rag/client test
pnpm --filter @rag/web test
```

Expected: all pass.

- [ ] **Step 5: Run typecheck and builds**

Run:

```bash
pnpm typecheck
pnpm build
pnpm build:dist
```

Expected: all exit 0; `dist/server.bundle.cjs`, `dist/client.bundle.cjs`, and `dist/web/index.html` exist.

- [ ] **Step 6: Run E2E**

Run:

```bash
pnpm test:e2e
```

Expected: E2E output confirms client registration, `httpReady=true`, direct job execution, SSE output, direct file write/read, and mapping management.

- [ ] **Step 7: Commit**

```bash
git add README.md server.config.example.yaml client.config.example.yaml scripts/e2e-test.ts docs/superpowers/specs/2026-06-03-client-http-control-plane-design.md
git commit -m "docs: document client http control plane"
```

---

## Final Verification Checklist

Before reporting implementation completion, run:

```bash
pnpm --filter @rag/shared test
pnpm --filter @rag/server test
pnpm --filter @rag/client test
pnpm --filter @rag/web test
pnpm typecheck
pnpm build
pnpm build:dist
pnpm test:e2e
```

Required evidence:

- Shared/server/client/web tests exit 0.
- Typecheck exits 0.
- Build exits 0.
- Distribution build includes `dist/web/index.html`.
- E2E proves AI Agent can use `clientHttpBaseUrl + clientHttpToken` to run a job and receive SSE without calling `/api/tasks`.

---

## Plan Self-Review

Spec coverage:

- Sticky client HTTP remote port: Tasks 2, 3, 5.
- One `frpc` process: Tasks 5 and 8.
- Client HTTP job API and mandatory SSE: Task 6.
- Direct file API: Task 7.
- Business mappings through client HTTP with server-admin UI support: Tasks 8, 9, 12.
- Server discovery and token exposure: Tasks 2, 3, 9.
- Task route removal from formal flow: Task 9.
- React + Ant Design modular UI: Tasks 10, 11, 12.
- Docs and E2E: Task 13.

Completeness scan: no unfinished markers or undefined filler tasks are intentionally left in this plan.

Type consistency: plan uses `clientHttpBaseUrl`, `clientHttpToken`, `httpReady`, `httpControl`, `client.http_ready`, and `client.http_failed` consistently with the design spec.
