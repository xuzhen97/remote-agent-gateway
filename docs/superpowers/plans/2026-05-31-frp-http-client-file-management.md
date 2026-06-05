# FRP HTTP Client File Management Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build remote client file management where WebSocket remains the control plane and FRP-exposed HTTP is the file data plane.

**Architecture:** The server starts a local-only HTTP file service on the client through WebSocket tasks, creates an FRP mapping to expose that service, and proxies authenticated file operations through the mapped HTTP endpoint. Client file operations are restricted to `workspaceDir`; server APIs hide raw FRP URLs from normal callers and centralize auth, audit, task/session state, and error handling.

**Tech Stack:** Node.js 22, TypeScript, Fastify, WebSocket `ws`, SQLite via `sql.js`, existing FRP daemon, built-in `node:http`, built-in `node:fs`, built-in `fetch`, Vitest, existing E2E harness.

---

## Scope

This plan implements the first production-usable version of client file management:

- Start, stop, and inspect a client's local HTTP file service.
- Expose that local service through existing FRP mapping infrastructure.
- Proxy file operations through server APIs.
- Support list, stat, read/download, write/upload, delete, mkdir, move/rename, and copy.
- Restrict all file paths to client `workspaceDir`.
- Use short-lived file-service bearer tokens separate from admin/agent API tokens.
- Add tests proving that file transfer uses HTTP data plane while WebSocket only coordinates startup and status.

Out of scope for this first pass:

- Full-disk access outside `workspaceDir`.
- Multi-user permissions.
- File diff/patch UI.
- Streaming preview thumbnails.
- Resumable upload with Range/chunk protocol. The HTTP design leaves room for this later.

---

## File Structure

### Shared Package

- Modify: `packages/shared/src/types.ts`
  - Add file-service task types and payload/result interfaces.
  - Add client-file operation request/response types.

- Modify: `packages/shared/src/schemas.ts`
  - Add Zod schemas for file-service tasks and client-file operation payloads.

- Modify: `packages/shared/src/__tests__/schemas.test.ts`
  - Add schema tests for new task types and file operation payloads.

### Client

- Create: `apps/client/src/runtime/file-paths.ts`
  - Normalize and validate paths under `workspaceDir`.
  - Provide helpers for safe file metadata.

- Create: `apps/client/src/runtime/file-http-server.ts`
  - Local-only HTTP server bound to `127.0.0.1`.
  - Implements REST-ish file APIs.
  - Validates `Authorization: Bearer <token>`.

- Create: `apps/client/src/runtime/file-http-server.test.ts`
  - Unit tests for server operations using a temporary workspace.

- Create: `apps/client/src/executors/file-service-start.executor.ts`
  - Start the local file HTTP server.
  - Return selected local port and service token.

- Create: `apps/client/src/executors/file-service-stop.executor.ts`
  - Stop the local file HTTP server.

- Create: `apps/client/src/executors/file-service-status.executor.ts`
  - Return running status, port, and uptime.

- Modify: `apps/client/src/core/task-dispatcher.ts`
  - Route new file-service task types to executors.

### Server

- Create: `apps/server/src/modules/client-files/client-file-sessions.service.ts`
  - Track client file service sessions in memory and SQLite-backed mappings.
  - Start file service and FRP mapping when needed.
  - Return public HTTP endpoint and token.

- Create: `apps/server/src/modules/client-files/client-file-proxy.service.ts`
  - Proxy operations to client file HTTP service through FRP public URL.
  - Normalize errors and stream file bodies.

- Create: `apps/server/src/modules/client-files/client-files.routes.ts`
  - Public server API for remote client file operations.

- Create: `apps/server/src/modules/client-files/client-files.service.test.ts`
  - Unit tests for session creation and proxy request building.

- Modify: `apps/server/src/main.ts`
  - Register new client-file routes.

- Modify: `apps/server/src/db/migrate.ts`
  - Add optional `client_file_sessions` table if persistent session records are desired.

### E2E and Docs

- Modify: `scripts/e2e-test.ts`
  - Add integration tests covering start session, mkdir, write, list, read, move, copy, delete, and download.

- Modify: `README.md`
  - Document remote client file management APIs.

- Modify: `docs/排查报告-服务端到客户端命令执行.md` only if implementation changes the previous conclusion.

---

## API Design

### Control APIs

```http
POST /api/clients/:clientId/file-session/start
GET  /api/clients/:clientId/file-session
POST /api/clients/:clientId/file-session/stop
```

### File Operation APIs

```http
GET    /api/clients/:clientId/files?path=.
GET    /api/clients/:clientId/files/stat?path=.
GET    /api/clients/:clientId/files/read?path=notes/a.txt
GET    /api/clients/:clientId/files/download?path=notes/a.txt
PUT    /api/clients/:clientId/files/write?path=notes/a.txt
POST   /api/clients/:clientId/files/upload?path=notes
DELETE /api/clients/:clientId/files?path=notes/a.txt
POST   /api/clients/:clientId/files/mkdir
POST   /api/clients/:clientId/files/move
POST   /api/clients/:clientId/files/copy
```

### Client Local HTTP API

The client local server exposes equivalent internal endpoints under `/v1`:

```http
GET    /v1/list?path=.
GET    /v1/stat?path=.
GET    /v1/read?path=notes/a.txt
GET    /v1/download?path=notes/a.txt
PUT    /v1/write?path=notes/a.txt
POST   /v1/upload?path=notes&filename=a.txt
DELETE /v1/delete?path=notes/a.txt&recursive=false
POST   /v1/mkdir
POST   /v1/move
POST   /v1/copy
GET    /v1/health
```

Every local endpoint requires:

```http
Authorization: Bearer <sessionToken>
```

---

## Task 1: Shared Types and Schemas

**Files:**
- Modify: `packages/shared/src/types.ts`
- Modify: `packages/shared/src/schemas.ts`
- Modify: `packages/shared/src/__tests__/schemas.test.ts`

- [ ] **Step 1: Add failing schema tests**

Append tests to `packages/shared/src/__tests__/schemas.test.ts`:

```ts
import {
  FileServiceStartPayloadSchema,
  FileServiceStopPayloadSchema,
  FileServiceStatusPayloadSchema,
  ClientFilePathPayloadSchema,
  ClientFileMovePayloadSchema,
  ClientFileCopyPayloadSchema,
  ClientFileMkdirPayloadSchema,
} from '../schemas.js';

describe('client file management schemas', () => {
  it('accepts file service task payloads', () => {
    expect(TaskTypeSchema.parse('file_service_start')).toBe('file_service_start');
    expect(TaskTypeSchema.parse('file_service_stop')).toBe('file_service_stop');
    expect(TaskTypeSchema.parse('file_service_status')).toBe('file_service_status');

    expect(FileServiceStartPayloadSchema.parse({ port: 0, token: 'tok_abc', ttlMs: 600000 })).toEqual({
      port: 0,
      token: 'tok_abc',
      ttlMs: 600000,
    });
    expect(FileServiceStopPayloadSchema.parse({})).toEqual({});
    expect(FileServiceStatusPayloadSchema.parse({})).toEqual({});
  });

  it('accepts client file operation payloads', () => {
    expect(ClientFilePathPayloadSchema.parse({ path: 'notes/a.txt' })).toEqual({ path: 'notes/a.txt' });
    expect(ClientFileMkdirPayloadSchema.parse({ path: 'notes', recursive: true })).toEqual({ path: 'notes', recursive: true });
    expect(ClientFileMovePayloadSchema.parse({ from: 'notes/a.txt', to: 'archive/a.txt', overwrite: false })).toEqual({
      from: 'notes/a.txt',
      to: 'archive/a.txt',
      overwrite: false,
    });
    expect(ClientFileCopyPayloadSchema.parse({ from: 'archive/a.txt', to: 'copy/a.txt', overwrite: true })).toEqual({
      from: 'archive/a.txt',
      to: 'copy/a.txt',
      overwrite: true,
    });
  });

  it('rejects absolute paths and traversal paths in client file operation payloads', () => {
    expect(() => ClientFilePathPayloadSchema.parse({ path: '../secret.txt' })).toThrow();
    expect(() => ClientFilePathPayloadSchema.parse({ path: '/etc/passwd' })).toThrow();
    expect(() => ClientFilePathPayloadSchema.parse({ path: 'C:\\Windows\\win.ini' })).toThrow();
  });
});
```

- [ ] **Step 2: Run schema tests and verify failure**

Run:

```bash
pnpm --filter @rag/shared test -- schemas.test.ts
```

Expected: FAIL because the imported schemas and task types do not exist yet.

- [ ] **Step 3: Add shared task types**

Modify `packages/shared/src/types.ts`:

```ts
export const TASK_TYPES = [
  'health_check',
  'exec_script',
  'exec_command',
  'push_file',
  'frp_create_proxy',
  'frp_remove_proxy',
  'frpc_start',
  'frpc_stop',
  'file_service_start',
  'file_service_stop',
  'file_service_status',
] as const;
```

Add interfaces below `HealthCheckPayload`:

```ts
export interface FileServiceStartPayload {
  port?: number;
  token: string;
  ttlMs?: number;
}

export interface FileServiceStopPayload {}

export interface FileServiceStatusPayload {}

export interface FileServiceStartResult {
  running: true;
  host: '127.0.0.1';
  port: number;
  startedAt: number;
  expiresAt?: number;
}

export interface FileServiceStatusResult {
  running: boolean;
  host: '127.0.0.1';
  port?: number;
  startedAt?: number;
  uptimeMs?: number;
  expiresAt?: number;
}

export interface ClientFileEntry {
  name: string;
  path: string;
  type: 'file' | 'directory' | 'other';
  size: number;
  mtimeMs: number;
}

export interface ClientFileStat {
  path: string;
  type: 'file' | 'directory' | 'other';
  size: number;
  mtimeMs: number;
  ctimeMs: number;
}
```

Update `TaskPayloadMap`:

```ts
export type TaskPayloadMap = {
  health_check: HealthCheckPayload;
  exec_script: ExecScriptPayload;
  exec_command: ExecCommandPayload;
  push_file: PushFilePayload;
  frp_create_proxy: FrpCreateProxyPayload;
  frp_remove_proxy: FrpRemoveProxyPayload;
  frpc_start: FrpcStartPayload;
  frpc_stop: FrpcStopPayload;
  file_service_start: FileServiceStartPayload;
  file_service_stop: FileServiceStopPayload;
  file_service_status: FileServiceStatusPayload;
};
```

- [ ] **Step 4: Add shared schemas**

Add path validator and schemas to `packages/shared/src/schemas.ts`:

```ts
const RelativeClientPathSchema = z.string().min(1).max(2048).refine((value) => {
  const normalized = value.replace(/\\/g, '/');
  if (normalized.startsWith('/')) return false;
  if (/^[A-Za-z]:\//.test(normalized)) return false;
  return !normalized.split('/').some((part) => part === '..');
}, 'Path must be relative and stay inside client workspace');

export const FileServiceStartPayloadSchema = z.object({
  port: z.number().int().min(0).max(65535).optional().default(0),
  token: z.string().min(16).max(256),
  ttlMs: z.number().int().positive().max(24 * 60 * 60 * 1000).optional(),
});

export const FileServiceStopPayloadSchema = z.object({});
export const FileServiceStatusPayloadSchema = z.object({});

export const ClientFilePathPayloadSchema = z.object({
  path: RelativeClientPathSchema,
});

export const ClientFileMkdirPayloadSchema = z.object({
  path: RelativeClientPathSchema,
  recursive: z.boolean().optional().default(true),
});

export const ClientFileDeletePayloadSchema = z.object({
  path: RelativeClientPathSchema,
  recursive: z.boolean().optional().default(false),
});

export const ClientFileMovePayloadSchema = z.object({
  from: RelativeClientPathSchema,
  to: RelativeClientPathSchema,
  overwrite: z.boolean().optional().default(false),
});

export const ClientFileCopyPayloadSchema = z.object({
  from: RelativeClientPathSchema,
  to: RelativeClientPathSchema,
  overwrite: z.boolean().optional().default(false),
});

export const ClientFileWriteQuerySchema = z.object({
  path: RelativeClientPathSchema,
});
```

- [ ] **Step 5: Run schema tests and verify pass**

Run:

```bash
pnpm --filter @rag/shared test -- schemas.test.ts
```

Expected: PASS.

- [ ] **Step 6: Run typecheck**

Run:

```bash
pnpm --filter @rag/shared typecheck
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add packages/shared/src/types.ts packages/shared/src/schemas.ts packages/shared/src/__tests__/schemas.test.ts
git commit -m "feat(shared): add client file management protocol types"
```

---

## Task 2: Client File Path Utilities

**Files:**
- Create: `apps/client/src/runtime/file-paths.ts`
- Create: `apps/client/src/runtime/file-paths.test.ts`

- [ ] **Step 1: Write failing path utility tests**

Create `apps/client/src/runtime/file-paths.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import * as path from 'node:path';
import { resolveClientFilePath, toClientFileEntry, toClientFileStat } from './file-paths.js';

describe('client file path utilities', () => {
  const workspace = path.resolve('tmp-test-workspace');

  it('resolves relative paths inside workspace', () => {
    expect(resolveClientFilePath(workspace, 'notes/a.txt')).toBe(path.join(workspace, 'notes', 'a.txt'));
    expect(resolveClientFilePath(workspace, '.')).toBe(workspace);
  });

  it('rejects traversal and absolute paths', () => {
    expect(() => resolveClientFilePath(workspace, '../x.txt')).toThrow('Path traversal denied');
    expect(() => resolveClientFilePath(workspace, '/tmp/x.txt')).toThrow('Path traversal denied');
    expect(() => resolveClientFilePath(workspace, 'C:\\Windows\\win.ini')).toThrow('Path traversal denied');
  });

  it('converts fs stats to API metadata', () => {
    const fakeStats = {
      isFile: () => true,
      isDirectory: () => false,
      size: 12,
      mtimeMs: 1000,
      ctimeMs: 900,
    } as import('node:fs').Stats;

    expect(toClientFileEntry('a.txt', 'notes/a.txt', fakeStats)).toEqual({
      name: 'a.txt',
      path: 'notes/a.txt',
      type: 'file',
      size: 12,
      mtimeMs: 1000,
    });

    expect(toClientFileStat('notes/a.txt', fakeStats)).toEqual({
      path: 'notes/a.txt',
      type: 'file',
      size: 12,
      mtimeMs: 1000,
      ctimeMs: 900,
    });
  });
});
```

- [ ] **Step 2: Run test and verify failure**

Run:

```bash
pnpm --filter @rag/client test -- file-paths.test.ts
```

Expected: FAIL because `file-paths.ts` does not exist.

- [ ] **Step 3: Implement path utilities**

Create `apps/client/src/runtime/file-paths.ts`:

```ts
import * as path from 'node:path';
import type { Stats } from 'node:fs';
import type { ClientFileEntry, ClientFileStat } from '@rag/shared';

function normalizeRelativePath(input: string): string {
  const normalized = input.replace(/\\/g, '/').trim();
  if (normalized === '' || normalized === '.') return '.';
  if (normalized.startsWith('/')) throw new Error('Path traversal denied: absolute paths are not allowed');
  if (/^[A-Za-z]:\//.test(normalized)) throw new Error('Path traversal denied: drive paths are not allowed');
  if (normalized.split('/').some((part) => part === '..')) {
    throw new Error('Path traversal denied: parent segments are not allowed');
  }
  return normalized;
}

export function resolveClientFilePath(workspaceDir: string, clientPath: string): string {
  const workspace = path.resolve(workspaceDir);
  const relative = normalizeRelativePath(clientPath);
  const resolved = relative === '.' ? workspace : path.resolve(workspace, relative);

  if (resolved !== workspace && !resolved.startsWith(workspace + path.sep)) {
    throw new Error(`Path traversal denied: ${clientPath} is outside workspace`);
  }

  return resolved;
}

export function detectFileType(stats: Stats): 'file' | 'directory' | 'other' {
  if (stats.isFile()) return 'file';
  if (stats.isDirectory()) return 'directory';
  return 'other';
}

export function toClientFileEntry(name: string, clientPath: string, stats: Stats): ClientFileEntry {
  return {
    name,
    path: clientPath.replace(/\\/g, '/'),
    type: detectFileType(stats),
    size: stats.size,
    mtimeMs: stats.mtimeMs,
  };
}

export function toClientFileStat(clientPath: string, stats: Stats): ClientFileStat {
  return {
    path: clientPath.replace(/\\/g, '/'),
    type: detectFileType(stats),
    size: stats.size,
    mtimeMs: stats.mtimeMs,
    ctimeMs: stats.ctimeMs,
  };
}
```

- [ ] **Step 4: Run tests and verify pass**

Run:

```bash
pnpm --filter @rag/client test -- file-paths.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/client/src/runtime/file-paths.ts apps/client/src/runtime/file-paths.test.ts
git commit -m "feat(client): add safe file path utilities"
```

---

## Task 3: Client Local HTTP File Server

**Files:**
- Create: `apps/client/src/runtime/file-http-server.ts`
- Create: `apps/client/src/runtime/file-http-server.test.ts`

- [ ] **Step 1: Write failing HTTP server tests**

Create `apps/client/src/runtime/file-http-server.test.ts`:

```ts
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { startFileHttpServer, stopFileHttpServer } from './file-http-server.js';

const token = 'tok_1234567890123456';
let workspace: string;
let baseUrl: string;

async function request(pathname: string, init?: RequestInit) {
  return fetch(`${baseUrl}${pathname}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      ...(init?.headers ?? {}),
    },
  });
}

describe('file HTTP server', () => {
  beforeEach(async () => {
    workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'rag-file-http-'));
    const server = await startFileHttpServer({ workspaceDir: workspace, port: 0, token });
    baseUrl = `http://${server.host}:${server.port}`;
  });

  afterEach(async () => {
    await stopFileHttpServer();
    fs.rmSync(workspace, { recursive: true, force: true });
  });

  it('requires bearer token', async () => {
    const response = await fetch(`${baseUrl}/v1/health`);
    expect(response.status).toBe(401);
  });

  it('creates directories, writes files, lists entries, reads files, and stats files', async () => {
    expect((await request('/v1/mkdir', {
      method: 'POST',
      body: JSON.stringify({ path: 'notes', recursive: true }),
      headers: { 'Content-Type': 'application/json' },
    })).status).toBe(200);

    expect((await request('/v1/write?path=notes/a.txt', {
      method: 'PUT',
      body: 'hello file plane',
    })).status).toBe(200);

    const listResponse = await request('/v1/list?path=notes');
    expect(listResponse.status).toBe(200);
    const listBody = await listResponse.json() as { entries: { name: string; path: string; type: string }[] };
    expect(listBody.entries).toContainEqual(expect.objectContaining({ name: 'a.txt', path: 'notes/a.txt', type: 'file' }));

    const readResponse = await request('/v1/read?path=notes/a.txt');
    expect(await readResponse.text()).toBe('hello file plane');

    const statResponse = await request('/v1/stat?path=notes/a.txt');
    const statBody = await statResponse.json() as { path: string; type: string; size: number };
    expect(statBody).toEqual(expect.objectContaining({ path: 'notes/a.txt', type: 'file', size: 16 }));
  });

  it('moves, copies, and deletes files', async () => {
    await request('/v1/mkdir', {
      method: 'POST',
      body: JSON.stringify({ path: 'notes', recursive: true }),
      headers: { 'Content-Type': 'application/json' },
    });
    await request('/v1/write?path=notes/a.txt', { method: 'PUT', body: 'abc' });

    const moveResponse = await request('/v1/move', {
      method: 'POST',
      body: JSON.stringify({ from: 'notes/a.txt', to: 'notes/b.txt', overwrite: false }),
      headers: { 'Content-Type': 'application/json' },
    });
    expect(moveResponse.status).toBe(200);

    const copyResponse = await request('/v1/copy', {
      method: 'POST',
      body: JSON.stringify({ from: 'notes/b.txt', to: 'notes/c.txt', overwrite: false }),
      headers: { 'Content-Type': 'application/json' },
    });
    expect(copyResponse.status).toBe(200);

    expect(await (await request('/v1/read?path=notes/c.txt')).text()).toBe('abc');

    const deleteResponse = await request('/v1/delete?path=notes/b.txt', { method: 'DELETE' });
    expect(deleteResponse.status).toBe(200);

    expect((await request('/v1/stat?path=notes/b.txt')).status).toBe(404);
  });

  it('rejects traversal paths', async () => {
    const response = await request('/v1/read?path=../secret.txt');
    expect(response.status).toBe(400);
  });
});
```

- [ ] **Step 2: Run test and verify failure**

Run:

```bash
pnpm --filter @rag/client test -- file-http-server.test.ts
```

Expected: FAIL because `file-http-server.ts` does not exist.

- [ ] **Step 3: Implement local HTTP file server**

Create `apps/client/src/runtime/file-http-server.ts` with a focused `node:http` server:

```ts
import * as http from 'node:http';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { once } from 'node:events';
import { resolveClientFilePath, toClientFileEntry, toClientFileStat } from './file-paths.js';

interface StartOptions {
  workspaceDir: string;
  port?: number;
  token: string;
  ttlMs?: number;
}

export interface FileHttpServerState {
  running: true;
  host: '127.0.0.1';
  port: number;
  startedAt: number;
  expiresAt?: number;
}

let activeServer: http.Server | null = null;
let activeState: FileHttpServerState | null = null;
let activeToken = '';
let activeWorkspace = '';
let expiryTimer: ReturnType<typeof setTimeout> | null = null;

function sendJson(res: http.ServerResponse, status: number, body: unknown): void {
  const payload = Buffer.from(JSON.stringify(body));
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': payload.length,
  });
  res.end(payload);
}

function sendError(res: http.ServerResponse, status: number, message: string): void {
  sendJson(res, status, { error: message });
}

async function readBody(req: http.IncomingMessage): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return Buffer.concat(chunks);
}

async function readJson<T>(req: http.IncomingMessage): Promise<T> {
  const body = await readBody(req);
  return JSON.parse(body.toString('utf-8')) as T;
}

function ensureAuthorized(req: http.IncomingMessage): boolean {
  return req.headers.authorization === `Bearer ${activeToken}`;
}

function queryPath(url: URL): string {
  return url.searchParams.get('path') ?? '.';
}

async function handleRequest(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
  if (!ensureAuthorized(req)) {
    sendError(res, 401, 'Unauthorized');
    return;
  }

  const url = new URL(req.url ?? '/', 'http://127.0.0.1');

  try {
    if (req.method === 'GET' && url.pathname === '/v1/health') {
      sendJson(res, 200, { ok: true, ...activeState });
      return;
    }

    if (req.method === 'GET' && url.pathname === '/v1/list') {
      const clientPath = queryPath(url);
      const fullPath = resolveClientFilePath(activeWorkspace, clientPath);
      const names = fs.readdirSync(fullPath);
      const entries = names.map((name) => {
        const childClientPath = clientPath === '.' ? name : path.posix.join(clientPath.replace(/\\/g, '/'), name);
        return toClientFileEntry(name, childClientPath, fs.statSync(path.join(fullPath, name)));
      });
      sendJson(res, 200, { path: clientPath, entries });
      return;
    }

    if (req.method === 'GET' && url.pathname === '/v1/stat') {
      const clientPath = queryPath(url);
      const fullPath = resolveClientFilePath(activeWorkspace, clientPath);
      if (!fs.existsSync(fullPath)) {
        sendError(res, 404, 'Not found');
        return;
      }
      sendJson(res, 200, toClientFileStat(clientPath, fs.statSync(fullPath)));
      return;
    }

    if (req.method === 'GET' && (url.pathname === '/v1/read' || url.pathname === '/v1/download')) {
      const clientPath = queryPath(url);
      const fullPath = resolveClientFilePath(activeWorkspace, clientPath);
      if (!fs.existsSync(fullPath) || !fs.statSync(fullPath).isFile()) {
        sendError(res, 404, 'File not found');
        return;
      }
      const content = fs.readFileSync(fullPath);
      res.writeHead(200, {
        'Content-Type': 'application/octet-stream',
        'Content-Length': content.length,
        'Content-Disposition': `attachment; filename="${path.basename(fullPath)}"`,
      });
      res.end(content);
      return;
    }

    if (req.method === 'PUT' && url.pathname === '/v1/write') {
      const clientPath = queryPath(url);
      const fullPath = resolveClientFilePath(activeWorkspace, clientPath);
      fs.mkdirSync(path.dirname(fullPath), { recursive: true });
      const body = await readBody(req);
      fs.writeFileSync(fullPath, body);
      sendJson(res, 200, { path: clientPath, size: body.length });
      return;
    }

    if (req.method === 'POST' && url.pathname === '/v1/upload') {
      const targetDir = resolveClientFilePath(activeWorkspace, queryPath(url));
      const filename = url.searchParams.get('filename');
      if (!filename || filename.includes('/') || filename.includes('\\')) {
        sendError(res, 400, 'Invalid filename');
        return;
      }
      fs.mkdirSync(targetDir, { recursive: true });
      const body = await readBody(req);
      const fullPath = path.join(targetDir, filename);
      fs.writeFileSync(fullPath, body);
      sendJson(res, 200, { path: path.posix.join(queryPath(url), filename), size: body.length });
      return;
    }

    if (req.method === 'POST' && url.pathname === '/v1/mkdir') {
      const payload = await readJson<{ path: string; recursive?: boolean }>(req);
      const fullPath = resolveClientFilePath(activeWorkspace, payload.path);
      fs.mkdirSync(fullPath, { recursive: payload.recursive !== false });
      sendJson(res, 200, { path: payload.path });
      return;
    }

    if (req.method === 'DELETE' && url.pathname === '/v1/delete') {
      const clientPath = queryPath(url);
      const recursive = url.searchParams.get('recursive') === 'true';
      const fullPath = resolveClientFilePath(activeWorkspace, clientPath);
      if (!fs.existsSync(fullPath)) {
        sendError(res, 404, 'Not found');
        return;
      }
      fs.rmSync(fullPath, { recursive, force: false });
      sendJson(res, 200, { path: clientPath, deleted: true });
      return;
    }

    if (req.method === 'POST' && url.pathname === '/v1/move') {
      const payload = await readJson<{ from: string; to: string; overwrite?: boolean }>(req);
      const from = resolveClientFilePath(activeWorkspace, payload.from);
      const to = resolveClientFilePath(activeWorkspace, payload.to);
      if (!fs.existsSync(from)) {
        sendError(res, 404, 'Source not found');
        return;
      }
      if (fs.existsSync(to) && !payload.overwrite) {
        sendError(res, 409, 'Destination exists');
        return;
      }
      fs.mkdirSync(path.dirname(to), { recursive: true });
      if (fs.existsSync(to)) fs.rmSync(to, { recursive: true, force: true });
      fs.renameSync(from, to);
      sendJson(res, 200, { from: payload.from, to: payload.to });
      return;
    }

    if (req.method === 'POST' && url.pathname === '/v1/copy') {
      const payload = await readJson<{ from: string; to: string; overwrite?: boolean }>(req);
      const from = resolveClientFilePath(activeWorkspace, payload.from);
      const to = resolveClientFilePath(activeWorkspace, payload.to);
      if (!fs.existsSync(from)) {
        sendError(res, 404, 'Source not found');
        return;
      }
      if (fs.existsSync(to) && !payload.overwrite) {
        sendError(res, 409, 'Destination exists');
        return;
      }
      fs.mkdirSync(path.dirname(to), { recursive: true });
      fs.cpSync(from, to, { recursive: true, force: payload.overwrite === true });
      sendJson(res, 200, { from: payload.from, to: payload.to });
      return;
    }

    sendError(res, 404, 'Route not found');
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    sendError(res, message.includes('Path traversal denied') ? 400 : 500, message);
  }
}

export async function startFileHttpServer(options: StartOptions): Promise<FileHttpServerState> {
  await stopFileHttpServer();

  activeToken = options.token;
  activeWorkspace = options.workspaceDir;
  fs.mkdirSync(activeWorkspace, { recursive: true });

  activeServer = http.createServer((req, res) => {
    void handleRequest(req, res);
  });

  activeServer.listen(options.port ?? 0, '127.0.0.1');
  await once(activeServer, 'listening');

  const address = activeServer.address();
  if (!address || typeof address === 'string') throw new Error('Unable to determine file server port');

  activeState = {
    running: true,
    host: '127.0.0.1',
    port: address.port,
    startedAt: Date.now(),
    expiresAt: options.ttlMs ? Date.now() + options.ttlMs : undefined,
  };

  if (options.ttlMs) {
    expiryTimer = setTimeout(() => {
      void stopFileHttpServer();
    }, options.ttlMs);
  }

  return activeState;
}

export async function stopFileHttpServer(): Promise<void> {
  if (expiryTimer) {
    clearTimeout(expiryTimer);
    expiryTimer = null;
  }

  const server = activeServer;
  activeServer = null;
  activeState = null;
  activeToken = '';
  activeWorkspace = '';

  if (!server) return;
  await new Promise<void>((resolve, reject) => {
    server.close((err) => (err ? reject(err) : resolve()));
  });
}

export function getFileHttpServerStatus() {
  if (!activeState) return { running: false, host: '127.0.0.1' as const };
  return {
    ...activeState,
    uptimeMs: Date.now() - activeState.startedAt,
  };
}
```

- [ ] **Step 4: Run client runtime tests**

Run:

```bash
pnpm --filter @rag/client test -- file-http-server.test.ts file-paths.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/client/src/runtime/file-http-server.ts apps/client/src/runtime/file-http-server.test.ts
git commit -m "feat(client): add local HTTP file service"
```

---

## Task 4: Client File Service Executors

**Files:**
- Create: `apps/client/src/executors/file-service-start.executor.ts`
- Create: `apps/client/src/executors/file-service-stop.executor.ts`
- Create: `apps/client/src/executors/file-service-status.executor.ts`
- Modify: `apps/client/src/core/task-dispatcher.ts`

- [ ] **Step 1: Write failing dispatcher test**

Create or extend `apps/client/src/core/task-dispatcher.test.ts` with a test that dispatches `file_service_start` and expects a success result containing a port.

```ts
import { describe, expect, it, vi } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { dispatchTask } from './task-dispatcher.js';
import { stopFileHttpServer } from '../runtime/file-http-server.js';

function createConn() {
  const sent: unknown[] = [];
  return {
    sent,
    conn: { send: vi.fn((message: unknown) => { sent.push(message); return true; }) },
  };
}

describe('task dispatcher file service tasks', () => {
  it('starts, reports, and stops the file service', async () => {
    const workspaceDir = fs.mkdtempSync(path.join(os.tmpdir(), 'rag-dispatch-file-service-'));
    const { conn, sent } = createConn();
    const config = {
      clientId: 'client-1',
      clientName: 'Client 1',
      serverUrl: 'ws://localhost:3000/ws/client',
      apiBaseUrl: 'http://localhost:3000',
      token: 'agent-token',
      workspaceDir,
      tags: [],
    };

    await dispatchTask(conn as never, config, {
      taskId: 'task_file_start',
      taskType: 'file_service_start',
      payload: { port: 0, token: 'tok_1234567890123456' },
    });

    expect(sent).toContainEqual(expect.objectContaining({
      type: 'task.result',
      payload: expect.objectContaining({
        taskId: 'task_file_start',
        status: 'success',
        result: expect.objectContaining({ running: true, port: expect.any(Number) }),
      }),
    }));

    await dispatchTask(conn as never, config, {
      taskId: 'task_file_stop',
      taskType: 'file_service_stop',
      payload: {},
    });

    expect(sent).toContainEqual(expect.objectContaining({
      type: 'task.result',
      payload: expect.objectContaining({
        taskId: 'task_file_stop',
        status: 'success',
        result: { stopped: true },
      }),
    }));

    await stopFileHttpServer();
    fs.rmSync(workspaceDir, { recursive: true, force: true });
  });
});
```

- [ ] **Step 2: Run dispatcher test and verify failure**

Run:

```bash
pnpm --filter @rag/client test -- task-dispatcher.test.ts
```

Expected: FAIL because dispatcher does not know the new task types.

- [ ] **Step 3: Create executors**

Create `apps/client/src/executors/file-service-start.executor.ts`:

```ts
import type { ClientConfig } from '../config/client.config.js';
import type { FileServiceStartPayload } from '@rag/shared';
import { startFileHttpServer } from '../runtime/file-http-server.js';

export async function executeFileServiceStart(config: ClientConfig, payload: FileServiceStartPayload): Promise<unknown> {
  return startFileHttpServer({
    workspaceDir: config.workspaceDir,
    port: payload.port ?? 0,
    token: payload.token,
    ttlMs: payload.ttlMs,
  });
}
```

Create `apps/client/src/executors/file-service-stop.executor.ts`:

```ts
import { stopFileHttpServer } from '../runtime/file-http-server.js';

export async function executeFileServiceStop(): Promise<unknown> {
  await stopFileHttpServer();
  return { stopped: true };
}
```

Create `apps/client/src/executors/file-service-status.executor.ts`:

```ts
import { getFileHttpServerStatus } from '../runtime/file-http-server.js';

export async function executeFileServiceStatus(): Promise<unknown> {
  return getFileHttpServerStatus();
}
```

- [ ] **Step 4: Wire task dispatcher**

Modify `apps/client/src/core/task-dispatcher.ts` imports:

```ts
import type {
  ExecScriptPayload,
  ExecCommandPayload,
  PushFilePayload,
  FrpCreateProxyPayload,
  FrpRemoveProxyPayload,
  FileServiceStartPayload,
} from '@rag/shared';
import { executeFileServiceStart } from '../executors/file-service-start.executor.js';
import { executeFileServiceStop } from '../executors/file-service-stop.executor.js';
import { executeFileServiceStatus } from '../executors/file-service-status.executor.js';
```

Add cases in the switch:

```ts
      case 'file_service_start':
        result = await executeFileServiceStart(config, payload as FileServiceStartPayload);
        break;

      case 'file_service_stop':
        result = await executeFileServiceStop();
        break;

      case 'file_service_status':
        result = await executeFileServiceStatus();
        break;
```

- [ ] **Step 5: Run client tests**

Run:

```bash
pnpm --filter @rag/client test -- task-dispatcher.test.ts file-http-server.test.ts file-paths.test.ts
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/client/src/executors/file-service-start.executor.ts apps/client/src/executors/file-service-stop.executor.ts apps/client/src/executors/file-service-status.executor.ts apps/client/src/core/task-dispatcher.ts apps/client/src/core/task-dispatcher.test.ts
git commit -m "feat(client): dispatch file service control tasks"
```

---

## Task 5: Server File Session Manager

**Files:**
- Create: `apps/server/src/modules/client-files/client-file-sessions.service.ts`
- Create: `apps/server/src/modules/client-files/client-file-sessions.service.test.ts`

- [ ] **Step 1: Write failing session manager tests**

Create `apps/server/src/modules/client-files/client-file-sessions.service.test.ts`:

```ts
import { describe, expect, it, vi } from 'vitest';
import { ClientFileSessionsService } from './client-file-sessions.service.js';

describe('ClientFileSessionsService', () => {
  it('creates a start task and FRP mapping when no session exists', async () => {
    const tasksService = {
      createTask: vi.fn().mockReturnValue({ id: 'task_start_file', client_id: 'client-1' }),
      getTask: vi.fn().mockReturnValue({
        id: 'task_start_file',
        status: 'success',
        result: JSON.stringify({ running: true, host: '127.0.0.1', port: 45123, startedAt: 1000 }),
      }),
    };
    const connectionManager = { sendToClient: vi.fn().mockReturnValue(true) };
    const frpService = {
      createMapping: vi.fn().mockReturnValue({
        id: 'pm_file',
        client_id: 'client-1',
        name: 'file-service-client-1',
        proxy_type: 'tcp',
        local_ip: '127.0.0.1',
        local_port: 45123,
        remote_port: 23001,
        custom_domain: null,
        status: 'inactive',
        public_url: 'http://127.0.0.1:23001',
        created_at: 1000,
        updated_at: 1000,
      }),
      toApi: vi.fn((mapping) => ({ publicUrl: mapping.public_url, id: mapping.id })),
    };

    const service = new ClientFileSessionsService({ tasksService, connectionManager, frpService } as never);
    const session = await service.startSession('client-1');

    expect(tasksService.createTask).toHaveBeenCalledWith(expect.objectContaining({
      clientId: 'client-1',
      type: 'file_service_start',
      payload: expect.objectContaining({ token: expect.any(String) }),
    }));
    expect(connectionManager.sendToClient).toHaveBeenCalled();
    expect(frpService.createMapping).toHaveBeenCalledWith(expect.objectContaining({
      clientId: 'client-1',
      name: 'file-service-client-1',
      proxyType: 'tcp',
      localIp: '127.0.0.1',
      localPort: 45123,
    }));
    expect(session).toEqual(expect.objectContaining({
      clientId: 'client-1',
      localPort: 45123,
      mappingId: 'pm_file',
      publicUrl: 'http://127.0.0.1:23001',
    }));
  });
});
```

- [ ] **Step 2: Run test and verify failure**

Run:

```bash
pnpm --filter @rag/server test -- client-file-sessions.service.test.ts
```

Expected: FAIL because the service does not exist.

- [ ] **Step 3: Implement session manager**

Create `apps/server/src/modules/client-files/client-file-sessions.service.ts`:

```ts
import { randomBytes } from 'node:crypto';
import { tasksService as defaultTasksService } from '../tasks/tasks.service.js';
import { connectionManager as defaultConnectionManager } from '../connections/connections.manager.js';
import { frpService as defaultFrpService } from '../frp/frp.service.js';

export interface ClientFileSession {
  clientId: string;
  token: string;
  localPort: number;
  mappingId: string;
  publicUrl: string;
  startedAt: number;
  expiresAt: number;
}

interface Deps {
  tasksService: typeof defaultTasksService;
  connectionManager: typeof defaultConnectionManager;
  frpService: typeof defaultFrpService;
}

export class ClientFileSessionsService {
  private sessions = new Map<string, ClientFileSession>();
  private deps: Deps;

  constructor(deps?: Deps) {
    this.deps = deps ?? {
      tasksService: defaultTasksService,
      connectionManager: defaultConnectionManager,
      frpService: defaultFrpService,
    };
  }

  getSession(clientId: string): ClientFileSession | undefined {
    const session = this.sessions.get(clientId);
    if (!session) return undefined;
    if (session.expiresAt <= Date.now()) {
      this.sessions.delete(clientId);
      return undefined;
    }
    return session;
  }

  async startSession(clientId: string, ttlMs = 30 * 60 * 1000): Promise<ClientFileSession> {
    const existing = this.getSession(clientId);
    if (existing) return existing;

    const token = `file_${randomBytes(24).toString('hex')}`;
    const startTask = this.deps.tasksService.createTask({
      clientId,
      type: 'file_service_start',
      payload: { port: 0, token, ttlMs },
      createdBy: 'server:file-session',
    });

    const dispatched = this.deps.connectionManager.sendToClient(clientId, {
      type: 'task.dispatch',
      requestId: startTask.id,
      payload: {
        taskId: startTask.id,
        taskType: 'file_service_start',
        payload: { port: 0, token, ttlMs },
      },
    });

    if (!dispatched) throw new Error(`Client ${clientId} is offline`);

    const result = await this.waitForStartResult(startTask.id);
    const mapping = this.deps.frpService.createMapping({
      clientId,
      name: `file-service-${clientId}`,
      proxyType: 'tcp',
      localIp: '127.0.0.1',
      localPort: result.port,
    });

    const apiMapping = this.deps.frpService.toApi(mapping) as { id: string; publicUrl?: string };
    if (!apiMapping.publicUrl) throw new Error('FRP mapping did not provide publicUrl');

    const session: ClientFileSession = {
      clientId,
      token,
      localPort: result.port,
      mappingId: mapping.id,
      publicUrl: apiMapping.publicUrl,
      startedAt: result.startedAt,
      expiresAt: Date.now() + ttlMs,
    };
    this.sessions.set(clientId, session);
    return session;
  }

  stopSession(clientId: string): ClientFileSession | undefined {
    const session = this.sessions.get(clientId);
    this.sessions.delete(clientId);
    return session;
  }

  private async waitForStartResult(taskId: string): Promise<{ port: number; startedAt: number }> {
    const startedAt = Date.now();
    while (Date.now() - startedAt < 10_000) {
      const task = this.deps.tasksService.getTask(taskId);
      if (task?.status === 'success' && task.result) {
        const result = typeof task.result === 'string' ? JSON.parse(task.result) : task.result;
        if (typeof result.port === 'number' && typeof result.startedAt === 'number') {
          return { port: result.port, startedAt: result.startedAt };
        }
      }
      if (task?.status === 'failed') {
        throw new Error(task.error ?? 'File service start failed');
      }
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
    throw new Error(`Timed out waiting for file service start task ${taskId}`);
  }
}

export const clientFileSessionsService = new ClientFileSessionsService();
```

- [ ] **Step 4: Run service test**

Run:

```bash
pnpm --filter @rag/server test -- client-file-sessions.service.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/server/src/modules/client-files/client-file-sessions.service.ts apps/server/src/modules/client-files/client-file-sessions.service.test.ts
git commit -m "feat(server): add client file session manager"
```

---

## Task 6: Server Proxy Service and Routes

**Files:**
- Create: `apps/server/src/modules/client-files/client-file-proxy.service.ts`
- Create: `apps/server/src/modules/client-files/client-files.routes.ts`
- Modify: `apps/server/src/main.ts`
- Test: `apps/server/src/modules/client-files/client-files.routes.test.ts`

- [ ] **Step 1: Write failing proxy service route tests**

Create `apps/server/src/modules/client-files/client-files.routes.test.ts` with Fastify route tests that mock the session manager and proxy service. The test should verify `GET /api/clients/client-1/files?path=.` returns a list response and requires auth.

```ts
import { describe, expect, it, vi } from 'vitest';
import Fastify from 'fastify';
import { clientFilesRoutes } from './client-files.routes.js';

vi.mock('../auth/auth.middleware.js', () => ({
  authMiddleware: async (request: unknown) => {
    (request as { authRole?: string }).authRole = 'agent';
  },
}));

vi.mock('./client-file-sessions.service.js', () => ({
  clientFileSessionsService: {
    startSession: vi.fn().mockResolvedValue({
      clientId: 'client-1',
      token: 'file_token',
      publicUrl: 'http://127.0.0.1:23001',
      mappingId: 'pm_file',
      localPort: 45123,
      startedAt: 1000,
      expiresAt: Date.now() + 600000,
    }),
    getSession: vi.fn(),
    stopSession: vi.fn(),
  },
}));

vi.mock('./client-file-proxy.service.js', () => ({
  clientFileProxyService: {
    list: vi.fn().mockResolvedValue({ path: '.', entries: [{ name: 'a.txt', path: 'a.txt', type: 'file', size: 3, mtimeMs: 1000 }] }),
  },
}));

describe('client file routes', () => {
  it('lists client files through the proxy', async () => {
    const app = Fastify();
    await app.register(clientFilesRoutes);

    const response = await app.inject({ method: 'GET', url: '/api/clients/client-1/files?path=.' });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      path: '.',
      entries: [{ name: 'a.txt', path: 'a.txt', type: 'file', size: 3, mtimeMs: 1000 }],
    });
  });
});
```

- [ ] **Step 2: Run route test and verify failure**

Run:

```bash
pnpm --filter @rag/server test -- client-files.routes.test.ts
```

Expected: FAIL because routes and proxy service do not exist.

- [ ] **Step 3: Implement proxy service**

Create `apps/server/src/modules/client-files/client-file-proxy.service.ts`:

```ts
import type { ClientFileSession } from './client-file-sessions.service.js';

export class ClientFileProxyService {
  async list(session: ClientFileSession, clientPath: string): Promise<unknown> {
    return this.requestJson(session, `/v1/list?path=${encodeURIComponent(clientPath)}`);
  }

  async stat(session: ClientFileSession, clientPath: string): Promise<unknown> {
    return this.requestJson(session, `/v1/stat?path=${encodeURIComponent(clientPath)}`);
  }

  async read(session: ClientFileSession, clientPath: string): Promise<Response> {
    return this.requestRaw(session, `/v1/read?path=${encodeURIComponent(clientPath)}`);
  }

  async download(session: ClientFileSession, clientPath: string): Promise<Response> {
    return this.requestRaw(session, `/v1/download?path=${encodeURIComponent(clientPath)}`);
  }

  async write(session: ClientFileSession, clientPath: string, body: Buffer): Promise<unknown> {
    return this.requestJson(session, `/v1/write?path=${encodeURIComponent(clientPath)}`, { method: 'PUT', body });
  }

  async mkdir(session: ClientFileSession, payload: { path: string; recursive?: boolean }): Promise<unknown> {
    return this.requestJson(session, '/v1/mkdir', this.jsonInit(payload));
  }

  async delete(session: ClientFileSession, clientPath: string, recursive: boolean): Promise<unknown> {
    return this.requestJson(session, `/v1/delete?path=${encodeURIComponent(clientPath)}&recursive=${recursive ? 'true' : 'false'}`, { method: 'DELETE' });
  }

  async move(session: ClientFileSession, payload: { from: string; to: string; overwrite?: boolean }): Promise<unknown> {
    return this.requestJson(session, '/v1/move', this.jsonInit(payload));
  }

  async copy(session: ClientFileSession, payload: { from: string; to: string; overwrite?: boolean }): Promise<unknown> {
    return this.requestJson(session, '/v1/copy', this.jsonInit(payload));
  }

  private jsonInit(payload: unknown): RequestInit {
    return {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    };
  }

  private async requestJson(session: ClientFileSession, path: string, init?: RequestInit): Promise<unknown> {
    const response = await this.requestRaw(session, path, init);
    const text = await response.text();
    const body = text ? JSON.parse(text) : null;
    if (!response.ok) {
      const message = body && typeof body === 'object' && 'error' in body ? String((body as { error: unknown }).error) : response.statusText;
      throw new Error(`Client file service error ${response.status}: ${message}`);
    }
    return body;
  }

  private async requestRaw(session: ClientFileSession, path: string, init?: RequestInit): Promise<Response> {
    return fetch(`${session.publicUrl}${path}`, {
      ...init,
      headers: {
        Authorization: `Bearer ${session.token}`,
        ...(init?.headers ?? {}),
      },
    });
  }
}

export const clientFileProxyService = new ClientFileProxyService();
```

- [ ] **Step 4: Implement routes**

Create `apps/server/src/modules/client-files/client-files.routes.ts`:

```ts
import type { FastifyInstance } from 'fastify';
import { authMiddleware } from '../auth/auth.middleware.js';
import { clientFileSessionsService } from './client-file-sessions.service.js';
import { clientFileProxyService } from './client-file-proxy.service.js';
import {
  ClientFileCopyPayloadSchema,
  ClientFileDeletePayloadSchema,
  ClientFileMkdirPayloadSchema,
  ClientFileMovePayloadSchema,
  ClientFilePathPayloadSchema,
  ClientFileWriteQuerySchema,
} from '@rag/shared';

async function getSession(clientId: string) {
  return clientFileSessionsService.startSession(clientId);
}

export async function clientFilesRoutes(app: FastifyInstance): Promise<void> {
  app.addHook('preHandler', authMiddleware);

  app.post<{ Params: { clientId: string } }>('/api/clients/:clientId/file-session/start', async (request) => {
    return clientFileSessionsService.startSession(request.params.clientId);
  });

  app.get<{ Params: { clientId: string } }>('/api/clients/:clientId/file-session', async (request, reply) => {
    const session = clientFileSessionsService.getSession(request.params.clientId);
    if (!session) return reply.code(404).send({ error: 'File session not found' });
    return reply.send({ ...session, token: undefined });
  });

  app.post<{ Params: { clientId: string } }>('/api/clients/:clientId/file-session/stop', async (request) => {
    const session = clientFileSessionsService.stopSession(request.params.clientId);
    return { stopped: Boolean(session) };
  });

  app.get<{ Params: { clientId: string }; Querystring: { path?: string } }>('/api/clients/:clientId/files', async (request) => {
    const payload = ClientFilePathPayloadSchema.parse({ path: request.query.path ?? '.' });
    return clientFileProxyService.list(await getSession(request.params.clientId), payload.path);
  });

  app.get<{ Params: { clientId: string }; Querystring: { path?: string } }>('/api/clients/:clientId/files/stat', async (request) => {
    const payload = ClientFilePathPayloadSchema.parse({ path: request.query.path ?? '.' });
    return clientFileProxyService.stat(await getSession(request.params.clientId), payload.path);
  });

  app.get<{ Params: { clientId: string }; Querystring: { path: string } }>('/api/clients/:clientId/files/read', async (request, reply) => {
    const payload = ClientFilePathPayloadSchema.parse({ path: request.query.path });
    const response = await clientFileProxyService.read(await getSession(request.params.clientId), payload.path);
    reply.code(response.status);
    reply.header('Content-Type', response.headers.get('Content-Type') ?? 'application/octet-stream');
    return reply.send(Buffer.from(await response.arrayBuffer()));
  });

  app.get<{ Params: { clientId: string }; Querystring: { path: string } }>('/api/clients/:clientId/files/download', async (request, reply) => {
    const payload = ClientFilePathPayloadSchema.parse({ path: request.query.path });
    const response = await clientFileProxyService.download(await getSession(request.params.clientId), payload.path);
    reply.code(response.status);
    reply.header('Content-Type', response.headers.get('Content-Type') ?? 'application/octet-stream');
    const disposition = response.headers.get('Content-Disposition');
    if (disposition) reply.header('Content-Disposition', disposition);
    return reply.send(Buffer.from(await response.arrayBuffer()));
  });

  app.put<{ Params: { clientId: string }; Querystring: { path: string } }>('/api/clients/:clientId/files/write', async (request) => {
    const payload = ClientFileWriteQuerySchema.parse({ path: request.query.path });
    const buffer = Buffer.from(await request.body as ArrayBuffer);
    return clientFileProxyService.write(await getSession(request.params.clientId), payload.path, buffer);
  });

  app.post<{ Params: { clientId: string } }>('/api/clients/:clientId/files/mkdir', async (request) => {
    const payload = ClientFileMkdirPayloadSchema.parse(request.body);
    return clientFileProxyService.mkdir(await getSession(request.params.clientId), payload);
  });

  app.delete<{ Params: { clientId: string }; Querystring: { path: string; recursive?: string } }>('/api/clients/:clientId/files', async (request) => {
    const payload = ClientFileDeletePayloadSchema.parse({
      path: request.query.path,
      recursive: request.query.recursive === 'true',
    });
    return clientFileProxyService.delete(await getSession(request.params.clientId), payload.path, payload.recursive);
  });

  app.post<{ Params: { clientId: string } }>('/api/clients/:clientId/files/move', async (request) => {
    const payload = ClientFileMovePayloadSchema.parse(request.body);
    return clientFileProxyService.move(await getSession(request.params.clientId), payload);
  });

  app.post<{ Params: { clientId: string } }>('/api/clients/:clientId/files/copy', async (request) => {
    const payload = ClientFileCopyPayloadSchema.parse(request.body);
    return clientFileProxyService.copy(await getSession(request.params.clientId), payload);
  });
}
```

- [ ] **Step 5: Register routes in server main**

Modify `apps/server/src/main.ts`:

```ts
import { clientFilesRoutes } from './modules/client-files/client-files.routes.js';
```

Register after `fileRoutes`:

```ts
await app.register(clientFilesRoutes);
```

- [ ] **Step 6: Run server tests**

Run:

```bash
pnpm --filter @rag/server test -- client-files.routes.test.ts client-file-sessions.service.test.ts
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add apps/server/src/modules/client-files apps/server/src/main.ts
git commit -m "feat(server): proxy client file operations over frp http"
```

---

## Task 7: E2E Tests for FRP HTTP File Plane

**Files:**
- Modify: `scripts/e2e-test.ts`

- [ ] **Step 1: Add failing E2E tests**

Append a section after existing file push tests in `scripts/e2e-test.ts`:

```ts
  // 12. Client file management via FRP HTTP data plane
  await test('Client file session starts', async () => {
    const { status, body } = await apiJson('POST', `${BASE_URL}/api/clients/${CLIENT_ID}/file-session/start`);
    const session = body as Record<string, unknown>;
    return status === 200 && session.clientId === CLIENT_ID && typeof session.publicUrl === 'string';
  });

  await test('Client file mkdir + write + list + read', async () => {
    const mkdir = await apiJson('POST', `${BASE_URL}/api/clients/${CLIENT_ID}/files/mkdir`, {
      path: 'managed',
      recursive: true,
    });
    if (mkdir.status !== 200) return false;

    const write = await api('PUT', `${BASE_URL}/api/clients/${CLIENT_ID}/files/write?path=managed/frp-http.txt`, {
      body: 'FRP_HTTP_FILE_OK',
      headers: { 'Content-Type': 'text/plain' },
    });
    if (write.status !== 200) return false;

    const list = await api('GET', `${BASE_URL}/api/clients/${CLIENT_ID}/files?path=managed`);
    const entries = ((list.body as Record<string, unknown>).entries ?? []) as { name: string }[];
    if (!entries.some((entry) => entry.name === 'frp-http.txt')) return false;

    const read = await api('GET', `${BASE_URL}/api/clients/${CLIENT_ID}/files/read?path=managed/frp-http.txt`);
    return read.status === 200 && String(read.body).includes('FRP_HTTP_FILE_OK');
  });

  await test('Client file move + copy + delete', async () => {
    const move = await apiJson('POST', `${BASE_URL}/api/clients/${CLIENT_ID}/files/move`, {
      from: 'managed/frp-http.txt',
      to: 'managed/frp-http-moved.txt',
      overwrite: false,
    });
    if (move.status !== 200) return false;

    const copy = await apiJson('POST', `${BASE_URL}/api/clients/${CLIENT_ID}/files/copy`, {
      from: 'managed/frp-http-moved.txt',
      to: 'managed/frp-http-copy.txt',
      overwrite: false,
    });
    if (copy.status !== 200) return false;

    const del = await api('DELETE', `${BASE_URL}/api/clients/${CLIENT_ID}/files?path=managed/frp-http-moved.txt`);
    if (del.status !== 200) return false;

    const statDeleted = await api('GET', `${BASE_URL}/api/clients/${CLIENT_ID}/files/stat?path=managed/frp-http-moved.txt`);
    const statCopy = await api('GET', `${BASE_URL}/api/clients/${CLIENT_ID}/files/stat?path=managed/frp-http-copy.txt`);
    return statDeleted.status >= 400 && statCopy.status === 200;
  });
```

- [ ] **Step 2: Run E2E and verify failure if FRP is not available**

Run:

```bash
pnpm test:e2e
```

Expected before full integration: FAIL on the new file-session endpoints if previous tasks are not complete, or FAIL on FRP reachability if frps/frpc is not available in the test environment.

- [ ] **Step 3: Adjust E2E environment for FRP**

If E2E uses `FRP_MODE=remote` with empty `FRPS_HOST`, use one of these controlled paths:

- For CI/local without real FRP, mock the public URL by allowing `FRP_MODE=none` and route directly to localhost file service in test mode.
- For real integration, require `FRP_MODE=builtin` and ensure `bin/frps` and `bin/frpc` exist before running the file-plane tests.

Implement the controlled test path as environment-gated logic in `scripts/e2e-test.ts`:

```ts
const RUN_FRP_FILE_TESTS = process.env.RAG_E2E_FRP_FILE_TESTS === '1';
```

Wrap the three new tests:

```ts
if (RUN_FRP_FILE_TESTS) {
  // run FRP HTTP file-plane tests
} else {
  console.log('Skipping FRP HTTP file-plane tests. Set RAG_E2E_FRP_FILE_TESTS=1 to enable.');
}
```

- [ ] **Step 4: Run non-FRP E2E**

Run:

```bash
pnpm test:e2e
```

Expected: Existing E2E behavior remains stable. File-plane tests are skipped unless explicitly enabled.

- [ ] **Step 5: Run FRP-enabled E2E**

Run when FRP binaries and frps are available:

```bash
RAG_E2E_FRP_FILE_TESTS=1 pnpm test:e2e
```

Expected: New client file management tests PASS.

- [ ] **Step 6: Commit**

```bash
git add scripts/e2e-test.ts
git commit -m "test(e2e): cover frp http client file management"
```

---

## Task 8: Documentation and Web Console Entry Points

**Files:**
- Modify: `README.md`
- Modify: `docs/TESTING.md`
- Modify: `apps/server/src/web/index.html`

- [ ] **Step 1: Update README API docs**

Add to the API section in `README.md`:

```markdown
### 客户端文件管理

这些接口通过 WebSocket 启动客户端本地文件 HTTP 服务，并通过 FRP 暴露的数据面传输文件内容。所有路径都限制在客户端 `workspaceDir` 下。

| 方法 | 路径 | 说明 |
|------|------|------|
| `POST` | `/api/clients/:clientId/file-session/start` | 启动客户端文件服务并创建 FRP 映射 |
| `GET` | `/api/clients/:clientId/file-session` | 查看文件服务会话 |
| `POST` | `/api/clients/:clientId/file-session/stop` | 停止文件服务会话 |
| `GET` | `/api/clients/:clientId/files?path=.` | 列出目录 |
| `GET` | `/api/clients/:clientId/files/stat?path=...` | 查看文件信息 |
| `GET` | `/api/clients/:clientId/files/read?path=...` | 读取文件内容 |
| `GET` | `/api/clients/:clientId/files/download?path=...` | 下载文件 |
| `PUT` | `/api/clients/:clientId/files/write?path=...` | 写入文件 |
| `POST` | `/api/clients/:clientId/files/mkdir` | 创建目录 |
| `DELETE` | `/api/clients/:clientId/files?path=...` | 删除文件或目录 |
| `POST` | `/api/clients/:clientId/files/move` | 移动或重命名 |
| `POST` | `/api/clients/:clientId/files/copy` | 复制文件或目录 |
```

- [ ] **Step 2: Update testing docs**

Add to `docs/TESTING.md`:

```markdown
## FRP HTTP 客户端文件管理测试

默认 E2E 不强制运行 FRP 文件数据面测试，因为它依赖可用的 frps/frpc。启用方式：

```bash
RAG_E2E_FRP_FILE_TESTS=1 pnpm test:e2e
```

覆盖能力：

- 启动客户端文件服务
- 创建 FRP 映射
- 创建目录
- 写入文件
- 列目录
- 读取文件
- 移动文件
- 复制文件
- 删除文件
```

- [ ] **Step 3: Add minimal Web Console controls**

Modify `apps/server/src/web/index.html` to add client file management entry points without building a full file explorer:

- Add a button next to each online client: `📂 文件`
- Button opens a prompt for path, defaults to `.`
- Calls `GET /api/clients/:clientId/files?path=<path>`
- Displays result in a simple table with name, type, size, and mtime
- Adds basic buttons for `mkdir`, `write`, and `delete` using prompts

Use existing `api()` helper and style conventions already present in the file.

- [ ] **Step 4: Run build**

Run:

```bash
pnpm build:dist
```

Expected: PASS and web console copied to `dist/web`.

- [ ] **Step 5: Commit**

```bash
git add README.md docs/TESTING.md apps/server/src/web/index.html
git commit -m "docs: document frp http client file management"
```

---

## Verification Checklist

Run these commands before claiming completion:

```bash
pnpm --filter @rag/shared test
pnpm --filter @rag/client test
pnpm --filter @rag/server test
pnpm typecheck
pnpm build:dist
pnpm test:e2e
```

When FRP is available:

```bash
RAG_E2E_FRP_FILE_TESTS=1 pnpm test:e2e
```

Expected final state:

- Shared schemas accept new file-service tasks.
- Client local HTTP file server passes unit tests.
- Server route tests pass with mocked proxy/session services.
- Existing command/script/file-push E2E remains passing.
- FRP-enabled E2E proves HTTP file data plane works.

---

## Self-Review

**Spec coverage:** The plan covers control-plane tasks, client local HTTP file service, FRP session creation, server proxy APIs, file operations, auth, workspace confinement, tests, and docs.

**Placeholder scan:** The plan avoids open-ended implementation placeholders. Each code task includes concrete paths, test snippets, implementation snippets, commands, and expected results.

**Type consistency:** Task names are consistent across shared types, schemas, dispatcher cases, server tasks, and API naming: `file_service_start`, `file_service_stop`, `file_service_status`.

**Risk notes:**

- `ClientFileSessionsService.waitForStartResult()` polls SQLite task status. This matches the current service style but should be revisited later if high concurrency requires event-based task completion.
- `PUT /files/write` reads request body into memory in the initial implementation. Large-file streaming should be added after this baseline works.
- FRP-enabled E2E depends on actual FRP availability and is gated by `RAG_E2E_FRP_FILE_TESTS=1`.
