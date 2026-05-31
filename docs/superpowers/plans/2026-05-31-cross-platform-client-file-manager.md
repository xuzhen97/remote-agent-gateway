# Cross-Platform Client File Manager Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a cross-platform client file manager that browses configured root directories instead of only `workspaceDir`, while still enforcing per-process filesystem permissions and using WebSocket as control plane plus FRP HTTP as file data plane.

**Architecture:** The client advertises and enforces `allowedRoots`, exposing root-aware file APIs on the local HTTP file service. The server keeps session/FRP orchestration but proxies `rootId + path` operations to the client. The web console becomes a real two-pane client file manager with root selection and modal-based file operations instead of browser-native prompts.

**Tech Stack:** Node.js 22, TypeScript, Fastify, WebSocket `ws`, SQLite via `sql.js`, built-in `node:http`, built-in `node:fs`, built-in `fetch`, Vitest, existing E2E harness.

---

## File Structure

### Shared package

- Modify: `packages/shared/src/types.ts`
  - Add root metadata types and root-aware request payloads.
- Modify: `packages/shared/src/schemas.ts`
  - Add Zod schemas for `rootId + path` payloads.
- Modify: `packages/shared/src/__tests__/schemas.test.ts`
  - Add schema tests for new root-aware payloads.

### Client

- Modify: `apps/client/config.example.json`
  - Add `allowedRoots` examples.
- Modify: `apps/client/src/config/client.config.ts`
  - Parse `allowedRoots`, normalize `frpcPath`, and resolve configured roots.
- Create: `apps/client/src/runtime/file-roots.ts`
  - Resolve root definitions, root IDs, and safe absolute paths.
- Create: `apps/client/src/runtime/file-roots.test.ts`
  - Unit tests for Windows/Linux-style root handling and traversal rejection.
- Modify: `apps/client/src/runtime/file-http-server.ts`
  - Add `/v1/roots` and convert file APIs to accept `rootId + path`.
- Modify: `apps/client/src/runtime/file-http-server.test.ts`
  - Add root-aware tests, including permission and not-found behavior.

### Server

- Modify: `apps/server/src/modules/client-files/client-file-proxy.service.ts`
  - Add `roots()` and root-aware list/read/write/upload/mkdir/delete/move/copy helpers.
- Modify: `apps/server/src/modules/client-files/client-files.routes.ts`
  - Add `/files/roots` and convert existing routes to `rootId + path`.
- Modify: `apps/server/src/modules/client-files/client-files.routes.test.ts`
  - Add route tests for `/files/roots` and root-aware upload/list requests.
- Modify: `apps/server/src/modules/client-files/client-file-sessions.service.ts`
  - Keep existing stale-mapping cleanup and confirm it still applies with root-aware browsing.

### Frontend / Docs / E2E

- Modify: `apps/server/src/web/index.html`
  - Add root list sidebar and modal-based file actions for client file manager.
- Modify: `scripts/e2e-test.ts`
  - Add root-aware FRP file manager E2E coverage.
- Modify: `README.md`
  - Document `allowedRoots`, `/files/roots`, and `rootId + path` semantics.
- Modify: `docs/TESTING.md`
  - Document how to run the new root-aware FRP file manager tests.

---

## Task 1: Shared Root-Aware Types and Schemas

**Files:**
- Modify: `packages/shared/src/types.ts`
- Modify: `packages/shared/src/schemas.ts`
- Modify: `packages/shared/src/__tests__/schemas.test.ts`

- [ ] **Step 1: Add failing schema tests**

Append to `packages/shared/src/__tests__/schemas.test.ts`:

```ts
import {
  ClientFileRootPayloadSchema,
  ClientFileRootPathPayloadSchema,
  ClientFileRootMkdirPayloadSchema,
  ClientFileRootMovePayloadSchema,
  ClientFileRootCopyPayloadSchema,
} from '../schemas.js';

describe('client file root-aware schemas', () => {
  it('accepts root metadata and root-aware payloads', () => {
    expect(ClientFileRootPayloadSchema.parse({ rootId: 'root-0' })).toEqual({ rootId: 'root-0' });
    expect(ClientFileRootPathPayloadSchema.parse({ rootId: 'root-1', path: 'Windows/System32' })).toEqual({
      rootId: 'root-1',
      path: 'Windows/System32',
    });
    expect(ClientFileRootMkdirPayloadSchema.parse({ rootId: 'root-2', path: 'reports/2026', recursive: true })).toEqual({
      rootId: 'root-2',
      path: 'reports/2026',
      recursive: true,
    });
    expect(ClientFileRootMovePayloadSchema.parse({ rootId: 'root-2', from: 'a.txt', to: 'archive/a.txt', overwrite: false })).toEqual({
      rootId: 'root-2',
      from: 'a.txt',
      to: 'archive/a.txt',
      overwrite: false,
    });
    expect(ClientFileRootCopyPayloadSchema.parse({ rootId: 'root-2', from: 'a.txt', to: 'copy/a.txt', overwrite: true })).toEqual({
      rootId: 'root-2',
      from: 'a.txt',
      to: 'copy/a.txt',
      overwrite: true,
    });
  });

  it('rejects empty root ids and traversal paths', () => {
    expect(() => ClientFileRootPayloadSchema.parse({ rootId: '' })).toThrow();
    expect(() => ClientFileRootPathPayloadSchema.parse({ rootId: 'root-0', path: '../secret.txt' })).toThrow();
  });
});
```

- [ ] **Step 2: Run schema tests and verify failure**

Run:

```bash
pnpm --filter @rag/shared test -- schemas.test.ts
```

Expected: FAIL because the new root-aware schemas do not exist yet.

- [ ] **Step 3: Add shared root-aware types**

Add to `packages/shared/src/types.ts` near the existing client file types:

```ts
export interface ClientFileRoot {
  id: string;
  label: string;
  path: string;
}

export interface ClientFileRootPayload {
  rootId: string;
}

export interface ClientFileRootPathPayload {
  rootId: string;
  path: string;
}

export interface ClientFileRootMkdirPayload extends ClientFileRootPathPayload {
  recursive?: boolean;
}

export interface ClientFileRootDeletePayload extends ClientFileRootPathPayload {
  recursive?: boolean;
}

export interface ClientFileRootMovePayload {
  rootId: string;
  from: string;
  to: string;
  overwrite?: boolean;
}

export interface ClientFileRootCopyPayload {
  rootId: string;
  from: string;
  to: string;
  overwrite?: boolean;
}
```

- [ ] **Step 4: Add shared schemas**

Add to `packages/shared/src/schemas.ts`:

```ts
const ClientFileRootIdSchema = z.string().min(1).max(128);

export const ClientFileRootPayloadSchema = z.object({
  rootId: ClientFileRootIdSchema,
});

export const ClientFileRootPathPayloadSchema = z.object({
  rootId: ClientFileRootIdSchema,
  path: RelativeClientPathSchema,
});

export const ClientFileRootMkdirPayloadSchema = z.object({
  rootId: ClientFileRootIdSchema,
  path: RelativeClientPathSchema,
  recursive: z.boolean().optional().default(true),
});

export const ClientFileRootDeletePayloadSchema = z.object({
  rootId: ClientFileRootIdSchema,
  path: RelativeClientPathSchema,
  recursive: z.boolean().optional().default(false),
});

export const ClientFileRootMovePayloadSchema = z.object({
  rootId: ClientFileRootIdSchema,
  from: RelativeClientPathSchema,
  to: RelativeClientPathSchema,
  overwrite: z.boolean().optional().default(false),
});

export const ClientFileRootCopyPayloadSchema = z.object({
  rootId: ClientFileRootIdSchema,
  from: RelativeClientPathSchema,
  to: RelativeClientPathSchema,
  overwrite: z.boolean().optional().default(false),
});
```

- [ ] **Step 5: Run tests and verify pass**

Run:

```bash
pnpm --filter @rag/shared test -- schemas.test.ts
pnpm --filter @rag/shared typecheck
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/shared/src/types.ts packages/shared/src/schemas.ts packages/shared/src/__tests__/schemas.test.ts
git commit -m "feat(shared): add root-aware client file schemas"
```

---

## Task 2: Client Allowed Roots Configuration and Resolution

**Files:**
- Modify: `apps/client/config.example.json`
- Modify: `apps/client/src/config/client.config.ts`
- Create: `apps/client/src/config/client.config.test.ts`
- Create: `apps/client/src/runtime/file-roots.ts`
- Create: `apps/client/src/runtime/file-roots.test.ts`

- [ ] **Step 1: Write failing config/root tests**

Create `apps/client/src/runtime/file-roots.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { resolveAllowedRoots, resolveRootPath } from './file-roots.js';

describe('file roots', () => {
  it('builds stable root metadata from configured roots', () => {
    const roots = resolveAllowedRoots('/tmp/client', ['/', './workspace']);
    expect(roots.map((root) => root.id)).toEqual(['root-0', 'root-1']);
    expect(roots[1]?.label).toBe('workspace');
  });

  it('rejects path traversal outside a root', () => {
    const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'rag-root-'));
    const roots = resolveAllowedRoots(workspace, ['./workspace']);
    expect(() => resolveRootPath(roots, 'root-0', '../secret.txt')).toThrow('Path outside allowed root');
  });
});
```

- [ ] **Step 2: Run client tests and verify failure**

Run:

```bash
pnpm --filter @rag/client test -- file-roots.test.ts client.config.test.ts
```

Expected: FAIL because `file-roots.ts` does not exist.

- [ ] **Step 3: Update config example**

Modify `apps/client/config.example.json` to add an `allowedRoots` example:

```json
"allowedRoots": [
  "./workspace"
]
```

- [ ] **Step 4: Implement root resolution helpers**

Create `apps/client/src/runtime/file-roots.ts`:

```ts
import * as path from 'node:path';
import type { ClientFileRoot } from '@rag/shared';

export function resolveAllowedRoots(baseDir: string, configuredRoots?: string[]): ClientFileRoot[] {
  const roots = (configuredRoots && configuredRoots.length > 0) ? configuredRoots : ['./workspace'];
  return roots.map((rootPath, index) => {
    const absolute = path.isAbsolute(rootPath) ? rootPath : path.resolve(baseDir, rootPath);
    return {
      id: `root-${index}`,
      label: rootPath === './workspace' ? 'workspace' : rootPath,
      path: path.resolve(absolute),
    };
  });
}

export function resolveRootPath(roots: ClientFileRoot[], rootId: string, clientPath: string): string {
  const root = roots.find((entry) => entry.id === rootId);
  if (!root) throw new Error(`Unknown rootId: ${rootId}`);

  const relative = clientPath === '.' ? '' : clientPath.replace(/\\/g, '/');
  if (relative.split('/').some((part) => part === '..')) {
    throw new Error('Path outside allowed root');
  }

  const resolved = relative ? path.resolve(root.path, relative) : path.resolve(root.path);
  const normalizedRoot = path.resolve(root.path);
  if (resolved !== normalizedRoot && !resolved.startsWith(normalizedRoot + path.sep)) {
    throw new Error('Path outside allowed root');
  }
  return resolved;
}
```

- [ ] **Step 5: Extend client config loader**

Modify `apps/client/src/config/client.config.ts` so the schema includes:

```ts
allowedRoots: z.array(z.string()).optional().default([]),
```

and the returned config includes the existing `frpcPath` auto-resolution plus the parsed `allowedRoots`.

- [ ] **Step 6: Run tests and typecheck**

Run:

```bash
pnpm --filter @rag/client test -- client.config.test.ts file-roots.test.ts
pnpm --filter @rag/client typecheck
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add apps/client/config.example.json apps/client/src/config/client.config.ts apps/client/src/config/client.config.test.ts apps/client/src/runtime/file-roots.ts apps/client/src/runtime/file-roots.test.ts
git commit -m "feat(client): add allowed root resolution"
```

---

## Task 3: Client Local HTTP File Server Becomes Root-Aware

**Files:**
- Modify: `apps/client/src/runtime/file-http-server.ts`
- Modify: `apps/client/src/runtime/file-http-server.test.ts`
- Modify: `apps/client/src/runtime/file-paths.ts` only if shared helpers are needed

- [ ] **Step 1: Write failing root-aware HTTP server tests**

Extend `apps/client/src/runtime/file-http-server.test.ts` with:

```ts
it('lists configured roots and performs file operations inside the selected root', async () => {
  const rootsResponse = await request('/v1/roots');
  expect(rootsResponse.status).toBe(200);
  const rootsBody = await rootsResponse.json() as { roots: { id: string; label: string }[] };
  const rootId = rootsBody.roots[0]?.id;
  expect(rootId).toBeTruthy();

  expect((await request('/v1/mkdir', {
    method: 'POST',
    body: JSON.stringify({ rootId, path: 'nested', recursive: true }),
    headers: { 'Content-Type': 'application/json' },
  })).status).toBe(200);

  expect((await request(`/v1/write?rootId=${rootId}&path=nested/a.txt`, {
    method: 'PUT',
    body: 'hello roots',
  })).status).toBe(200);

  const listResponse = await request(`/v1/list?rootId=${rootId}&path=nested`);
  expect(listResponse.status).toBe(200);
  const listBody = await listResponse.json() as { entries: { name: string }[] };
  expect(listBody.entries.some((entry) => entry.name === 'a.txt')).toBe(true);
});
```

- [ ] **Step 2: Run tests and verify failure**

Run:

```bash
pnpm --filter @rag/client test -- file-http-server.test.ts
```

Expected: FAIL because `/v1/roots` and `rootId` are unsupported.

- [ ] **Step 3: Pass roots into the HTTP server state**

Update `startFileHttpServer()` inputs and state so the server stores resolved roots from `allowedRoots`.

- [ ] **Step 4: Add `/v1/roots` and root-aware request parsing**

Update `apps/client/src/runtime/file-http-server.ts` so it:

- Returns `{ roots }` on `GET /v1/roots`
- Requires `rootId` on all file operations except health
- Uses `resolveRootPath()` instead of only `workspaceDir`
- Returns:
  - `400` for bad root/path
  - `403` for permission errors
  - `404` for missing files

- [ ] **Step 5: Run tests and verify pass**

Run:

```bash
pnpm --filter @rag/client test -- file-http-server.test.ts file-roots.test.ts
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/client/src/runtime/file-http-server.ts apps/client/src/runtime/file-http-server.test.ts
git commit -m "feat(client): make file http server root-aware"
```

---

## Task 4: Server Root-Aware Proxy and Routes

**Files:**
- Modify: `apps/server/src/modules/client-files/client-file-proxy.service.ts`
- Modify: `apps/server/src/modules/client-files/client-files.routes.ts`
- Modify: `apps/server/src/modules/client-files/client-files.routes.test.ts`

- [ ] **Step 1: Write failing route tests for roots**

Extend `apps/server/src/modules/client-files/client-files.routes.test.ts` with:

```ts
it('returns client roots through the proxy', async () => {
  const app = Fastify();
  await app.register(clientFilesRoutes);

  const response = await app.inject({ method: 'GET', url: '/api/clients/client-1/files/roots' });
  expect(response.statusCode).toBe(200);
});
```

Mock the proxy service with:

```ts
roots: vi.fn().mockResolvedValue({
  roots: [{ id: 'root-0', label: 'workspace', path: '/tmp/workspace' }],
}),
```

- [ ] **Step 2: Run tests and verify failure**

Run:

```bash
pnpm --filter @rag/server test -- client-files.routes.test.ts
```

Expected: FAIL because `/files/roots` does not exist.

- [ ] **Step 3: Extend proxy service**

Modify `apps/server/src/modules/client-files/client-file-proxy.service.ts` to add:

```ts
async roots(session: ClientFileSession): Promise<unknown> {
  return this.requestJson(session, '/v1/roots');
}
```

and update every other method to accept `rootId` and include it in query/body.

- [ ] **Step 4: Extend routes**

Modify `apps/server/src/modules/client-files/client-files.routes.ts` to:

- Add `GET /api/clients/:clientId/files/roots`
- Require `rootId` for list/stat/read/download/write/upload/delete/mkdir/move/copy
- Parse root-aware payloads with the new shared schemas

- [ ] **Step 5: Run server tests and typecheck**

Run:

```bash
pnpm --filter @rag/server test -- client-files.routes.test.ts
pnpm --filter @rag/server typecheck
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/server/src/modules/client-files/client-file-proxy.service.ts apps/server/src/modules/client-files/client-files.routes.ts apps/server/src/modules/client-files/client-files.routes.test.ts
git commit -m "feat(server): add root-aware client file routes"
```

---

## Task 5: Frontend Root Sidebar and Modal-Based File Actions

**Files:**
- Modify: `apps/server/src/web/index.html`

- [ ] **Step 1: Write the failing browser-oriented expectation as a static checklist comment**

Add a comment block near the client file manager functions documenting the expected UI states for:

- root sidebar visible
- modal opens on new directory
- modal opens on write file
- modal opens on delete

This is not a runtime assertion, but it anchors the implementation requirement directly in the file being modified.

- [ ] **Step 2: Replace rootless client view with root sidebar**

Update the client files renderer so it:

- Loads `/api/clients/:clientId/files/roots`
- Displays roots in a left sidebar
- Stores `window._clientFileRootId`
- Passes `rootId` to all subsequent file operations

- [ ] **Step 3: Replace native dialogs in client file manager**

Ensure these operations are page-modal based, not browser-native:

- open path
- new directory
- write file
- delete file/directory

Use the existing `openModal()` helper introduced in the current codebase rather than adding another modal system.

- [ ] **Step 4: Keep client list entry point aligned**

Update the `📂 文件` button in the clients table so it sets:

```js
window._clientFileClientId = clientId;
window._clientFileRootId = '';
window._clientFilePath = '.';
showSection('files');
loadFiles('client');
```

- [ ] **Step 5: Run build and smoke-check copied web assets**

Run:

```bash
pnpm build:dist
rg -n "目标客户端|服务端文件仓库|客户端文件|新建目录|新建/写入文件" dist/web/index.html
```

Expected: Build PASS and strings present in `dist/web/index.html`.

- [ ] **Step 6: Commit**

```bash
git add apps/server/src/web/index.html
git commit -m "feat(web): add root-aware client file manager ui"
```

---

## Task 6: Root-Aware FRP E2E Coverage

**Files:**
- Modify: `scripts/e2e-test.ts`

- [ ] **Step 1: Add failing FRP root-aware E2E checks**

Inside the `RAG_E2E_FRP_FILE_TESTS` block, add:

```ts
await test('Client file roots are listed', async () => {
  const roots = await api('GET', `${BASE_URL}/api/clients/${CLIENT_ID}/files/roots`);
  const body = roots.body as { roots?: { id: string }[] };
  return roots.status === 200 && Array.isArray(body.roots) && body.roots.length >= 1;
});
```

Then update the existing file manager tests to send `rootId` along with `path`.

- [ ] **Step 2: Run E2E and verify failure before implementation is complete**

Run:

```bash
RAG_E2E_FRP_FILE_TESTS=1 pnpm test:e2e
```

Expected: FAIL on missing `/files/roots` or missing `rootId` handling.

- [ ] **Step 3: Make E2E use the first root from `/files/roots`**

Update the script to fetch roots once and reuse:

```ts
const rootsResponse = await api('GET', `${BASE_URL}/api/clients/${CLIENT_ID}/files/roots`);
const rootId = ((rootsResponse.body as { roots?: { id: string }[] }).roots ?? [])[0]?.id;
if (!rootId) return false;
```

- [ ] **Step 4: Run both E2E modes**

Run:

```bash
pnpm test:e2e
RAG_E2E_FRP_FILE_TESTS=1 pnpm test:e2e
```

Expected: PASS in both modes.

- [ ] **Step 5: Commit**

```bash
git add scripts/e2e-test.ts
git commit -m "test(e2e): cover root-aware client file manager"
```

---

## Task 7: Documentation Updates

**Files:**
- Modify: `README.md`
- Modify: `docs/TESTING.md`
- Modify: `apps/client/config.example.json` if examples need final polish

- [ ] **Step 1: Update README API docs**

Document:

- `allowedRoots`
- `GET /api/clients/:clientId/files/roots`
- `rootId + path` request shape
- permission error semantics

- [ ] **Step 2: Update testing docs**

Add to `docs/TESTING.md`:

```markdown
## Root-Aware Client File Manager Tests

默认 E2E 会验证服务端文件仓库与基础任务流。
FRP 文件管理根目录测试使用：

```bash
RAG_E2E_FRP_FILE_TESTS=1 pnpm test:e2e
```

测试覆盖：

- roots 列表
- rootId + path 浏览
- 上传到当前节点当前根目录
- 写文件
- 删除文件
- 权限与越界错误
```
```

- [ ] **Step 3: Run doc-adjacent verification**

Run:

```bash
pnpm build:dist
```

Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add README.md docs/TESTING.md apps/client/config.example.json
git commit -m "docs: document root-aware client file manager"
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
RAG_E2E_FRP_FILE_TESTS=1 pnpm test:e2e
```

Expected final state:

- Client config supports `allowedRoots` and resilient FRP binary path resolution.
- Client local HTTP file service lists roots and enforces root boundaries.
- Server routes proxy root-aware operations with clear error semantics.
- Frontend client file manager supports node selection, root selection, modal-based file actions, and direct upload to the current node path.
- Default E2E remains stable and FRP-enabled E2E proves the root-aware HTTP file data plane works.

---

## Self-Review

**Spec coverage:** This plan covers `allowedRoots`, root metadata, `rootId + path` API shape, client root resolution, server proxy/routes, frontend root sidebar/modal workflow, and E2E/docs updates.

**Placeholder scan:** No `TBD`/`TODO` placeholders remain; every task includes file targets, commands, and expected outcomes.

**Type consistency:** The plan consistently uses `ClientFileRoot`, `rootId`, and `path` across shared types, client helpers, server routes, and frontend state.
