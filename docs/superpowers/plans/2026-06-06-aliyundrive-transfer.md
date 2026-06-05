# Aliyun Drive Transfer Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add server-coordinated Aliyun Drive relay uploads so `rag files upload` bypasses low-bandwidth frps for file bodies while preserving automatic fallback to the existing chunked upload path.

**Architecture:** Server owns Aliyun Drive app config, OAuth credentials, transfer jobs, event history, cleanup scheduling, and WebSocket download dispatch. CLI uploads file parts directly to Aliyun Drive and reports progress to server. Client receives a narrow WebSocket transfer command, downloads from Aliyun Drive, writes through allowed-root path checks, and reports progress back to server.

**Tech Stack:** TypeScript, Node.js 22 global `fetch`, Fastify, sql.js, Vitest, Commander, React 19, Ant Design 5 `QRCode`, existing WebSocket `ws` control plane.

---

## Scope and sequencing

This plan implements the spec in vertical slices. Each task should end with passing tests and a commit. Do not start implementation in the main worktree unless execution has created or selected an isolated branch/worktree according to the execution skill.

Use this spec as source of truth:

```text
docs/superpowers/specs/2026-06-06-aliyundrive-transfer-design.md
```

---

## File structure

### Shared contracts

- Modify `packages/shared/src/types.ts`
  - Transfer mode/status/phase/event interfaces.
  - Aliyun Drive config/status public API shapes.
  - WebSocket transfer message payloads.
- Modify `packages/shared/src/protocol.ts`
  - Add `transfer.download.start` server message.
  - Add `client.transfer.progress`, `client.transfer.complete`, `client.transfer.failed` client messages.
- Modify `packages/shared/src/schemas.ts`
  - Zod schemas for new WebSocket payloads.
- Modify `packages/shared/src/index.ts`
  - Export new types/schemas.
- Add tests in `packages/shared/src/__tests__/transfer-contracts.test.ts`.

### Server persistence and services

- Modify `apps/server/src/db/migrate.ts`
  - Add `aliyundrive_config`, `aliyundrive_auth`, `transfer_jobs`, `transfer_events` tables and indexes.
- Create `apps/server/src/modules/aliyundrive/aliyundrive-types.ts`
  - Internal Aliyun config/auth/openapi types.
- Create `apps/server/src/modules/aliyundrive/aliyundrive-auth.service.ts`
  - Config/auth CRUD, OAuth URL generation, token exchange, status masking.
- Create `apps/server/src/modules/aliyundrive/aliyundrive-openapi.client.ts`
  - OpenAPI fetch wrapper and drive/file operations.
- Create `apps/server/src/modules/aliyundrive/aliyundrive.routes.ts`
  - `/api/aliyundrive/*` routes.
- Create `apps/server/src/modules/transfers/transfer-state.ts`
  - State constants, validation helpers, sanitization helpers.
- Create `apps/server/src/modules/transfers/transfer.service.ts`
  - Transfer job creation, progress updates, Aliyun upload plan creation, client dispatch, completion/failure.
- Create `apps/server/src/modules/transfers/transfer.routes.ts`
  - `/api/transfers/*` routes.
- Create `apps/server/src/modules/transfers/transfer-cleanup.service.ts`
  - TTL cleanup scan/delete.
- Modify `apps/server/src/ws/ws-handlers.ts`
  - Accept client transfer progress/complete/failure WebSocket messages.
- Modify `apps/server/src/main.ts`
  - Register new routes and start cleanup timer.
- Add server tests in relevant `*.test.ts` files under the two new module directories.

### CLI

- Modify `apps/cli/src/http/server-api.ts`
  - Add transfer endpoints.
- Create `apps/cli/src/http/aliyundrive-upload.ts`
  - Stream local file parts to Aliyun upload URLs, refresh expired URLs, complete upload.
- Modify `apps/cli/src/commands/files.ts`
  - Add `--transfer auto|aliyundrive|direct` and integrate new flow.
- Add CLI tests in `apps/cli/src/http/aliyundrive-upload.test.ts` and existing command tests.

### Client

- Create `apps/client/src/runtime/transfers/aliyundrive-download-executor.ts`
  - Fetch transfer detail, download stream, allowed-root write, progress report.
- Create `apps/client/src/runtime/transfers/transfer-ws-handler.ts`
  - Handle `transfer.download.start` message.
- Modify `apps/client/src/runtime/control-http/server.ts`
  - Pass `apiBaseUrl`, `serverToken`, roots into optional debug route registration.
- Create `apps/client/src/runtime/control-http/transfer-routes.ts`
  - Debug/backup HTTP trigger `POST /files/aliyundrive-download`.
- Modify `apps/client/src/main.ts`
  - Wire transfer WebSocket handler.
- Add client tests under `apps/client/src/runtime/transfers/*.test.ts`.

### Web

- Modify `apps/web/src/api/http.ts`
  - Ensure API helper supports typed JSON calls if needed.
- Create `apps/web/src/api/aliyundrive.ts`
  - Config/status/oauth/transfer API helpers.
- Create `apps/web/src/pages/AliyunDrivePage.tsx`
  - Config form, QR auth, code submission, status, transfer table.
- Add `apps/web/src/pages/AliyunDrivePage.test.tsx`.
- Modify `apps/web/src/components/AppLayout.tsx`
  - Add sidebar item.
- Modify `apps/web/src/App.tsx`
  - Add route.

### Docs and validation

- Modify `README.md` and `docs/TESTING.md` if command behavior or test instructions change.
- Run package tests, typechecks, and full workspace verification.

---

## Task 1: Shared transfer contracts and WebSocket protocol

**Files:**
- Modify: `packages/shared/src/types.ts`
- Modify: `packages/shared/src/protocol.ts`
- Modify: `packages/shared/src/schemas.ts`
- Modify: `packages/shared/src/index.ts`
- Test: `packages/shared/src/__tests__/transfer-contracts.test.ts`

- [ ] **Step 1: Write failing shared contract tests**

Create `packages/shared/src/__tests__/transfer-contracts.test.ts` with:

```ts
import { describe, expect, it } from 'vitest';
import {
  ClientTransferCompletePayloadSchema,
  ClientTransferFailedPayloadSchema,
  ClientTransferProgressPayloadSchema,
  ServerTransferDownloadStartPayloadSchema,
} from '../schemas.js';

const transferId = 'tr_123';

const baseProgress = {
  transferId,
  clientId: 'client-1',
  phase: 'client_downloading',
  downloadedBytes: 512,
  writtenBytes: 256,
  totalBytes: 1024,
  message: 'downloading',
};

describe('transfer websocket schemas', () => {
  it('accepts server download start payload', () => {
    const parsed = ServerTransferDownloadStartPayloadSchema.parse({ transferId, clientId: 'client-1' });
    expect(parsed.transferId).toBe(transferId);
  });

  it('accepts client progress payload', () => {
    const parsed = ClientTransferProgressPayloadSchema.parse(baseProgress);
    expect(parsed.downloadedBytes).toBe(512);
  });

  it('rejects negative transfer progress bytes', () => {
    expect(() => ClientTransferProgressPayloadSchema.parse({ ...baseProgress, downloadedBytes: -1 })).toThrow();
  });

  it('accepts client completion payload', () => {
    const parsed = ClientTransferCompletePayloadSchema.parse({
      transferId,
      clientId: 'client-1',
      rootId: 'workspace',
      path: 'drop/app.zip',
      size: 1024,
    });
    expect(parsed.path).toBe('drop/app.zip');
  });

  it('accepts client failure payload', () => {
    const parsed = ClientTransferFailedPayloadSchema.parse({
      transferId,
      clientId: 'client-1',
      errorCode: 'DOWNLOAD_FAILED',
      errorMessage: 'network reset',
    });
    expect(parsed.errorCode).toBe('DOWNLOAD_FAILED');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```bash
pnpm --filter @rag/shared test -- transfer-contracts.test.ts
```

Expected: FAIL because the transfer schemas are not exported.

- [ ] **Step 3: Add shared transfer types**

Append to `packages/shared/src/types.ts`:

```ts
export type TransferMode = 'aliyundrive' | 'frps_chunked';

export type TransferStatus =
  | 'created'
  | 'waiting_cli_upload'
  | 'cli_uploading'
  | 'aliyun_uploaded'
  | 'waiting_client_download'
  | 'client_downloading'
  | 'completed'
  | 'failed'
  | 'cancelled';

export type TransferCleanupStatus = 'none' | 'cleanup_pending' | 'cleanup_done' | 'cleanup_failed';

export interface ServerTransferDownloadStartPayload {
  transferId: string;
  clientId: string;
}

export interface ClientTransferProgressPayload {
  transferId: string;
  clientId: string;
  phase: TransferStatus;
  downloadedBytes?: number;
  writtenBytes?: number;
  totalBytes: number;
  message?: string;
}

export interface ClientTransferCompletePayload {
  transferId: string;
  clientId: string;
  rootId: string;
  path: string;
  size: number;
}

export interface ClientTransferFailedPayload {
  transferId: string;
  clientId: string;
  errorCode: string;
  errorMessage: string;
}

export interface AliyunDrivePublicStatus {
  configured: boolean;
  authorized: boolean;
  clientId?: string;
  scope?: string;
  openapiBase?: string;
  redirectUri?: string;
  transferFolder?: string;
  cleanupTtlMs?: number;
  expiresAt?: number;
  driveId?: string;
  authorizedAccountName?: string;
}

export interface TransferJobView {
  id: string;
  clientId: string;
  rootId: string;
  targetDir: string;
  filename: string;
  size: number;
  mode: TransferMode;
  status: TransferStatus;
  cleanupStatus: TransferCleanupStatus;
  uploadedBytes: number;
  downloadedBytes: number;
  writtenBytes: number;
  totalBytes: number;
  errorCode?: string | null;
  errorMessage?: string | null;
  createdAt: number;
  updatedAt: number;
  completedAt?: number | null;
  cleanupAfterAt?: number | null;
}
```

- [ ] **Step 4: Add protocol message types**

Modify `packages/shared/src/protocol.ts`:

```ts
import type {
  ClientInfo,
  ClientHttpControl,
  ClientHttpReadyPayload,
  ClientHttpFailedPayload,
  ServerTransferDownloadStartPayload,
  ClientTransferProgressPayload,
  ClientTransferCompletePayload,
  ClientTransferFailedPayload,
} from './types.js';

export type ClientMessageType =
  | 'client.register'
  | 'client.heartbeat'
  | 'client.http_ready'
  | 'client.http_failed'
  | 'client.transfer.progress'
  | 'client.transfer.complete'
  | 'client.transfer.failed';

export type ServerMessageType =
  | 'server.ack'
  | 'server.error'
  | 'transfer.download.start';
```

Then add these type aliases near the existing message aliases:

```ts
export type ServerTransferDownloadStartMessage = WsMessage<'transfer.download.start', ServerTransferDownloadStartPayload>;
export type ClientTransferProgressMessage = WsMessage<'client.transfer.progress', ClientTransferProgressPayload>;
export type ClientTransferCompleteMessage = WsMessage<'client.transfer.complete', ClientTransferCompletePayload>;
export type ClientTransferFailedMessage = WsMessage<'client.transfer.failed', ClientTransferFailedPayload>;
```

Update the `ClientMessage` union to include the three client transfer message types, and update `ServerMessage` to include `ServerTransferDownloadStartMessage`.

- [ ] **Step 5: Add zod schemas**

Append to `packages/shared/src/schemas.ts` before the export block:

```ts
export const TransferStatusSchema = z.enum([
  'created',
  'waiting_cli_upload',
  'cli_uploading',
  'aliyun_uploaded',
  'waiting_client_download',
  'client_downloading',
  'completed',
  'failed',
  'cancelled',
]);

export const ServerTransferDownloadStartPayloadSchema = z.object({
  transferId: z.string().min(1).max(128),
  clientId: z.string().min(1).max(128),
});

export const ClientTransferProgressPayloadSchema = z.object({
  transferId: z.string().min(1).max(128),
  clientId: z.string().min(1).max(128),
  phase: TransferStatusSchema,
  downloadedBytes: z.number().int().min(0).optional(),
  writtenBytes: z.number().int().min(0).optional(),
  totalBytes: z.number().int().min(0),
  message: z.string().max(512).optional(),
});

export const ClientTransferCompletePayloadSchema = z.object({
  transferId: z.string().min(1).max(128),
  clientId: z.string().min(1).max(128),
  rootId: ClientFileRootIdSchema,
  path: RelativeClientPathSchema,
  size: z.number().int().min(0),
});

export const ClientTransferFailedPayloadSchema = z.object({
  transferId: z.string().min(1).max(128),
  clientId: z.string().min(1).max(128),
  errorCode: z.string().min(1).max(128),
  errorMessage: z.string().min(1).max(2048),
});
```

- [ ] **Step 6: Ensure exports are available**

If `packages/shared/src/index.ts` does not already export all shared modules, set it to:

```ts
export * from './types.js';
export * from './protocol.js';
export * from './schemas.js';
export * from './task-audit.js';
```

- [ ] **Step 7: Run shared tests and typecheck**

Run:

```bash
pnpm --filter @rag/shared test
pnpm --filter @rag/shared typecheck
```

Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add packages/shared/src/types.ts packages/shared/src/protocol.ts packages/shared/src/schemas.ts packages/shared/src/index.ts packages/shared/src/__tests__/transfer-contracts.test.ts
git commit -m "feat(shared): add transfer protocol contracts"
```

---

## Task 2: Server DB migration and transfer state helpers

**Files:**
- Modify: `apps/server/src/db/migrate.ts`
- Create: `apps/server/src/modules/transfers/transfer-state.ts`
- Test: `apps/server/src/modules/transfers/transfer-state.test.ts`

- [ ] **Step 1: Write failing state helper tests**

Create `apps/server/src/modules/transfers/transfer-state.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { assertTransferTransition, sanitizeTransferEventPayload } from './transfer-state.js';

describe('transfer-state', () => {
  it('allows the normal aliyundrive upload path', () => {
    expect(() => assertTransferTransition('waiting_cli_upload', 'cli_uploading')).not.toThrow();
    expect(() => assertTransferTransition('cli_uploading', 'aliyun_uploaded')).not.toThrow();
    expect(() => assertTransferTransition('aliyun_uploaded', 'waiting_client_download')).not.toThrow();
    expect(() => assertTransferTransition('waiting_client_download', 'client_downloading')).not.toThrow();
    expect(() => assertTransferTransition('client_downloading', 'completed')).not.toThrow();
  });

  it('rejects invalid forward jumps', () => {
    expect(() => assertTransferTransition('waiting_cli_upload', 'completed')).toThrow('Invalid transfer transition');
  });

  it('allows failure from active states', () => {
    expect(() => assertTransferTransition('client_downloading', 'failed')).not.toThrow();
  });

  it('redacts credentials and signed urls from event payloads', () => {
    const sanitized = sanitizeTransferEventPayload({
      accessToken: 'secret',
      refresh_token: 'refresh',
      upload_url: 'https://upload.example/signature',
      downloadUrl: 'https://download.example/signature',
      safe: 'visible',
    });
    expect(sanitized).toEqual({
      accessToken: '[redacted]',
      refresh_token: '[redacted]',
      upload_url: '[redacted]',
      downloadUrl: '[redacted]',
      safe: 'visible',
    });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
pnpm --filter @rag/server test -- transfer-state.test.ts
```

Expected: FAIL because `transfer-state.ts` does not exist.

- [ ] **Step 3: Implement state helper**

Create `apps/server/src/modules/transfers/transfer-state.ts`:

```ts
import type { TransferStatus } from '@rag/shared';

const allowedTransitions: Record<TransferStatus, TransferStatus[]> = {
  created: ['waiting_cli_upload', 'failed', 'cancelled'],
  waiting_cli_upload: ['cli_uploading', 'failed', 'cancelled'],
  cli_uploading: ['aliyun_uploaded', 'failed', 'cancelled'],
  aliyun_uploaded: ['waiting_client_download', 'failed', 'cancelled'],
  waiting_client_download: ['client_downloading', 'failed', 'cancelled'],
  client_downloading: ['completed', 'failed', 'cancelled'],
  completed: [],
  failed: [],
  cancelled: [],
};

const secretKeyPattern = /(token|authorization|upload_url|download_url|downloadurl|uploadurl|secret)/i;

export function assertTransferTransition(from: TransferStatus, to: TransferStatus): void {
  if (!allowedTransitions[from]?.includes(to)) {
    throw new Error(`Invalid transfer transition: ${from} -> ${to}`);
  }
}

export function sanitizeTransferEventPayload(value: unknown): unknown {
  if (Array.isArray(value)) return value.map((item) => sanitizeTransferEventPayload(item));
  if (!value || typeof value !== 'object') return value;
  const result: Record<string, unknown> = {};
  for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
    result[key] = secretKeyPattern.test(key) ? '[redacted]' : sanitizeTransferEventPayload(child);
  }
  return result;
}
```

- [ ] **Step 4: Add DB migration**

Modify `apps/server/src/db/migrate.ts` inside the main `db.run` block after `audit_logs`:

```sql

    CREATE TABLE IF NOT EXISTS aliyundrive_config (
      id TEXT PRIMARY KEY,
      client_id TEXT NOT NULL,
      client_secret TEXT,
      scope TEXT NOT NULL,
      openapi_base TEXT NOT NULL,
      redirect_uri TEXT NOT NULL,
      transfer_folder TEXT NOT NULL,
      cleanup_ttl_ms INTEGER NOT NULL,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS aliyundrive_auth (
      id TEXT PRIMARY KEY,
      access_token TEXT NOT NULL,
      refresh_token TEXT,
      token_type TEXT,
      expires_at INTEGER NOT NULL,
      drive_id TEXT,
      authorized_account_name TEXT,
      updated_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS transfer_jobs (
      id TEXT PRIMARY KEY,
      client_id TEXT NOT NULL,
      root_id TEXT NOT NULL,
      target_dir TEXT NOT NULL,
      filename TEXT NOT NULL,
      size INTEGER NOT NULL,
      sha256 TEXT,
      mode TEXT NOT NULL,
      status TEXT NOT NULL,
      phase TEXT NOT NULL,
      error_code TEXT,
      error_message TEXT,
      aliyun_drive_id TEXT,
      aliyun_file_id TEXT,
      aliyun_upload_id TEXT,
      aliyun_parent_file_id TEXT,
      aliyun_file_name TEXT,
      uploaded_bytes INTEGER NOT NULL DEFAULT 0,
      downloaded_bytes INTEGER NOT NULL DEFAULT 0,
      written_bytes INTEGER NOT NULL DEFAULT 0,
      total_bytes INTEGER NOT NULL,
      part_count INTEGER,
      current_part INTEGER,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      completed_at INTEGER,
      cleanup_after_at INTEGER,
      cleanup_status TEXT NOT NULL DEFAULT 'none'
    );

    CREATE TABLE IF NOT EXISTS transfer_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      transfer_id TEXT NOT NULL,
      source TEXT NOT NULL,
      type TEXT NOT NULL,
      message TEXT NOT NULL,
      payload TEXT,
      created_at INTEGER NOT NULL
    );
```

Then add indexes after the existing `task_history` index block:

```ts
  db.run(`
    CREATE INDEX IF NOT EXISTS idx_transfer_jobs_client_id ON transfer_jobs(client_id);
    CREATE INDEX IF NOT EXISTS idx_transfer_jobs_updated_at ON transfer_jobs(updated_at DESC);
    CREATE INDEX IF NOT EXISTS idx_transfer_jobs_cleanup_after_at ON transfer_jobs(cleanup_after_at);
    CREATE INDEX IF NOT EXISTS idx_transfer_events_transfer_id ON transfer_events(transfer_id, created_at ASC);
  `);
```

- [ ] **Step 5: Run server tests**

```bash
pnpm --filter @rag/server test -- transfer-state.test.ts
pnpm --filter @rag/server typecheck
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/server/src/db/migrate.ts apps/server/src/modules/transfers/transfer-state.ts apps/server/src/modules/transfers/transfer-state.test.ts
git commit -m "feat(server): add transfer persistence schema"
```

---

## Task 3: Aliyun Drive auth/config services and routes

**Files:**
- Create: `apps/server/src/modules/aliyundrive/aliyundrive-types.ts`
- Create: `apps/server/src/modules/aliyundrive/aliyundrive-auth.service.ts`
- Create: `apps/server/src/modules/aliyundrive/aliyundrive.routes.ts`
- Modify: `apps/server/src/main.ts`
- Test: `apps/server/src/modules/aliyundrive/aliyundrive-auth.service.test.ts`
- Test: `apps/server/src/modules/aliyundrive/aliyundrive.routes.test.ts`

- [ ] **Step 1: Write failing auth service tests**

Create `apps/server/src/modules/aliyundrive/aliyundrive-auth.service.test.ts`:

```ts
import { beforeEach, describe, expect, it, vi } from 'vitest';

const rows = new Map<string, Record<string, unknown>>();

vi.mock('../../db/index.js', () => ({
  getDb: () => ({
    prepare: (sql: string) => ({
      bind: vi.fn(),
      step: vi.fn(() => false),
      getAsObject: vi.fn(() => ({})),
      free: vi.fn(),
    }),
    run: vi.fn((sql: string, params?: unknown[]) => {
      rows.set(sql, { params });
    }),
  }),
  saveDb: vi.fn(),
}));

import { AliyunDriveAuthService, buildCodeChallenge } from './aliyundrive-auth.service.js';

describe('AliyunDriveAuthService', () => {
  beforeEach(() => rows.clear());

  it('builds S256 code challenge', () => {
    expect(buildCodeChallenge('abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUV')).toMatch(/^[A-Za-z0-9_-]+$/);
  });

  it('builds an authorization URL with OOB redirect', async () => {
    const service = new AliyunDriveAuthService({
      fetchImpl: vi.fn() as any,
      now: () => 1000,
      randomString: () => 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUV',
    });
    const result = await service.startOAuth({
      clientId: 'app-id',
      scope: 'user:base,file:all:read,file:all:write',
      openapiBase: 'https://openapi.alipan.com',
      redirectUri: 'oob',
      transferFolder: 'RemoteAgentGatewayTransfers',
      cleanupTtlMs: 86_400_000,
    });
    expect(result.authorizationUrl).toContain('https://openapi.alipan.com/oauth/authorize');
    expect(result.authorizationUrl).toContain('client_id=app-id');
    expect(result.authorizationUrl).toContain('redirect_uri=oob');
    expect(result.authorizationUrl).toContain('code_challenge_method=S256');
    expect(result.state).toHaveLength(32);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
pnpm --filter @rag/server test -- aliyundrive-auth.service.test.ts
```

Expected: FAIL because service files do not exist.

- [ ] **Step 3: Add internal types**

Create `apps/server/src/modules/aliyundrive/aliyundrive-types.ts`:

```ts
export interface AliyunDriveConfigRecord {
  id: 'default';
  clientId: string;
  clientSecret?: string | null;
  scope: string;
  openapiBase: string;
  redirectUri: string;
  transferFolder: string;
  cleanupTtlMs: number;
  createdAt: number;
  updatedAt: number;
}

export interface AliyunDriveAuthRecord {
  id: 'default';
  accessToken: string;
  refreshToken?: string | null;
  tokenType?: string | null;
  expiresAt: number;
  driveId?: string | null;
  authorizedAccountName?: string | null;
  updatedAt: number;
}

export interface AliyunOAuthSession {
  state: string;
  verifier: string;
  config: AliyunDriveConfigRecord;
  expiresAt: number;
}
```

- [ ] **Step 4: Implement auth service**

Create `apps/server/src/modules/aliyundrive/aliyundrive-auth.service.ts` with these exports and behavior:

```ts
import { createHash, randomBytes } from 'node:crypto';
import { getDb, saveDb } from '../../db/index.js';
import type { AliyunDriveAuthRecord, AliyunDriveConfigRecord, AliyunOAuthSession } from './aliyundrive-types.js';

const DEFAULT_ID = 'default';
const DEFAULT_SCOPE = 'user:base,file:all:read,file:all:write';
const DEFAULT_OPENAPI_BASE = 'https://openapi.alipan.com';
const DEFAULT_REDIRECT_URI = 'oob';
const DEFAULT_TRANSFER_FOLDER = 'RemoteAgentGatewayTransfers';
const DEFAULT_CLEANUP_TTL_MS = 24 * 60 * 60 * 1000;

export function buildCodeVerifier(randomString = randomBytes(48).toString('base64url')): string {
  return randomString.replace(/[^A-Za-z0-9]/g, '').slice(0, 96).padEnd(43, 'A');
}

export function buildCodeChallenge(verifier: string): string {
  return createHash('sha256').update(verifier, 'ascii').digest('base64url');
}

export class AliyunDriveAuthService {
  private oauthSessions = new Map<string, AliyunOAuthSession>();

  constructor(private readonly deps: {
    fetchImpl?: typeof fetch;
    now?: () => number;
    randomString?: () => string;
  } = {}) {}

  private now(): number { return this.deps.now?.() ?? Date.now(); }
  private fetchImpl(): typeof fetch { return this.deps.fetchImpl ?? fetch; }

  getDefaultConfig(input: Partial<Omit<AliyunDriveConfigRecord, 'id' | 'createdAt' | 'updatedAt'>> = {}): AliyunDriveConfigRecord {
    const now = this.now();
    return {
      id: DEFAULT_ID,
      clientId: input.clientId ?? '',
      clientSecret: input.clientSecret ?? null,
      scope: input.scope ?? DEFAULT_SCOPE,
      openapiBase: (input.openapiBase ?? DEFAULT_OPENAPI_BASE).replace(/\/+$/, ''),
      redirectUri: input.redirectUri ?? DEFAULT_REDIRECT_URI,
      transferFolder: input.transferFolder ?? DEFAULT_TRANSFER_FOLDER,
      cleanupTtlMs: input.cleanupTtlMs ?? DEFAULT_CLEANUP_TTL_MS,
      createdAt: now,
      updatedAt: now,
    };
  }

  saveConfig(input: Partial<Omit<AliyunDriveConfigRecord, 'id' | 'createdAt' | 'updatedAt'>> & { clientId: string }): AliyunDriveConfigRecord {
    if (!input.clientId.trim()) throw new Error('clientId is required');
    const now = this.now();
    const existing = this.getConfig();
    const record: AliyunDriveConfigRecord = {
      id: DEFAULT_ID,
      clientId: input.clientId.trim(),
      clientSecret: input.clientSecret ?? existing?.clientSecret ?? null,
      scope: input.scope ?? existing?.scope ?? DEFAULT_SCOPE,
      openapiBase: (input.openapiBase ?? existing?.openapiBase ?? DEFAULT_OPENAPI_BASE).replace(/\/+$/, ''),
      redirectUri: input.redirectUri ?? existing?.redirectUri ?? DEFAULT_REDIRECT_URI,
      transferFolder: input.transferFolder ?? existing?.transferFolder ?? DEFAULT_TRANSFER_FOLDER,
      cleanupTtlMs: input.cleanupTtlMs ?? existing?.cleanupTtlMs ?? DEFAULT_CLEANUP_TTL_MS,
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
    };
    getDb().run(
      `INSERT OR REPLACE INTO aliyundrive_config (id, client_id, client_secret, scope, openapi_base, redirect_uri, transfer_folder, cleanup_ttl_ms, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [record.id, record.clientId, record.clientSecret ?? null, record.scope, record.openapiBase, record.redirectUri, record.transferFolder, record.cleanupTtlMs, record.createdAt, record.updatedAt],
    );
    saveDb();
    return record;
  }

  getConfig(): AliyunDriveConfigRecord | null {
    const stmt = getDb().prepare('SELECT * FROM aliyundrive_config WHERE id = ?');
    stmt.bind([DEFAULT_ID]);
    try {
      if (!stmt.step()) return null;
      const row = stmt.getAsObject() as Record<string, unknown>;
      return {
        id: DEFAULT_ID,
        clientId: String(row.client_id),
        clientSecret: row.client_secret == null ? null : String(row.client_secret),
        scope: String(row.scope),
        openapiBase: String(row.openapi_base),
        redirectUri: String(row.redirect_uri),
        transferFolder: String(row.transfer_folder),
        cleanupTtlMs: Number(row.cleanup_ttl_ms),
        createdAt: Number(row.created_at),
        updatedAt: Number(row.updated_at),
      };
    } finally {
      stmt.free();
    }
  }

  getAuth(): AliyunDriveAuthRecord | null {
    const stmt = getDb().prepare('SELECT * FROM aliyundrive_auth WHERE id = ?');
    stmt.bind([DEFAULT_ID]);
    try {
      if (!stmt.step()) return null;
      const row = stmt.getAsObject() as Record<string, unknown>;
      return {
        id: DEFAULT_ID,
        accessToken: String(row.access_token),
        refreshToken: row.refresh_token == null ? null : String(row.refresh_token),
        tokenType: row.token_type == null ? 'Bearer' : String(row.token_type),
        expiresAt: Number(row.expires_at),
        driveId: row.drive_id == null ? null : String(row.drive_id),
        authorizedAccountName: row.authorized_account_name == null ? null : String(row.authorized_account_name),
        updatedAt: Number(row.updated_at),
      };
    } finally {
      stmt.free();
    }
  }

  getStatus() {
    const config = this.getConfig();
    const auth = this.getAuth();
    return {
      configured: Boolean(config?.clientId),
      authorized: Boolean(auth?.accessToken && auth.expiresAt > this.now() + 300_000),
      clientId: config?.clientId,
      scope: config?.scope,
      openapiBase: config?.openapiBase,
      redirectUri: config?.redirectUri,
      transferFolder: config?.transferFolder,
      cleanupTtlMs: config?.cleanupTtlMs,
      expiresAt: auth?.expiresAt,
      driveId: auth?.driveId ?? undefined,
      authorizedAccountName: auth?.authorizedAccountName ?? undefined,
    };
  }

  async startOAuth(configInput?: Partial<AliyunDriveConfigRecord> & { clientId: string }) {
    const config = configInput ? this.saveConfig(configInput) : this.getConfig();
    if (!config?.clientId) throw new Error('Aliyun Drive client_id is not configured');
    const verifier = buildCodeVerifier(this.deps.randomString?.());
    const state = randomBytes(16).toString('hex');
    const url = new URL(`${config.openapiBase}/oauth/authorize`);
    url.searchParams.set('client_id', config.clientId);
    url.searchParams.set('redirect_uri', config.redirectUri);
    url.searchParams.set('scope', config.scope);
    url.searchParams.set('response_type', 'code');
    url.searchParams.set('state', state);
    url.searchParams.set('code_challenge', buildCodeChallenge(verifier));
    url.searchParams.set('code_challenge_method', 'S256');
    this.oauthSessions.set(state, { state, verifier, config, expiresAt: this.now() + 10 * 60 * 1000 });
    return { state, authorizationUrl: url.toString(), expiresAt: this.now() + 10 * 60 * 1000 };
  }

  async completeOAuth(input: { state: string; code: string }) {
    const session = this.oauthSessions.get(input.state);
    if (!session || session.expiresAt < this.now()) throw new Error('OAuth session expired');
    const payload: Record<string, string> = {
      client_id: session.config.clientId,
      grant_type: 'authorization_code',
      code: input.code.trim(),
      code_verifier: session.verifier,
    };
    if (session.config.clientSecret) payload.client_secret = session.config.clientSecret;
    const response = await this.fetchImpl()(`${session.config.openapiBase}/oauth/access_token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    if (!response.ok) throw new Error(`Aliyun token exchange failed: HTTP ${response.status} ${await response.text()}`);
    const data = await response.json() as { access_token: string; refresh_token?: string; token_type?: string; expires_in: number };
    const record: AliyunDriveAuthRecord = {
      id: DEFAULT_ID,
      accessToken: data.access_token,
      refreshToken: data.refresh_token ?? null,
      tokenType: data.token_type ?? 'Bearer',
      expiresAt: this.now() + Number(data.expires_in) * 1000,
      driveId: null,
      authorizedAccountName: null,
      updatedAt: this.now(),
    };
    this.saveAuth(record);
    this.oauthSessions.delete(input.state);
    return this.getStatus();
  }

  saveAuth(record: AliyunDriveAuthRecord): void {
    getDb().run(
      `INSERT OR REPLACE INTO aliyundrive_auth (id, access_token, refresh_token, token_type, expires_at, drive_id, authorized_account_name, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [record.id, record.accessToken, record.refreshToken ?? null, record.tokenType ?? 'Bearer', record.expiresAt, record.driveId ?? null, record.authorizedAccountName ?? null, record.updatedAt],
    );
    saveDb();
  }

  revoke(): void {
    getDb().run('DELETE FROM aliyundrive_auth WHERE id = ?', [DEFAULT_ID]);
    saveDb();
  }
}

export const aliyunDriveAuthService = new AliyunDriveAuthService();
```

- [ ] **Step 5: Write route tests**

Create `apps/server/src/modules/aliyundrive/aliyundrive.routes.test.ts`:

```ts
import { describe, expect, it, vi } from 'vitest';
import Fastify from 'fastify';
import { aliyunDriveRoutes } from './aliyundrive.routes.js';

vi.mock('../auth/auth.middleware.js', () => ({
  authMiddleware: async (request: unknown) => { (request as { authRole?: string }).authRole = 'admin'; },
}));

vi.mock('./aliyundrive-auth.service.js', () => ({
  aliyunDriveAuthService: {
    getStatus: vi.fn(() => ({ configured: false, authorized: false })),
    saveConfig: vi.fn((input) => ({ id: 'default', ...input, createdAt: 1, updatedAt: 2 })),
    startOAuth: vi.fn(async () => ({ state: 'state-1', authorizationUrl: 'https://openapi.alipan.com/oauth/authorize?client_id=app', expiresAt: 123 })),
    completeOAuth: vi.fn(async () => ({ configured: true, authorized: true })),
    revoke: vi.fn(),
  },
}));

describe('aliyunDriveRoutes', () => {
  it('returns status', async () => {
    const app = Fastify();
    await app.register(aliyunDriveRoutes);
    const res = await app.inject({ method: 'GET', url: '/api/aliyundrive/status', headers: { authorization: 'Bearer token' } });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ configured: false, authorized: false });
  });

  it('saves config', async () => {
    const app = Fastify();
    await app.register(aliyunDriveRoutes);
    const res = await app.inject({
      method: 'PUT',
      url: '/api/aliyundrive/config',
      headers: { authorization: 'Bearer token' },
      payload: { clientId: 'app-id', cleanupTtlMs: 86400000 },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().clientSecret).toBeUndefined();
  });

  it('starts oauth', async () => {
    const app = Fastify();
    await app.register(aliyunDriveRoutes);
    const res = await app.inject({ method: 'POST', url: '/api/aliyundrive/oauth/start', headers: { authorization: 'Bearer token' } });
    expect(res.statusCode).toBe(200);
    expect(res.json().authorizationUrl).toContain('openapi.alipan.com');
  });
});
```

- [ ] **Step 6: Implement routes**

Create `apps/server/src/modules/aliyundrive/aliyundrive.routes.ts`:

```ts
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { authMiddleware } from '../auth/auth.middleware.js';
import { aliyunDriveAuthService } from './aliyundrive-auth.service.js';

const ConfigPayloadSchema = z.object({
  clientId: z.string().min(1),
  clientSecret: z.string().optional().nullable(),
  scope: z.string().optional(),
  openapiBase: z.string().url().optional(),
  redirectUri: z.string().optional(),
  transferFolder: z.string().min(1).optional(),
  cleanupTtlMs: z.number().int().positive().optional(),
});

const CompletePayloadSchema = z.object({
  state: z.string().min(1),
  code: z.string().min(1),
});

function maskConfig(value: Record<string, unknown>): Record<string, unknown> {
  const copy = { ...value };
  if ('clientSecret' in copy) delete copy.clientSecret;
  return copy;
}

export async function aliyunDriveRoutes(app: FastifyInstance): Promise<void> {
  app.addHook('preHandler', authMiddleware);

  app.get('/api/aliyundrive/status', async () => aliyunDriveAuthService.getStatus());

  app.put('/api/aliyundrive/config', async (request, reply) => {
    const parsed = ConfigPayloadSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.message });
    return reply.send(maskConfig(aliyunDriveAuthService.saveConfig(parsed.data)));
  });

  app.post('/api/aliyundrive/oauth/start', async (_request, reply) => {
    try {
      return reply.send(await aliyunDriveAuthService.startOAuth());
    } catch (error) {
      return reply.code(400).send({ error: error instanceof Error ? error.message : String(error) });
    }
  });

  app.post('/api/aliyundrive/oauth/complete', async (request, reply) => {
    const parsed = CompletePayloadSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.message });
    try {
      return reply.send(await aliyunDriveAuthService.completeOAuth(parsed.data));
    } catch (error) {
      return reply.code(400).send({ error: error instanceof Error ? error.message : String(error) });
    }
  });

  app.post('/api/aliyundrive/oauth/revoke', async () => {
    aliyunDriveAuthService.revoke();
    return { revoked: true };
  });

  app.post('/api/aliyundrive/test', async () => aliyunDriveAuthService.getStatus());
}
```

- [ ] **Step 7: Register routes in server main**

Modify `apps/server/src/main.ts` imports:

```ts
import { aliyunDriveRoutes } from './modules/aliyundrive/aliyundrive.routes.js';
```

Register after `taskRoutes`:

```ts
  await app.register(aliyunDriveRoutes);
```

- [ ] **Step 8: Run tests**

```bash
pnpm --filter @rag/server test -- aliyundrive-auth.service.test.ts aliyundrive.routes.test.ts
pnpm --filter @rag/server typecheck
```

Expected: PASS.

- [ ] **Step 9: Commit**

```bash
git add apps/server/src/modules/aliyundrive apps/server/src/main.ts
git commit -m "feat(server): add aliyundrive authorization routes"
```

---

## Task 4: Aliyun OpenAPI client and upload planner

**Files:**
- Create: `apps/server/src/modules/aliyundrive/aliyundrive-openapi.client.ts`
- Create: `apps/server/src/modules/aliyundrive/aliyundrive-upload-planner.ts`
- Test: `apps/server/src/modules/aliyundrive/aliyundrive-openapi.client.test.ts`
- Test: `apps/server/src/modules/aliyundrive/aliyundrive-upload-planner.test.ts`

- [ ] **Step 1: Write upload planner tests**

Create `apps/server/src/modules/aliyundrive/aliyundrive-upload-planner.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { buildPartInfoList, resolvePartSize } from './aliyundrive-upload-planner.js';

describe('aliyundrive upload planner', () => {
  it('uses one part for small files', () => {
    expect(buildPartInfoList(1024, 64 * 1024 * 1024)).toEqual([{ part_number: 1 }]);
  });

  it('creates multiple part numbers for files larger than part size', () => {
    expect(buildPartInfoList(130 * 1024 * 1024, 64 * 1024 * 1024)).toHaveLength(3);
  });

  it('rejects too many parts', () => {
    expect(() => buildPartInfoList(10001 * 8 * 1024 * 1024, 8 * 1024 * 1024)).toThrow('exceeds Aliyun Drive part limit');
  });

  it('resolves last part size', () => {
    expect(resolvePartSize(130, 64, 3)).toBe(2);
  });
});
```

- [ ] **Step 2: Implement upload planner**

Create `apps/server/src/modules/aliyundrive/aliyundrive-upload-planner.ts`:

```ts
const MAX_PARTS = 10000;
export const DEFAULT_ALIYUN_PART_SIZE = 64 * 1024 * 1024;
export const MIN_ALIYUN_PART_SIZE = 8 * 1024 * 1024;

export function resolveAliyunPartSize(fileSize: number): number {
  const candidates = [DEFAULT_ALIYUN_PART_SIZE, 128 * 1024 * 1024, 256 * 1024 * 1024, 512 * 1024 * 1024];
  for (const size of candidates) {
    if (Math.ceil(fileSize / size) <= MAX_PARTS) return size;
  }
  throw new Error('File exceeds Aliyun Drive part limit');
}

export function buildPartInfoList(fileSize: number, partSize = resolveAliyunPartSize(fileSize)): Array<{ part_number: number }> {
  if (!Number.isInteger(fileSize) || fileSize < 0) throw new Error('fileSize must be a non-negative integer');
  if (!Number.isInteger(partSize) || partSize < MIN_ALIYUN_PART_SIZE) throw new Error('partSize is too small');
  const count = Math.max(1, Math.ceil(fileSize / partSize));
  if (count > MAX_PARTS) throw new Error('File exceeds Aliyun Drive part limit');
  return Array.from({ length: count }, (_, index) => ({ part_number: index + 1 }));
}

export function resolvePartSize(fileSize: number, partSize: number, partNumber: number): number {
  const offset = (partNumber - 1) * partSize;
  return Math.min(partSize, Math.max(0, fileSize - offset));
}
```

- [ ] **Step 3: Write OpenAPI client tests**

Create `apps/server/src/modules/aliyundrive/aliyundrive-openapi.client.test.ts`:

```ts
import { describe, expect, it, vi } from 'vitest';
import { AliyunDriveOpenApiClient } from './aliyundrive-openapi.client.js';

describe('AliyunDriveOpenApiClient', () => {
  it('posts with bearer auth and returns json', async () => {
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({ default_drive_id: 'drive-1' }), { status: 200 }));
    const client = new AliyunDriveOpenApiClient({ openapiBase: 'https://openapi.alipan.com', accessToken: 'token', fetchImpl: fetchImpl as any });
    const data = await client.post('/adrive/v1.0/user/getDriveInfo', {});
    expect(data).toEqual({ default_drive_id: 'drive-1' });
    expect(fetchImpl).toHaveBeenCalledWith('https://openapi.alipan.com/adrive/v1.0/user/getDriveInfo', expect.objectContaining({
      method: 'POST',
      headers: expect.objectContaining({ Authorization: 'Bearer token' }),
    }));
  });

  it('throws a redacted error on api failure', async () => {
    const fetchImpl = vi.fn(async () => new Response('bad token secret-value', { status: 401 }));
    const client = new AliyunDriveOpenApiClient({ openapiBase: 'https://openapi.alipan.com', accessToken: 'token', fetchImpl: fetchImpl as any });
    await expect(client.post('/x', {})).rejects.toThrow('Aliyun OpenAPI failed: HTTP 401');
  });
});
```

- [ ] **Step 4: Implement OpenAPI client**

Create `apps/server/src/modules/aliyundrive/aliyundrive-openapi.client.ts`:

```ts
export interface AliyunDriveOpenApiClientOptions {
  openapiBase: string;
  accessToken: string;
  fetchImpl?: typeof fetch;
}

export class AliyunDriveOpenApiClient {
  private readonly base: string;
  private readonly token: string;
  private readonly fetchImpl: typeof fetch;

  constructor(options: AliyunDriveOpenApiClientOptions) {
    this.base = options.openapiBase.replace(/\/+$/, '');
    this.token = options.accessToken;
    this.fetchImpl = options.fetchImpl ?? fetch;
  }

  async post<T = unknown>(path: string, payload: unknown): Promise<T> {
    const response = await this.fetchImpl(`${this.base}${path}`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
    });
    if (!response.ok) {
      const text = await response.text().catch(() => '');
      throw new Error(`Aliyun OpenAPI failed: HTTP ${response.status} ${text.slice(0, 200)}`);
    }
    return await response.json() as T;
  }

  async getDriveInfo(): Promise<{ driveId: string; raw: unknown }> {
    const data = await this.post<Record<string, unknown>>('/adrive/v1.0/user/getDriveInfo', {});
    const driveId = String(data.default_drive_id ?? data.defaultDriveId ?? data.resource_drive_id ?? data.resourceDriveId ?? data.backup_drive_id ?? data.backupDriveId ?? '');
    if (!driveId) throw new Error('Aliyun Drive response did not include drive id');
    return { driveId, raw: data };
  }

  async createFileUpload(input: { driveId: string; parentFileId: string; name: string; size: number; partInfoList: Array<{ part_number: number }> }) {
    return await this.post<Record<string, unknown>>('/adrive/v1.0/openFile/create', {
      drive_id: input.driveId,
      parent_file_id: input.parentFileId,
      name: input.name,
      type: 'file',
      check_name_mode: 'auto_rename',
      size: input.size,
      part_info_list: input.partInfoList,
    });
  }

  async getUploadUrl(input: { driveId: string; fileId: string; uploadId: string; partNumbers: number[] }) {
    return await this.post<Record<string, unknown>>('/adrive/v1.0/openFile/getUploadUrl', {
      drive_id: input.driveId,
      file_id: input.fileId,
      upload_id: input.uploadId,
      part_info_list: input.partNumbers.map((part_number) => ({ part_number })),
    });
  }

  async completeUpload(input: { driveId: string; fileId: string; uploadId: string }) {
    return await this.post<Record<string, unknown>>('/adrive/v1.0/openFile/complete', {
      drive_id: input.driveId,
      file_id: input.fileId,
      upload_id: input.uploadId,
    });
  }

  async getDownloadUrl(input: { driveId: string; fileId: string }) {
    return await this.post<Record<string, unknown>>('/adrive/v1.0/openFile/getDownloadUrl', {
      drive_id: input.driveId,
      file_id: input.fileId,
    });
  }

  async deleteFile(input: { driveId: string; fileId: string }) {
    return await this.post<Record<string, unknown>>('/adrive/v1.0/openFile/delete', {
      drive_id: input.driveId,
      file_id: input.fileId,
    });
  }
}
```

- [ ] **Step 5: Run tests**

```bash
pnpm --filter @rag/server test -- aliyundrive-upload-planner.test.ts aliyundrive-openapi.client.test.ts
pnpm --filter @rag/server typecheck
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/server/src/modules/aliyundrive/aliyundrive-openapi.client.ts apps/server/src/modules/aliyundrive/aliyundrive-upload-planner.ts apps/server/src/modules/aliyundrive/*.test.ts
git commit -m "feat(server): add aliyundrive openapi client"
```

---

## Task 5: Transfer service, routes, and WebSocket server handling

**Files:**
- Create: `apps/server/src/modules/transfers/transfer.service.ts`
- Create: `apps/server/src/modules/transfers/transfer.routes.ts`
- Modify: `apps/server/src/ws/ws-handlers.ts`
- Modify: `apps/server/src/main.ts`
- Test: `apps/server/src/modules/transfers/transfer.service.test.ts`
- Test: `apps/server/src/modules/transfers/transfer.routes.test.ts`

- [ ] **Step 1: Write service tests**

Create `apps/server/src/modules/transfers/transfer.service.test.ts` with mocked DB/auth/connections:

```ts
import { describe, expect, it, vi } from 'vitest';

vi.mock('../connections/connections.manager.js', () => ({
  connectionManager: { sendToClient: vi.fn(() => true), isOnline: vi.fn(() => true) },
}));

vi.mock('../aliyundrive/aliyundrive-auth.service.js', () => ({
  aliyunDriveAuthService: {
    getStatus: vi.fn(() => ({ configured: true, authorized: true })),
    getConfig: vi.fn(() => ({ openapiBase: 'https://openapi.alipan.com', transferFolder: 'RemoteAgentGatewayTransfers', cleanupTtlMs: 86400000 })),
    getAuth: vi.fn(() => ({ accessToken: 'access-token', driveId: 'drive-1', expiresAt: Date.now() + 3600000 })),
  },
}));

import { TransferService } from './transfer.service.js';

describe('TransferService', () => {
  it('returns frps_chunked when aliyundrive is not available in auto mode', async () => {
    const service = new TransferService({
      now: () => 1000,
      id: () => 'tr_1',
      authStatus: () => ({ configured: false, authorized: false }),
    } as any);
    const result = await service.createUpload({ clientId: 'client-1', rootId: 'workspace', path: '.', filename: 'a.zip', size: 10, transfer: 'auto' });
    expect(result.mode).toBe('frps_chunked');
  });

  it('throws when aliyundrive is forced but unavailable', async () => {
    const service = new TransferService({ now: () => 1000, id: () => 'tr_1', authStatus: () => ({ configured: false, authorized: false }) } as any);
    await expect(service.createUpload({ clientId: 'client-1', rootId: 'workspace', path: '.', filename: 'a.zip', size: 10, transfer: 'aliyundrive' })).rejects.toThrow('Aliyun Drive is not configured or authorized');
  });
});
```

- [ ] **Step 2: Implement transfer service**

Create `apps/server/src/modules/transfers/transfer.service.ts` with this structure. Keep helper methods small; the concrete SQL column names here match Task 2 migration.

```ts
import { randomUUID } from 'node:crypto';
import type { TransferJobView, TransferMode, TransferStatus } from '@rag/shared';
import { getDb, saveDb } from '../../db/index.js';
import { connectionManager } from '../connections/connections.manager.js';
import { aliyunDriveAuthService } from '../aliyundrive/aliyundrive-auth.service.js';
import { AliyunDriveOpenApiClient } from '../aliyundrive/aliyundrive-openapi.client.js';
import { buildPartInfoList, resolveAliyunPartSize, resolvePartSize } from '../aliyundrive/aliyundrive-upload-planner.js';
import { assertTransferTransition, sanitizeTransferEventPayload } from './transfer-state.js';

export interface CreateUploadInput {
  clientId: string;
  rootId: string;
  path: string;
  filename: string;
  size: number;
  transfer: 'auto' | 'aliyundrive' | 'direct';
}

export type CreateUploadResult =
  | { mode: 'frps_chunked' }
  | {
      mode: 'aliyundrive';
      transferId: string;
      accessToken: string;
      openapiBase: string;
      driveId: string;
      fileId: string;
      uploadId: string;
      partSize: number;
      partCount: number;
      uploadParts: Array<{ partNumber: number; uploadUrl: string; size: number }>;
    };

export class TransferService {
  constructor(private readonly deps: { now?: () => number; id?: () => string; authStatus?: () => { configured: boolean; authorized: boolean } } = {}) {}

  private now(): number { return this.deps.now?.() ?? Date.now(); }
  private id(): string { return this.deps.id?.() ?? `tr_${randomUUID().replace(/-/g, '')}`; }

  async createUpload(input: CreateUploadInput): Promise<CreateUploadResult> {
    const status = this.deps.authStatus?.() ?? aliyunDriveAuthService.getStatus();
    if (input.transfer === 'direct') return { mode: 'frps_chunked' };
    if (!status.configured || !status.authorized) {
      if (input.transfer === 'aliyundrive') throw new Error('Aliyun Drive is not configured or authorized');
      return { mode: 'frps_chunked' };
    }

    const config = aliyunDriveAuthService.getConfig();
    const auth = aliyunDriveAuthService.getAuth();
    if (!config || !auth?.accessToken) throw new Error('Aliyun Drive auth is missing');
    const driveId = auth.driveId ?? 'root';
    const transferId = this.id();
    const partSize = resolveAliyunPartSize(input.size);
    const partInfoList = buildPartInfoList(input.size, partSize);
    const client = new AliyunDriveOpenApiClient({ openapiBase: config.openapiBase, accessToken: auth.accessToken });
    const createResult = await client.createFileUpload({
      driveId,
      parentFileId: 'root',
      name: `${transferId}-${input.filename}`,
      size: input.size,
      partInfoList,
    });
    const fileId = String(createResult.file_id ?? createResult.fileId);
    const uploadId = String(createResult.upload_id ?? createResult.uploadId);
    const remoteParts = (createResult.part_info_list ?? []) as Array<Record<string, unknown>>;
    const now = this.now();
    this.insertJob({
      id: transferId,
      clientId: input.clientId,
      rootId: input.rootId,
      targetDir: input.path,
      filename: input.filename,
      size: input.size,
      mode: 'aliyundrive',
      status: 'waiting_cli_upload',
      phase: 'waiting_cli_upload',
      aliyunDriveId: driveId,
      aliyunFileId: fileId,
      aliyunUploadId: uploadId,
      aliyunParentFileId: 'root',
      aliyunFileName: `${transferId}-${input.filename}`,
      totalBytes: input.size,
      partCount: partInfoList.length,
      createdAt: now,
      updatedAt: now,
    });
    this.addEvent(transferId, 'server', 'phase_changed', 'Transfer created', { status: 'waiting_cli_upload' });
    saveDb();
    return {
      mode: 'aliyundrive',
      transferId,
      accessToken: auth.accessToken,
      openapiBase: config.openapiBase,
      driveId,
      fileId,
      uploadId,
      partSize,
      partCount: partInfoList.length,
      uploadParts: remoteParts.map((part, index) => ({
        partNumber: Number(part.part_number ?? index + 1),
        uploadUrl: String(part.upload_url),
        size: resolvePartSize(input.size, partSize, Number(part.part_number ?? index + 1)),
      })),
    };
  }

  getTransfer(id: string): TransferJobView | null {
    const stmt = getDb().prepare('SELECT * FROM transfer_jobs WHERE id = ?');
    stmt.bind([id]);
    try { return stmt.step() ? this.rowToView(stmt.getAsObject() as Record<string, unknown>) : null; }
    finally { stmt.free(); }
  }

  listEvents(transferId: string): unknown[] {
    const stmt = getDb().prepare('SELECT * FROM transfer_events WHERE transfer_id = ? ORDER BY created_at ASC');
    stmt.bind([transferId]);
    const events: unknown[] = [];
    try {
      while (stmt.step()) {
        const row = stmt.getAsObject() as Record<string, unknown>;
        events.push({ id: Number(row.id), transferId: row.transfer_id, source: row.source, type: row.type, message: row.message, payload: row.payload ? JSON.parse(String(row.payload)) : null, createdAt: Number(row.created_at) });
      }
      return events;
    } finally { stmt.free(); }
  }

  recordCliProgress(transferId: string, progress: { uploadedBytes: number; totalBytes: number; currentPart?: number }): TransferJobView | null {
    this.updateProgress(transferId, 'cli_uploading', { uploaded_bytes: progress.uploadedBytes, current_part: progress.currentPart ?? null, total_bytes: progress.totalBytes });
    this.addEvent(transferId, 'cli', 'progress', 'CLI upload progress', progress);
    saveDb();
    return this.getTransfer(transferId);
  }

  async completeCliUpload(transferId: string): Promise<TransferJobView | null> {
    const job = this.getTransfer(transferId);
    if (!job) throw new Error('Transfer not found');
    this.setStatus(transferId, 'aliyun_uploaded');
    this.setStatus(transferId, 'waiting_client_download');
    connectionManager.sendToClient(job.clientId, { type: 'transfer.download.start', requestId: `transfer_${transferId}`, payload: { transferId, clientId: job.clientId } });
    saveDb();
    return this.getTransfer(transferId);
  }

  recordClientProgress(transferId: string, progress: { downloadedBytes?: number; writtenBytes?: number; totalBytes: number }): TransferJobView | null {
    this.updateProgress(transferId, 'client_downloading', { downloaded_bytes: progress.downloadedBytes ?? 0, written_bytes: progress.writtenBytes ?? 0, total_bytes: progress.totalBytes });
    this.addEvent(transferId, 'client', 'progress', 'Client download progress', progress);
    saveDb();
    return this.getTransfer(transferId);
  }

  completeClientDownload(transferId: string): TransferJobView | null {
    const now = this.now();
    getDb().run("UPDATE transfer_jobs SET status='completed', phase='completed', completed_at=?, cleanup_after_at=?, cleanup_status='cleanup_pending', updated_at=? WHERE id=?", [now, now + 24 * 60 * 60 * 1000, now, transferId]);
    this.addEvent(transferId, 'client', 'phase_changed', 'Client download completed', { status: 'completed' });
    saveDb();
    return this.getTransfer(transferId);
  }

  failTransfer(transferId: string, input: { errorCode: string; errorMessage: string }): TransferJobView | null {
    getDb().run("UPDATE transfer_jobs SET status='failed', phase='failed', error_code=?, error_message=?, updated_at=? WHERE id=?", [input.errorCode, input.errorMessage, this.now(), transferId]);
    this.addEvent(transferId, 'server', 'error', input.errorMessage, input);
    saveDb();
    return this.getTransfer(transferId);
  }

  private setStatus(id: string, status: TransferStatus): void {
    const current = this.getTransfer(id);
    if (current) assertTransferTransition(current.status, status);
    getDb().run('UPDATE transfer_jobs SET status=?, phase=?, updated_at=? WHERE id=?', [status, status, this.now(), id]);
    this.addEvent(id, 'server', 'phase_changed', `Transfer status changed to ${status}`, { status });
  }

  private updateProgress(id: string, status: TransferStatus, values: Record<string, number | null>): void {
    const current = this.getTransfer(id);
    if (current && current.status !== status) this.setStatus(id, status);
    getDb().run('UPDATE transfer_jobs SET uploaded_bytes=COALESCE(?, uploaded_bytes), downloaded_bytes=COALESCE(?, downloaded_bytes), written_bytes=COALESCE(?, written_bytes), total_bytes=COALESCE(?, total_bytes), current_part=COALESCE(?, current_part), updated_at=? WHERE id=?', [values.uploaded_bytes ?? null, values.downloaded_bytes ?? null, values.written_bytes ?? null, values.total_bytes ?? null, values.current_part ?? null, this.now(), id]);
  }

  private addEvent(transferId: string, source: string, type: string, message: string, payload: unknown): void {
    getDb().run('INSERT INTO transfer_events (transfer_id, source, type, message, payload, created_at) VALUES (?, ?, ?, ?, ?, ?)', [transferId, source, type, message, JSON.stringify(sanitizeTransferEventPayload(payload)), this.now()]);
  }

  private insertJob(job: Record<string, unknown>): void {
    getDb().run(`INSERT INTO transfer_jobs (id, client_id, root_id, target_dir, filename, size, mode, status, phase, aliyun_drive_id, aliyun_file_id, aliyun_upload_id, aliyun_parent_file_id, aliyun_file_name, total_bytes, part_count, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`, [job.id, job.clientId, job.rootId, job.targetDir, job.filename, job.size, job.mode, job.status, job.phase, job.aliyunDriveId, job.aliyunFileId, job.aliyunUploadId, job.aliyunParentFileId, job.aliyunFileName, job.totalBytes, job.partCount, job.createdAt, job.updatedAt]);
  }

  private rowToView(row: Record<string, unknown>): TransferJobView {
    return { id: String(row.id), clientId: String(row.client_id), rootId: String(row.root_id), targetDir: String(row.target_dir), filename: String(row.filename), size: Number(row.size), mode: row.mode as TransferMode, status: row.status as TransferStatus, cleanupStatus: String(row.cleanup_status ?? 'none') as any, uploadedBytes: Number(row.uploaded_bytes), downloadedBytes: Number(row.downloaded_bytes), writtenBytes: Number(row.written_bytes), totalBytes: Number(row.total_bytes), errorCode: row.error_code as string | null, errorMessage: row.error_message as string | null, createdAt: Number(row.created_at), updatedAt: Number(row.updated_at), completedAt: row.completed_at == null ? null : Number(row.completed_at), cleanupAfterAt: row.cleanup_after_at == null ? null : Number(row.cleanup_after_at) };
  }
}

export const transferService = new TransferService();
```

- [ ] **Step 3: Write route tests**

Create `apps/server/src/modules/transfers/transfer.routes.test.ts`:

```ts
import { describe, expect, it, vi } from 'vitest';
import Fastify from 'fastify';
import { transferRoutes } from './transfer.routes.js';

vi.mock('../auth/auth.middleware.js', () => ({
  authMiddleware: async (request: unknown) => { (request as { authRole?: string }).authRole = 'agent'; },
}));

vi.mock('./transfer.service.js', () => ({
  transferService: {
    createUpload: vi.fn(async () => ({ mode: 'frps_chunked' })),
    getTransfer: vi.fn(() => ({ id: 'tr_1', status: 'completed' })),
    listEvents: vi.fn(() => []),
    recordCliProgress: vi.fn(() => ({ id: 'tr_1' })),
    completeCliUpload: vi.fn(async () => ({ id: 'tr_1', status: 'waiting_client_download' })),
    recordClientProgress: vi.fn(() => ({ id: 'tr_1' })),
    completeClientDownload: vi.fn(() => ({ id: 'tr_1', status: 'completed' })),
    failTransfer: vi.fn(() => ({ id: 'tr_1', status: 'failed' })),
  },
}));

describe('transferRoutes', () => {
  it('creates an upload transfer', async () => {
    const app = Fastify();
    await app.register(transferRoutes);
    const res = await app.inject({
      method: 'POST',
      url: '/api/transfers/uploads',
      headers: { authorization: 'Bearer token' },
      payload: { clientId: 'client-1', rootId: 'workspace', path: '.', filename: 'a.zip', size: 10, transfer: 'auto' },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ mode: 'frps_chunked' });
  });

  it('accepts cli progress', async () => {
    const app = Fastify();
    await app.register(transferRoutes);
    const res = await app.inject({
      method: 'POST',
      url: '/api/transfers/tr_1/cli-progress',
      headers: { authorization: 'Bearer token' },
      payload: { uploadedBytes: 5, totalBytes: 10, currentPart: 1 },
    });
    expect(res.statusCode).toBe(200);
  });
});
```

- [ ] **Step 4: Implement transfer routes**

Create `apps/server/src/modules/transfers/transfer.routes.ts` with zod validation. Route names must match the spec:

```http
POST /api/transfers/uploads
GET  /api/transfers/:transferId
GET  /api/transfers/:transferId/events
POST /api/transfers/:transferId/cli-progress
POST /api/transfers/:transferId/cli-upload-complete
POST /api/transfers/:transferId/client-progress
POST /api/transfers/:transferId/client-complete
POST /api/transfers/:transferId/fail
POST /api/transfers/:transferId/cancel
POST /api/transfers/:transferId/refresh-upload-url
POST /api/transfers/:transferId/refresh-download-url
```

For `refresh-upload-url`, return `{ uploadParts: [{ partNumber, uploadUrl, size }] }`. For `refresh-download-url`, return `{ accessToken, openapiBase, driveId, fileId, downloadUrl? }`.

- [ ] **Step 5: Register routes and WebSocket progress handling**

Modify `apps/server/src/main.ts`:

```ts
import { transferRoutes } from './modules/transfers/transfer.routes.js';
```

Register:

```ts
  await app.register(transferRoutes);
```

Modify `apps/server/src/ws/ws-handlers.ts`:

- Import new schemas from `@rag/shared`.
- Import `transferService`.
- Add cases:
  - `client.transfer.progress` -> `transferService.recordClientProgress(...)`
  - `client.transfer.complete` -> `transferService.completeClientDownload(...)`
  - `client.transfer.failed` -> `transferService.failTransfer(...)`

Each case must reply with `server.ack` or `server.error` following existing style.

- [ ] **Step 6: Run server tests**

```bash
pnpm --filter @rag/server test -- transfer.service.test.ts transfer.routes.test.ts ws-handlers.test.ts
pnpm --filter @rag/server typecheck
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add apps/server/src/modules/transfers apps/server/src/ws/ws-handlers.ts apps/server/src/main.ts
git commit -m "feat(server): add transfer coordination api"
```

---

## Task 6: CLI Aliyun upload flow and command integration

**Files:**
- Modify: `apps/cli/src/http/server-api.ts`
- Create: `apps/cli/src/http/aliyundrive-upload.ts`
- Modify: `apps/cli/src/commands/files.ts`
- Test: `apps/cli/src/http/aliyundrive-upload.test.ts`
- Test: `apps/cli/src/commands/commands.test.ts`

- [ ] **Step 1: Write Aliyun upload helper tests**

Create `apps/cli/src/http/aliyundrive-upload.test.ts`:

```ts
import { describe, expect, it, vi } from 'vitest';
import { uploadFileToAliyunDrive } from './aliyundrive-upload.js';

vi.mock('node:fs/promises', () => ({
  stat: vi.fn(async () => ({ size: 4, mtimeMs: 1 })),
  open: vi.fn(async () => ({
    read: vi.fn(async (buffer: Buffer) => { buffer.write('test'); return { bytesRead: 4 }; }),
    close: vi.fn(async () => undefined),
  })),
}));

describe('uploadFileToAliyunDrive', () => {
  it('uploads each planned part and reports progress', async () => {
    const fetchImpl = vi.fn(async () => new Response('', { status: 200 }));
    const progress = vi.fn();
    await uploadFileToAliyunDrive({
      filePath: 'demo.bin',
      plan: {
        mode: 'aliyundrive',
        transferId: 'tr_1',
        accessToken: 'token',
        openapiBase: 'https://openapi.alipan.com',
        driveId: 'drive-1',
        fileId: 'file-1',
        uploadId: 'upload-1',
        partSize: 4,
        partCount: 1,
        uploadParts: [{ partNumber: 1, uploadUrl: 'https://upload', size: 4 }],
      },
      serverApi: { reportCliProgress: vi.fn(), completeCliUpload: vi.fn(), refreshUploadUrl: vi.fn() } as any,
      fetchImpl: fetchImpl as any,
      onProgress: progress,
    });
    expect(fetchImpl).toHaveBeenCalledWith('https://upload', expect.objectContaining({ method: 'PUT' }));
    expect(progress).toHaveBeenCalledWith(expect.objectContaining({ uploadedBytes: 4, totalBytes: 4 }));
  });
});
```

- [ ] **Step 2: Implement server API methods**

Modify `apps/cli/src/http/server-api.ts` by adding methods to `ServerApi`:

```ts
  async createUploadTransfer(input: Record<string, unknown>): Promise<unknown> {
    return this.request('POST', '/api/transfers/uploads', input);
  }

  async getTransfer(transferId: string): Promise<unknown> {
    return this.request('GET', `/api/transfers/${encodeURIComponent(transferId)}`);
  }

  async reportCliProgress(transferId: string, input: Record<string, unknown>): Promise<unknown> {
    return this.request('POST', `/api/transfers/${encodeURIComponent(transferId)}/cli-progress`, input);
  }

  async completeCliUpload(transferId: string): Promise<unknown> {
    return this.request('POST', `/api/transfers/${encodeURIComponent(transferId)}/cli-upload-complete`, {});
  }

  async refreshUploadUrl(transferId: string, partNumbers: number[]): Promise<unknown> {
    return this.request('POST', `/api/transfers/${encodeURIComponent(transferId)}/refresh-upload-url`, { partNumbers });
  }
```

- [ ] **Step 3: Implement upload helper**

Create `apps/cli/src/http/aliyundrive-upload.ts`:

```ts
import * as fs from 'node:fs/promises';
import { CliError } from './http-error.js';

export interface AliyunUploadPlan {
  mode: 'aliyundrive';
  transferId: string;
  accessToken: string;
  openapiBase: string;
  driveId: string;
  fileId: string;
  uploadId: string;
  partSize: number;
  partCount: number;
  uploadParts: Array<{ partNumber: number; uploadUrl: string; size: number }>;
}

export interface AliyunUploadProgress {
  transferId: string;
  uploadedBytes: number;
  totalBytes: number;
  partNumber: number;
  partCount: number;
  rateBytesPerSecond: number;
  elapsedMs: number;
}

export async function uploadFileToAliyunDrive(options: {
  filePath: string;
  plan: AliyunUploadPlan;
  serverApi: {
    reportCliProgress(transferId: string, input: Record<string, unknown>): Promise<unknown>;
    completeCliUpload(transferId: string): Promise<unknown>;
    refreshUploadUrl(transferId: string, partNumbers: number[]): Promise<unknown>;
  };
  fetchImpl?: typeof fetch;
  retries?: number;
  onProgress?: (progress: AliyunUploadProgress) => void;
}): Promise<void> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const retries = options.retries ?? 5;
  const stat = await fs.stat(options.filePath);
  const file = await fs.open(options.filePath, 'r');
  const startedAt = Date.now();
  let uploadedBytes = 0;
  try {
    const parts = new Map(options.plan.uploadParts.map((part) => [part.partNumber, part]));
    for (let partNumber = 1; partNumber <= options.plan.partCount; partNumber += 1) {
      let part = parts.get(partNumber);
      if (!part) throw new CliError('ALIYUN_PLAN_ERROR', `Missing upload part ${partNumber}`);
      const offset = (partNumber - 1) * options.plan.partSize;
      const buffer = Buffer.alloc(part.size);
      const { bytesRead } = await file.read(buffer, 0, part.size, offset);
      if (bytesRead !== part.size) throw new CliError('IO_ERROR', `Expected ${part.size} bytes at offset ${offset}, got ${bytesRead}`);
      for (let attempt = 1; attempt <= retries; attempt += 1) {
        const response = await fetchImpl(part.uploadUrl, { method: 'PUT', headers: { 'Content-Type': '' }, body: buffer });
        if (response.ok) break;
        if ((response.status === 403 || response.status === 401) && attempt < retries) {
          const refreshed = await options.serverApi.refreshUploadUrl(options.plan.transferId, [partNumber]) as { uploadParts?: Array<{ partNumber: number; uploadUrl: string; size: number }> };
          const replacement = refreshed.uploadParts?.find((item) => item.partNumber === partNumber);
          if (replacement) part = replacement;
          await sleep(500 * attempt);
          continue;
        }
        if (attempt === retries) throw new CliError('ALIYUN_UPLOAD_ERROR', `Upload part ${partNumber} failed: HTTP ${response.status}`, response.status);
        await sleep(500 * attempt);
      }
      uploadedBytes += part.size;
      const progress = {
        transferId: options.plan.transferId,
        uploadedBytes,
        totalBytes: stat.size,
        partNumber,
        partCount: options.plan.partCount,
        rateBytesPerSecond: uploadedBytes / Math.max((Date.now() - startedAt) / 1000, 1),
        elapsedMs: Date.now() - startedAt,
      };
      options.onProgress?.(progress);
      await options.serverApi.reportCliProgress(options.plan.transferId, progress);
    }
    await options.serverApi.completeCliUpload(options.plan.transferId);
  } finally {
    await file.close();
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
```

- [ ] **Step 4: Integrate `files upload`**

Modify `apps/cli/src/commands/files.ts`:

- Extend `FilesDeps` with optional `serverApi` methods used above.
- Add `.option('--transfer <mode>', 'auto | aliyundrive | direct', 'auto')` to upload command.
- If `transfer === 'direct'` or no `serverApi` exists, use current `uploadFileWithProgress` path.
- Otherwise call `serverApi.createUploadTransfer({ clientId, rootId, path, filename, size, transfer })` before discovering client HTTP.
- If response is `{ mode: 'frps_chunked' }`, use current path.
- If response is `{ mode: 'aliyundrive', ... }`, call `uploadFileToAliyunDrive`, then poll `getTransfer` every 2 seconds until `completed`, `failed`, or `cancelled`.
- Print stderr progress for both CLI upload and client download phases.

- [ ] **Step 5: Wire `serverApi` into command registration**

Modify `apps/cli/src/index.ts` so `registerFilesCommands` receives both `discoverClientHttp` and transfer server methods:

```ts
  registerFilesCommands(program, { discoverClientHttp, write, serverApi: deps.serverApi });
```

Extend `deps.serverApi` with wrappers for the new `ServerApi` methods.

- [ ] **Step 6: Update command tests**

In `apps/cli/src/commands/commands.test.ts`, add a test for fallback and a test for Aliyun mode. Mock `uploadFileToAliyunDrive` using `vi.mock('../http/aliyundrive-upload.js', ...)`, and assert:

```ts
await program.parseAsync(['files', 'upload', '--client', 'client-1', '--root', 'root-0', '--path', 'drop', '--file', 'demo.jar', '--transfer', 'direct'], { from: 'user' });
expect(uploadFileWithProgressMock).toHaveBeenCalled();
```

For Aliyun mode, construct a program with `serverApi.createUploadTransfer` returning an Aliyun plan and `serverApi.getTransfer` returning `{ status: 'completed' }`.

- [ ] **Step 7: Run CLI tests**

```bash
pnpm --filter @rag/cli test -- aliyundrive-upload.test.ts commands.test.ts
pnpm --filter @rag/cli typecheck
```

Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add apps/cli/src/http/server-api.ts apps/cli/src/http/aliyundrive-upload.ts apps/cli/src/http/aliyundrive-upload.test.ts apps/cli/src/commands/files.ts apps/cli/src/commands/commands.test.ts apps/cli/src/index.ts
git commit -m "feat(cli): upload files through aliyundrive transfers"
```

---

## Task 7: Client Aliyun download executor and WebSocket handler

**Files:**
- Create: `apps/client/src/runtime/transfers/aliyundrive-download-executor.ts`
- Create: `apps/client/src/runtime/transfers/transfer-ws-handler.ts`
- Create: `apps/client/src/runtime/control-http/transfer-routes.ts`
- Modify: `apps/client/src/runtime/control-http/server.ts`
- Modify: `apps/client/src/main.ts`
- Test: `apps/client/src/runtime/transfers/aliyundrive-download-executor.test.ts`

- [ ] **Step 1: Write client executor tests**

Create `apps/client/src/runtime/transfers/aliyundrive-download-executor.test.ts`:

```ts
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import * as path from 'node:path';
import { tmpdir } from 'node:os';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { downloadAliyunTransfer } from './aliyundrive-download-executor.js';

let tempDir = '';

afterEach(async () => {
  if (tempDir) await rm(tempDir, { recursive: true, force: true });
});

describe('downloadAliyunTransfer', () => {
  it('downloads to a temp file then renames into allowed root', async () => {
    tempDir = await mkdtemp(path.join(tmpdir(), 'rag-transfer-'));
    const fetchImpl = vi.fn(async (url: string) => {
      if (url.includes('/api/transfers/tr_1')) {
        return new Response(JSON.stringify({
          id: 'tr_1', clientId: 'client-1', rootId: 'workspace', targetDir: '.', filename: 'demo.txt', size: 5,
          accessToken: 'token', openapiBase: 'https://openapi.alipan.com', driveId: 'drive-1', fileId: 'file-1', downloadUrl: 'https://download',
        }), { status: 200 });
      }
      return new Response('hello', { status: 200, headers: { 'content-length': '5' } });
    });
    const send = vi.fn();
    await downloadAliyunTransfer({
      transferId: 'tr_1',
      clientId: 'client-1',
      apiBaseUrl: 'http://server',
      serverToken: 'server-token',
      workspaceDir: tempDir,
      allowedRoots: [tempDir],
      fetchImpl: fetchImpl as any,
      sendWs: send,
    });
    expect(await readFile(path.join(tempDir, 'demo.txt'), 'utf8')).toBe('hello');
    expect(send).toHaveBeenCalledWith(expect.objectContaining({ type: 'client.transfer.complete' }));
  });
});
```

- [ ] **Step 2: Implement download executor**

Create `apps/client/src/runtime/transfers/aliyundrive-download-executor.ts`:

```ts
import * as fs from 'node:fs';
import * as fsp from 'node:fs/promises';
import * as path from 'node:path';
import { resolveAllowedRoots, resolveRootPath } from '../file-roots.js';

export async function downloadAliyunTransfer(options: {
  transferId: string;
  clientId: string;
  apiBaseUrl: string;
  serverToken: string;
  workspaceDir: string;
  allowedRoots: string[];
  fetchImpl?: typeof fetch;
  sendWs: (message: unknown) => boolean;
}): Promise<void> {
  const fetchImpl = options.fetchImpl ?? fetch;
  try {
    const detailResponse = await fetchImpl(`${options.apiBaseUrl}/api/transfers/${encodeURIComponent(options.transferId)}`, {
      headers: { Authorization: `Bearer ${options.serverToken}` },
    });
    if (!detailResponse.ok) throw new Error(`Failed to fetch transfer detail: HTTP ${detailResponse.status}`);
    const detail = await detailResponse.json() as any;
    const roots = resolveAllowedRoots(options.workspaceDir, options.allowedRoots);
    const targetDir = resolveRootPath(roots, detail.rootId, detail.targetDir);
    await fsp.mkdir(targetDir, { recursive: true });
    const finalPath = path.join(targetDir, detail.filename);
    const tempPath = path.join(targetDir, `.rag-transfer-${options.transferId}.part`);
    const downloadUrl = detail.downloadUrl ?? await fetchDownloadUrl(fetchImpl, options, detail);
    const response = await fetchImpl(downloadUrl);
    if (!response.ok || !response.body) throw new Error(`Aliyun download failed: HTTP ${response.status}`);
    const writable = fs.createWriteStream(tempPath);
    let downloadedBytes = 0;
    let lastReport = 0;
    for await (const chunk of response.body as any as AsyncIterable<Uint8Array>) {
      downloadedBytes += chunk.length;
      if (!writable.write(chunk)) await new Promise((resolve) => writable.once('drain', resolve));
      if (Date.now() - lastReport > 1000) {
        lastReport = Date.now();
        options.sendWs({ type: 'client.transfer.progress', payload: { transferId: options.transferId, clientId: options.clientId, phase: 'client_downloading', downloadedBytes, writtenBytes: downloadedBytes, totalBytes: detail.size } });
      }
    }
    await new Promise<void>((resolve, reject) => writable.end((error: Error | null | undefined) => error ? reject(error) : resolve()));
    await fsp.rename(tempPath, finalPath);
    options.sendWs({ type: 'client.transfer.complete', payload: { transferId: options.transferId, clientId: options.clientId, rootId: detail.rootId, path: path.posix.join(detail.targetDir === '.' ? '' : detail.targetDir.replace(/\\/g, '/'), detail.filename), size: detail.size } });
  } catch (error) {
    options.sendWs({ type: 'client.transfer.failed', payload: { transferId: options.transferId, clientId: options.clientId, errorCode: 'DOWNLOAD_FAILED', errorMessage: error instanceof Error ? error.message : String(error) } });
    throw error;
  }
}

async function fetchDownloadUrl(fetchImpl: typeof fetch, options: { apiBaseUrl: string; serverToken: string; transferId: string }, _detail: any): Promise<string> {
  const response = await fetchImpl(`${options.apiBaseUrl}/api/transfers/${encodeURIComponent(options.transferId)}/refresh-download-url`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${options.serverToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({}),
  });
  if (!response.ok) throw new Error(`Failed to refresh download URL: HTTP ${response.status}`);
  const data = await response.json() as { downloadUrl?: string };
  if (!data.downloadUrl) throw new Error('Server did not return downloadUrl');
  return data.downloadUrl;
}
```

- [ ] **Step 3: Implement WS handler**

Create `apps/client/src/runtime/transfers/transfer-ws-handler.ts`:

```ts
import type { ClientConfig } from '../../config/client.config.js';
import { downloadAliyunTransfer } from './aliyundrive-download-executor.js';

export function handleTransferWsMessage(input: {
  message: { type: string; payload: any };
  config: ClientConfig;
  send: (message: unknown) => boolean;
}): boolean {
  if (input.message.type !== 'transfer.download.start') return false;
  const payload = input.message.payload as { transferId?: string; clientId?: string };
  if (!payload.transferId || payload.clientId !== input.config.clientId) return true;
  void downloadAliyunTransfer({
    transferId: payload.transferId,
    clientId: input.config.clientId,
    apiBaseUrl: input.config.apiBaseUrl,
    serverToken: input.config.token,
    workspaceDir: input.config.workspaceDir,
    allowedRoots: input.config.allowedRoots,
    sendWs: input.send,
  }).catch((error) => console.error('Aliyun transfer download failed:', error instanceof Error ? error.message : error));
  return true;
}
```

- [ ] **Step 4: Wire handler into main**

Modify `apps/client/src/main.ts`:

```ts
import { handleTransferWsMessage } from './runtime/transfers/transfer-ws-handler.js';
```

Inside `conn.onMessage`, after parsing and before the switch:

```ts
    if (handleTransferWsMessage({ message, config, send: (out) => conn.send(out) })) {
      return;
    }
```

- [ ] **Step 5: Add HTTP debug route**

Create `apps/client/src/runtime/control-http/transfer-routes.ts` with a `registerTransferRoutes` function that accepts the same server/api/root options and calls `downloadAliyunTransfer` for `POST /files/aliyundrive-download` after `requireBearerToken`.

Modify `apps/client/src/runtime/control-http/server.ts` to import and call it after `registerFileRoutes`.

- [ ] **Step 6: Run client tests**

```bash
pnpm --filter @rag/client test -- aliyundrive-download-executor.test.ts
pnpm --filter @rag/client typecheck
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add apps/client/src/runtime/transfers apps/client/src/runtime/control-http/transfer-routes.ts apps/client/src/runtime/control-http/server.ts apps/client/src/main.ts
git commit -m "feat(client): download aliyundrive transfer jobs"
```

---

## Task 8: Web Aliyun Drive page

**Files:**
- Modify: `apps/web/src/api/http.ts`
- Create: `apps/web/src/api/aliyundrive.ts`
- Create: `apps/web/src/pages/AliyunDrivePage.tsx`
- Create: `apps/web/src/pages/AliyunDrivePage.test.tsx`
- Modify: `apps/web/src/components/AppLayout.tsx`
- Modify: `apps/web/src/App.tsx`

- [ ] **Step 1: Write page test**

Create `apps/web/src/pages/AliyunDrivePage.test.tsx`:

```tsx
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { AliyunDrivePage } from './AliyunDrivePage.js';

describe('AliyunDrivePage', () => {
  it('renders status and starts oauth', async () => {
    const api = {
      get: vi.fn().mockResolvedValueOnce({ configured: false, authorized: false }),
      post: vi.fn().mockResolvedValueOnce({ state: 'state-1', authorizationUrl: 'https://openapi.alipan.com/oauth/authorize?client_id=app', expiresAt: 123 }),
      delete: vi.fn(),
    } as any;
    render(<AliyunDrivePage api={api} />);
    expect(await screen.findByText(/未授权/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /生成授权二维码/ }));
    expect(await screen.findByText(/授权链接/)).toBeInTheDocument();
    expect(screen.getByText(/openapi.alipan.com/)).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Add PUT support and implement Web API helper**

Modify `apps/web/src/api/http.ts` returned object to include PUT:

```ts
  return {
    get: (path: string) => request('GET', path),
    post: (path: string, body?: unknown) => request('POST', path, body),
    put: (path: string, body?: unknown) => request('PUT', path, body),
    delete: (path: string) => request('DELETE', path),
  };
```

Create `apps/web/src/api/aliyundrive.ts`:

```ts
import type { Api } from './http';

export interface AliyunDriveStatus {
  configured: boolean;
  authorized: boolean;
  clientId?: string;
  scope?: string;
  openapiBase?: string;
  redirectUri?: string;
  transferFolder?: string;
  cleanupTtlMs?: number;
  expiresAt?: number;
  driveId?: string;
  authorizedAccountName?: string;
}

export function getAliyunDriveStatus(api: Api): Promise<AliyunDriveStatus> {
  return api.get('/api/aliyundrive/status');
}

export function saveAliyunDriveConfig(api: Api, payload: Record<string, unknown>) {
  return api.put('/api/aliyundrive/config', payload);
}

export function startAliyunDriveOAuth(api: Api): Promise<{ state: string; authorizationUrl: string; expiresAt: number }> {
  return api.post('/api/aliyundrive/oauth/start', {});
}

export function completeAliyunDriveOAuth(api: Api, payload: { state: string; code: string }): Promise<AliyunDriveStatus> {
  return api.post('/api/aliyundrive/oauth/complete', payload);
}
```

- [ ] **Step 3: Implement page**

Create `apps/web/src/pages/AliyunDrivePage.tsx`:

```tsx
import { useEffect, useState } from 'react';
import { Alert, Button, Card, Descriptions, Form, Input, InputNumber, QRCode, Space, Table, Tag, Typography, message } from 'antd';
import type { Api } from '../api/http';
import { completeAliyunDriveOAuth, getAliyunDriveStatus, saveAliyunDriveConfig, startAliyunDriveOAuth, type AliyunDriveStatus } from '../api/aliyundrive';

interface Props { api: Api }

export function AliyunDrivePage({ api }: Props) {
  const [form] = Form.useForm();
  const [codeForm] = Form.useForm();
  const [status, setStatus] = useState<AliyunDriveStatus | null>(null);
  const [oauth, setOauth] = useState<{ state: string; authorizationUrl: string } | null>(null);
  const [loading, setLoading] = useState(false);

  async function refresh() {
    const next = await getAliyunDriveStatus(api);
    setStatus(next);
    form.setFieldsValue({
      clientId: next.clientId,
      scope: next.scope ?? 'user:base,file:all:read,file:all:write',
      openapiBase: next.openapiBase ?? 'https://openapi.alipan.com',
      redirectUri: next.redirectUri ?? 'oob',
      transferFolder: next.transferFolder ?? 'RemoteAgentGatewayTransfers',
      cleanupTtlHours: Math.round((next.cleanupTtlMs ?? 86400000) / 3600000),
    });
  }

  useEffect(() => { void refresh(); }, []);

  async function saveConfig(values: any) {
    setLoading(true);
    try {
      await saveAliyunDriveConfig(api, { ...values, cleanupTtlMs: Number(values.cleanupTtlHours ?? 24) * 3600000 });
      message.success('阿里云盘配置已保存');
      await refresh();
    } finally { setLoading(false); }
  }

  async function startOAuth() {
    setLoading(true);
    try { setOauth(await startAliyunDriveOAuth(api)); }
    finally { setLoading(false); }
  }

  async function completeOAuth(values: { code: string }) {
    if (!oauth) return;
    setLoading(true);
    try {
      setStatus(await completeAliyunDriveOAuth(api, { state: oauth.state, code: values.code }));
      setOauth(null);
      codeForm.resetFields();
      message.success('阿里云盘授权完成');
    } finally { setLoading(false); }
  }

  return (
    <Space direction="vertical" size="large" style={{ width: '100%' }}>
      <Card title="阿里云盘状态">
        <Descriptions column={2} bordered size="small">
          <Descriptions.Item label="配置状态">{status?.configured ? <Tag color="blue">已配置</Tag> : <Tag>未配置</Tag>}</Descriptions.Item>
          <Descriptions.Item label="授权状态">{status?.authorized ? <Tag color="green">已授权</Tag> : <Tag color="red">未授权</Tag>}</Descriptions.Item>
          <Descriptions.Item label="Drive ID">{status?.driveId ?? '-'}</Descriptions.Item>
          <Descriptions.Item label="过期时间">{status?.expiresAt ? new Date(status.expiresAt).toLocaleString() : '-'}</Descriptions.Item>
        </Descriptions>
      </Card>

      <Card title="应用配置">
        <Form form={form} layout="vertical" onFinish={saveConfig}>
          <Form.Item name="clientId" label="client_id" rules={[{ required: true, message: '请输入 client_id' }]}><Input /></Form.Item>
          <Form.Item name="clientSecret" label="client_secret（可选）"><Input.Password /></Form.Item>
          <Form.Item name="scope" label="scope"><Input /></Form.Item>
          <Form.Item name="openapiBase" label="openapi_base"><Input /></Form.Item>
          <Form.Item name="redirectUri" label="redirect_uri"><Input /></Form.Item>
          <Form.Item name="transferFolder" label="中转目录"><Input /></Form.Item>
          <Form.Item name="cleanupTtlHours" label="清理 TTL（小时）"><InputNumber min={1} /></Form.Item>
          <Button type="primary" htmlType="submit" loading={loading}>保存配置</Button>
        </Form>
      </Card>

      <Card title="OAuth 授权">
        <Space direction="vertical">
          <Button onClick={startOAuth} loading={loading}>生成授权二维码</Button>
          {oauth ? <><QRCode value={oauth.authorizationUrl} /><Typography.Text copyable>授权链接：{oauth.authorizationUrl}</Typography.Text><Form form={codeForm} layout="inline" onFinish={completeOAuth}><Form.Item name="code" rules={[{ required: true, message: '请输入授权 code' }]}><Input placeholder="粘贴授权 code" /></Form.Item><Button type="primary" htmlType="submit" loading={loading}>完成授权</Button></Form></> : <Alert type="info" message="生成授权二维码后，扫码或打开链接完成授权，再粘贴 code。" />}
        </Space>
      </Card>

      <Card title="Transfer 监控">
        <Table rowKey="id" dataSource={[]} columns={[{ title: 'ID', dataIndex: 'id' }, { title: 'Client', dataIndex: 'clientId' }, { title: '文件名', dataIndex: 'filename' }, { title: '状态', dataIndex: 'status' }, { title: '上传', dataIndex: 'uploadedBytes' }, { title: '下载', dataIndex: 'downloadedBytes' }, { title: '清理', dataIndex: 'cleanupStatus' }]} />
      </Card>
    </Space>
  );
}
```

- [ ] **Step 4: Add navigation**

Modify `apps/web/src/components/AppLayout.tsx` imports:

```tsx
import { CloudUploadOutlined } from '@ant-design/icons';
```

Add menu item:

```tsx
{ key: 'aliyundrive', icon: <CloudUploadOutlined />, label: '阿里云盘' },
```

Modify `apps/web/src/App.tsx`:

- Import `AliyunDrivePage`.
- Add route type `{ page: 'aliyundrive' }`.
- Add switch case rendering `<AliyunDrivePage api={api} />`.
- Add navigation mapping for `aliyundrive`.

- [ ] **Step 5: Run Web tests**

```bash
pnpm --filter @rag/web test -- AliyunDrivePage.test.tsx
pnpm --filter @rag/web typecheck
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/api/http.ts apps/web/src/api/aliyundrive.ts apps/web/src/pages/AliyunDrivePage.tsx apps/web/src/pages/AliyunDrivePage.test.tsx apps/web/src/components/AppLayout.tsx apps/web/src/App.tsx
git commit -m "feat(web): add aliyundrive configuration page"
```

---

## Task 9: Cleanup service, docs, and full verification

**Files:**
- Create: `apps/server/src/modules/transfers/transfer-cleanup.service.ts`
- Modify: `apps/server/src/main.ts`
- Modify: `README.md`
- Modify: `docs/TESTING.md`
- Test: `apps/server/src/modules/transfers/transfer-cleanup.service.test.ts`

- [ ] **Step 1: Write cleanup service test**

Create `apps/server/src/modules/transfers/transfer-cleanup.service.test.ts`:

```ts
import { describe, expect, it, vi } from 'vitest';
import { computeCleanupAfter } from './transfer-cleanup.service.js';

describe('transfer cleanup', () => {
  it('computes cleanup time from completion and ttl', () => {
    expect(computeCleanupAfter(1000, 24 * 60 * 60 * 1000)).toBe(86_401_000);
  });
});
```

- [ ] **Step 2: Implement cleanup service**

Create `apps/server/src/modules/transfers/transfer-cleanup.service.ts`:

```ts
import { getDb, saveDb } from '../../db/index.js';
import { aliyunDriveAuthService } from '../aliyundrive/aliyundrive-auth.service.js';
import { AliyunDriveOpenApiClient } from '../aliyundrive/aliyundrive-openapi.client.js';

export function computeCleanupAfter(completedAt: number, ttlMs: number): number {
  return completedAt + ttlMs;
}

export class TransferCleanupService {
  private timer: ReturnType<typeof setInterval> | null = null;

  start(intervalMs = 60 * 60 * 1000): void {
    if (this.timer) return;
    this.timer = setInterval(() => {
      void this.runOnce().catch((error) => console.warn('[transfer-cleanup] failed:', error instanceof Error ? error.message : error));
    }, intervalMs);
  }

  stop(): void {
    if (!this.timer) return;
    clearInterval(this.timer);
    this.timer = null;
  }

  async runOnce(now = Date.now()): Promise<void> {
    const auth = aliyunDriveAuthService.getAuth();
    const config = aliyunDriveAuthService.getConfig();
    if (!auth?.accessToken || !config) return;
    const client = new AliyunDriveOpenApiClient({ openapiBase: config.openapiBase, accessToken: auth.accessToken });
    const stmt = getDb().prepare("SELECT id, aliyun_drive_id, aliyun_file_id FROM transfer_jobs WHERE cleanup_status='cleanup_pending' AND cleanup_after_at IS NOT NULL AND cleanup_after_at <= ?");
    stmt.bind([now]);
    const rows: Array<{ id: string; driveId: string; fileId: string }> = [];
    try {
      while (stmt.step()) {
        const row = stmt.getAsObject() as Record<string, unknown>;
        rows.push({ id: String(row.id), driveId: String(row.aliyun_drive_id), fileId: String(row.aliyun_file_id) });
      }
    } finally { stmt.free(); }
    for (const row of rows) {
      try {
        await client.deleteFile({ driveId: row.driveId, fileId: row.fileId });
        getDb().run("UPDATE transfer_jobs SET cleanup_status='cleanup_done', updated_at=? WHERE id=?", [Date.now(), row.id]);
      } catch (error) {
        getDb().run("UPDATE transfer_jobs SET cleanup_status='cleanup_failed', error_message=?, updated_at=? WHERE id=?", [error instanceof Error ? error.message : String(error), Date.now(), row.id]);
      }
    }
    if (rows.length > 0) saveDb();
  }
}

export const transferCleanupService = new TransferCleanupService();
```

- [ ] **Step 3: Register cleanup service**

Modify `apps/server/src/main.ts`:

```ts
import { transferCleanupService } from './modules/transfers/transfer-cleanup.service.js';
```

After route registration:

```ts
  transferCleanupService.start();
```

Inside shutdown:

```ts
    transferCleanupService.stop();
```

- [ ] **Step 4: Update docs**

Add a README section after file upload documentation:

```md
### 阿里云盘中转上传

当 Web 管理台已配置并授权阿里云盘后，`rag files upload` 默认使用阿里云盘作为中转：CLI 将文件分片上传到阿里云盘，server 通过 WebSocket 通知目标 client 下载，client 直连阿里云盘并写入目标 allowed root。frps 不承载文件主体数据。

未配置或未授权阿里云盘时，CLI 自动回退到现有 frps chunked upload。

可通过参数控制传输模式：

```bash
rag files upload --client <id> --root <root> --path <dir> --file <file> --transfer auto
rag files upload --client <id> --root <root> --path <dir> --file <file> --transfer aliyundrive
rag files upload --client <id> --root <root> --path <dir> --file <file> --transfer direct
```
```

Add `docs/TESTING.md` notes for unit tests:

```md
### Aliyun Drive transfer tests

```bash
pnpm --filter @rag/shared test -- transfer-contracts.test.ts
pnpm --filter @rag/server test -- aliyundrive transfer
pnpm --filter @rag/cli test -- aliyundrive-upload.test.ts commands.test.ts
pnpm --filter @rag/client test -- aliyundrive-download-executor.test.ts
pnpm --filter @rag/web test -- AliyunDrivePage.test.tsx
```
```

- [ ] **Step 5: Run targeted tests**

```bash
pnpm --filter @rag/server test -- transfer-cleanup.service.test.ts
pnpm --filter @rag/server typecheck
```

Expected: PASS.

- [ ] **Step 6: Run full verification**

```bash
pnpm --filter @rag/shared test
pnpm --filter @rag/server test
pnpm --filter @rag/client test
pnpm --filter @rag/cli test
pnpm --filter @rag/web test
pnpm typecheck
pnpm build
```

Expected: all commands PASS.

- [ ] **Step 7: Commit**

```bash
git add apps/server/src/modules/transfers/transfer-cleanup.service.ts apps/server/src/modules/transfers/transfer-cleanup.service.test.ts apps/server/src/main.ts README.md docs/TESTING.md
git commit -m "docs: document aliyundrive transfer workflow"
```

---

## Self-review notes

Spec coverage:

- Aliyun OAuth and Web config: Task 3 and Task 8.
- Server-managed transfer state: Task 2 and Task 5.
- CLI default mode with fallback: Task 6.
- Client WebSocket download path: Task 7.
- Web page QR/code flow and transfer visibility foundation: Task 8.
- Large-file multipart planning: Task 4 and Task 6.
- Token non-persistence and event redaction: Task 2, Task 3, Task 5, Task 6, Task 7.
- TTL cleanup: Task 9.
- Verification: Task 9.

Type consistency:

- Shared status strings match DB and API names.
- CLI transfer modes are `auto | aliyundrive | direct`; server job modes are `aliyundrive | frps_chunked`.
- WebSocket message names match shared protocol additions.

Implementation caution:

- Any code that logs transfer payloads must pass through `sanitizeTransferEventPayload` first.
- Do not write `accessToken`, `refreshToken`, `uploadUrl`, `downloadUrl`, or `Authorization` values into event payloads, browser-visible status objects, or CLI JSON output.
- Use current allowed-root helpers for all client writes.
