# Stable Upload Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace fragile single-request client file upload with a resumable chunked upload flow that keeps `files upload` unchanged for callers while adding retry, resume, and visible progress.

**Architecture:** Add an upload-session protocol on the client HTTP side and route CLI uploads through a new transfer helper that reads local files by chunk, retries transient failures, resumes from persisted remote state, and reports progress continuously. Keep the legacy `/files/upload` route for compatibility, but make the CLI use the new session endpoints by default so large uploads no longer buffer the whole file in memory on either side.

**Tech Stack:** Node.js 22, TypeScript, Vitest, existing client HTTP router, Commander CLI, FRP-backed direct client HTTP, `@rag/shared` types.

---

## File Structure

### Shared upload contracts

- Modify: `packages/shared/src/types.ts`
  - Add typed payload/result interfaces for upload session init/status/part/complete/abort.
- Modify: `packages/shared/src/index.ts`
  - Re-export the new upload session types.

### Client upload session runtime

- Create: `apps/client/src/runtime/control-http/upload-session.ts`
  - Own upload session persistence, temp part files, resume lookup, chunk writes, final assembly, abort, and stale cleanup.
- Create: `apps/client/src/runtime/control-http/upload-session.test.ts`
  - Unit-test session lifecycle without going through HTTP routing.
- Modify: `apps/client/src/runtime/control-http/file-routes.ts`
  - Register `/files/uploads/*` endpoints and wire them to the session manager.
- Create: `apps/client/src/runtime/control-http/file-routes.upload.test.ts`
  - Route-level tests for init → part upload → status → complete → abort behavior.

### CLI upload transport

- Modify: `apps/cli/src/http/client-http.ts`
  - Add upload-session client methods and low-level request support for chunk headers.
- Create: `apps/cli/src/http/upload-transfer.ts`
  - Own chunk sizing, lightweight fingerprinting, retry, resume, throughput calculation, and progress callbacks.
- Create: `apps/cli/src/http/upload-transfer.test.ts`
  - Verify retry/resume/progress behavior.
- Modify: `apps/cli/src/http/http.test.ts`
  - Verify the new HTTP methods hit the correct routes.

### CLI command wiring and docs

- Modify: `apps/cli/src/commands/files.ts`
  - Change `files upload` from `readFile()` + single POST to the new transfer helper.
- Modify: `apps/cli/src/commands/commands.test.ts`
  - Add `files upload` command coverage with helper mocking.
- Modify: `README.md`
  - Document the resumable upload behavior and the new client HTTP endpoints.
- Modify: `skills/rag-agent/references/api-map.md`
  - Map `files upload` to the upload-session endpoints instead of only `/files/upload`.
- Modify: `skills/rag-agent/references/workflows.md`
  - Document progress/resume expectations for long-running uploads.

---

## Task 1: Add shared contracts and client upload-session core

**Files:**
- Modify: `packages/shared/src/types.ts`
- Modify: `packages/shared/src/index.ts`
- Create: `apps/client/src/runtime/control-http/upload-session.ts`
- Create: `apps/client/src/runtime/control-http/upload-session.test.ts`

- [ ] **Step 1: Write the failing upload-session unit tests**

Create `apps/client/src/runtime/control-http/upload-session.test.ts`:

```ts
import { beforeEach, describe, expect, it } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { createUploadSessionManager } from './upload-session.js';

function makeWorkspace(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'rag-upload-session-'));
}

async function* bytes(value: string): AsyncGenerator<Buffer> {
  yield Buffer.from(value, 'utf8');
}

describe('createUploadSessionManager', () => {
  let workspaceDir: string;

  beforeEach(() => {
    workspaceDir = makeWorkspace();
  });

  it('creates and resumes the same session for the same target fingerprint', async () => {
    const manager = createUploadSessionManager({ workspaceDir, ttlMs: 24 * 60 * 60 * 1000 });

    const first = await manager.init({
      rootId: 'root-0',
      targetPath: 'releases',
      filename: 'demo.jar',
      size: 12,
      chunkSize: 4,
      fingerprint: 'fingerprint-1',
    });

    await manager.writePart(first.uploadId, 0, bytes('ABCD'), { expectedSize: 4, expectedOffset: 0 });

    const resumed = await manager.init({
      rootId: 'root-0',
      targetPath: 'releases',
      filename: 'demo.jar',
      size: 12,
      chunkSize: 4,
      fingerprint: 'fingerprint-1',
    });

    expect(resumed.uploadId).toBe(first.uploadId);
    expect(resumed.uploadedParts).toEqual([0]);
    expect(resumed.uploadedBytes).toBe(4);
  });

  it('assembles uploaded parts into the final file and removes the session directory', async () => {
    const targetRoot = path.join(workspaceDir, 'allowed-root');
    fs.mkdirSync(targetRoot, { recursive: true });
    const manager = createUploadSessionManager({ workspaceDir, ttlMs: 24 * 60 * 60 * 1000 });

    const session = await manager.init({
      rootId: 'root-0',
      targetPath: 'drop',
      filename: 'demo.jar',
      size: 12,
      chunkSize: 4,
      fingerprint: 'assemble-1',
      resolvedTargetDir: path.join(targetRoot, 'drop'),
    });

    await manager.writePart(session.uploadId, 0, bytes('ABCD'), { expectedSize: 4, expectedOffset: 0 });
    await manager.writePart(session.uploadId, 1, bytes('EFGH'), { expectedSize: 4, expectedOffset: 4 });
    await manager.writePart(session.uploadId, 2, bytes('IJKL'), { expectedSize: 4, expectedOffset: 8 });

    const completed = await manager.complete(session.uploadId);

    expect(completed.path).toBe('drop/demo.jar');
    expect(fs.readFileSync(path.join(targetRoot, 'drop', 'demo.jar'), 'utf8')).toBe('ABCDEFGHIJKL');
    expect(fs.existsSync(path.join(workspaceDir, '.rag-upload-sessions', session.uploadId))).toBe(false);
  });

  it('rejects completion when any part is missing', async () => {
    const manager = createUploadSessionManager({ workspaceDir, ttlMs: 24 * 60 * 60 * 1000 });
    const session = await manager.init({
      rootId: 'root-0',
      targetPath: '.',
      filename: 'demo.jar',
      size: 8,
      chunkSize: 4,
      fingerprint: 'missing-part',
    });

    await manager.writePart(session.uploadId, 0, bytes('ABCD'), { expectedSize: 4, expectedOffset: 0 });

    await expect(manager.complete(session.uploadId)).rejects.toThrow('Missing uploaded part 1');
  });
});
```

- [ ] **Step 2: Run the new client unit tests and verify failure**

Run:

```bash
pnpm --filter @rag/client test -- upload-session.test.ts
```

Expected: FAIL because `upload-session.ts` does not exist yet.

- [ ] **Step 3: Add the shared upload session interfaces**

Modify `packages/shared/src/types.ts` by adding these interfaces near the file operation types:

```ts
export interface ClientFileUploadInitPayload {
  rootId: string;
  path: string;
  filename: string;
  size: number;
  chunkSize?: number;
  lastModifiedMs?: number;
  fingerprint?: string;
}

export interface ClientFileUploadInitResult {
  uploadId: string;
  rootId: string;
  path: string;
  filename: string;
  size: number;
  chunkSize: number;
  partCount: number;
  uploadedParts: number[];
  uploadedBytes: number;
  resumed: boolean;
}

export interface ClientFileUploadStatusResult extends ClientFileUploadInitResult {
  expiresAt: number;
}

export interface ClientFileUploadPartResult {
  uploadId: string;
  partNumber: number;
  size: number;
  uploadedBytes: number;
}

export interface ClientFileUploadCompleteResult {
  uploadId: string;
  rootId: string;
  path: string;
  size: number;
}

export interface ClientFileUploadAbortResult {
  uploadId: string;
  deleted: true;
}
```

Modify `packages/shared/src/index.ts` so the new interfaces stay exported through the package barrel:

```ts
export * from './types.js';
export * from './protocol.js';
export * from './schemas.js';
export * from './task-audit.js';
```

No new barrel line is required because the interfaces live in `types.ts`; keep this file unchanged except for preserving the existing export order if formatting moves it.

- [ ] **Step 4: Implement the upload session manager**

Create `apps/client/src/runtime/control-http/upload-session.ts`:

```ts
import { randomUUID } from 'node:crypto';
import * as fs from 'node:fs';
import * as path from 'node:path';
import type {
  ClientFileUploadAbortResult,
  ClientFileUploadCompleteResult,
  ClientFileUploadInitResult,
  ClientFileUploadStatusResult,
} from '@rag/shared';

interface UploadSessionMeta {
  uploadId: string;
  rootId: string;
  targetPath: string;
  filename: string;
  size: number;
  chunkSize: number;
  partCount: number;
  fingerprint: string;
  resolvedTargetDir: string;
  createdAt: number;
  updatedAt: number;
}

interface UploadSessionState {
  uploadedParts: number[];
  uploadedBytes: number;
}

interface InitInput {
  rootId: string;
  targetPath: string;
  filename: string;
  size: number;
  chunkSize: number;
  fingerprint: string;
  resolvedTargetDir?: string;
}

interface WritePartOptions {
  expectedSize: number;
  expectedOffset: number;
}

export function createUploadSessionManager(options: { workspaceDir: string; ttlMs: number }) {
  const sessionsRoot = path.join(options.workspaceDir, '.rag-upload-sessions');

  function ensureDir(dir: string): void {
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  }

  function sessionDir(uploadId: string): string {
    return path.join(sessionsRoot, uploadId);
  }

  function metaPath(uploadId: string): string {
    return path.join(sessionDir(uploadId), 'meta.json');
  }

  function statePath(uploadId: string): string {
    return path.join(sessionDir(uploadId), 'state.json');
  }

  function partPath(uploadId: string, partNumber: number): string {
    return path.join(sessionDir(uploadId), `part-${String(partNumber).padStart(6, '0')}`);
  }

  function readMeta(uploadId: string): UploadSessionMeta {
    return JSON.parse(fs.readFileSync(metaPath(uploadId), 'utf8')) as UploadSessionMeta;
  }

  function readState(uploadId: string): UploadSessionState {
    return JSON.parse(fs.readFileSync(statePath(uploadId), 'utf8')) as UploadSessionState;
  }

  function writeState(uploadId: string, state: UploadSessionState): void {
    fs.writeFileSync(statePath(uploadId), JSON.stringify(state, null, 2));
  }

  function toInitResult(meta: UploadSessionMeta, state: UploadSessionState, resumed: boolean): ClientFileUploadInitResult {
    return {
      uploadId: meta.uploadId,
      rootId: meta.rootId,
      path: meta.targetPath,
      filename: meta.filename,
      size: meta.size,
      chunkSize: meta.chunkSize,
      partCount: meta.partCount,
      uploadedParts: [...state.uploadedParts].sort((a, b) => a - b),
      uploadedBytes: state.uploadedBytes,
      resumed,
    };
  }

  function toStatusResult(meta: UploadSessionMeta, state: UploadSessionState): ClientFileUploadStatusResult {
    return {
      ...toInitResult(meta, state, true),
      expiresAt: meta.updatedAt + options.ttlMs,
    };
  }

  function listUploadIds(): string[] {
    if (!fs.existsSync(sessionsRoot)) return [];
    return fs.readdirSync(sessionsRoot).filter((entry) => fs.existsSync(metaPath(entry)));
  }

  function findReusableSession(input: InitInput): UploadSessionMeta | null {
    for (const uploadId of listUploadIds()) {
      const meta = readMeta(uploadId);
      if (
        meta.rootId === input.rootId &&
        meta.targetPath === input.targetPath &&
        meta.filename === input.filename &&
        meta.size === input.size &&
        meta.fingerprint === input.fingerprint
      ) {
        return meta;
      }
    }
    return null;
  }

  async function streamToFile(body: AsyncIterable<Buffer>, destination: string): Promise<number> {
    const output = fs.createWriteStream(destination);
    let written = 0;
    for await (const chunk of body) {
      written += chunk.length;
      if (!output.write(chunk)) await new Promise((resolve) => output.once('drain', resolve));
    }
    await new Promise<void>((resolve, reject) => {
      output.end(() => resolve());
      output.once('error', reject);
    });
    return written;
  }

  function cleanupExpired(): void {
    ensureDir(sessionsRoot);
    const now = Date.now();
    for (const uploadId of listUploadIds()) {
      const meta = readMeta(uploadId);
      if (now - meta.updatedAt > options.ttlMs) fs.rmSync(sessionDir(uploadId), { recursive: true, force: true });
    }
  }

  return {
    async init(input: InitInput): Promise<ClientFileUploadInitResult> {
      cleanupExpired();
      ensureDir(sessionsRoot);
      const existing = findReusableSession(input);
      if (existing) {
        existing.updatedAt = Date.now();
        fs.writeFileSync(metaPath(existing.uploadId), JSON.stringify(existing, null, 2));
        return toInitResult(existing, readState(existing.uploadId), true);
      }

      const uploadId = `upl_${randomUUID().slice(0, 12)}`;
      const partCount = Math.ceil(input.size / input.chunkSize);
      const meta: UploadSessionMeta = {
        uploadId,
        rootId: input.rootId,
        targetPath: input.targetPath,
        filename: input.filename,
        size: input.size,
        chunkSize: input.chunkSize,
        partCount,
        fingerprint: input.fingerprint,
        resolvedTargetDir: input.resolvedTargetDir ?? '',
        createdAt: Date.now(),
        updatedAt: Date.now(),
      };
      ensureDir(sessionDir(uploadId));
      fs.writeFileSync(metaPath(uploadId), JSON.stringify(meta, null, 2));
      writeState(uploadId, { uploadedParts: [], uploadedBytes: 0 });
      return toInitResult(meta, { uploadedParts: [], uploadedBytes: 0 }, false);
    },

    getStatus(uploadId: string): ClientFileUploadStatusResult {
      return toStatusResult(readMeta(uploadId), readState(uploadId));
    },

    async writePart(uploadId: string, partNumber: number, body: AsyncIterable<Buffer>, options: WritePartOptions) {
      const meta = readMeta(uploadId);
      if (partNumber < 0 || partNumber >= meta.partCount) throw new Error(`Invalid partNumber ${partNumber}`);
      const expectedBytes = partNumber === meta.partCount - 1
        ? meta.size - (meta.chunkSize * (meta.partCount - 1))
        : meta.chunkSize;
      if (options.expectedSize !== expectedBytes) throw new Error(`Chunk size mismatch for part ${partNumber}`);
      if (options.expectedOffset !== partNumber * meta.chunkSize) throw new Error(`Chunk offset mismatch for part ${partNumber}`);

      const bytes = await streamToFile(body, partPath(uploadId, partNumber));
      if (bytes !== expectedBytes) throw new Error(`Chunk body length mismatch for part ${partNumber}`);

      const state = readState(uploadId);
      if (!state.uploadedParts.includes(partNumber)) {
        state.uploadedParts.push(partNumber);
        state.uploadedBytes += bytes;
      }
      meta.updatedAt = Date.now();
      fs.writeFileSync(metaPath(uploadId), JSON.stringify(meta, null, 2));
      writeState(uploadId, state);
      return { uploadId, partNumber, size: bytes, uploadedBytes: state.uploadedBytes };
    },

    complete(uploadId: string): ClientFileUploadCompleteResult {
      const meta = readMeta(uploadId);
      const state = readState(uploadId);
      const uploaded = new Set(state.uploadedParts);
      for (let partNumber = 0; partNumber < meta.partCount; partNumber += 1) {
        if (!uploaded.has(partNumber)) throw new Error(`Missing uploaded part ${partNumber}`);
      }
      const targetDir = meta.resolvedTargetDir;
      if (!targetDir) throw new Error('Missing resolved target directory');
      fs.mkdirSync(targetDir, { recursive: true });
      const assemblingPath = path.join(sessionDir(uploadId), 'assembling.tmp');
      const output = fs.createWriteStream(assemblingPath);
      for (let partNumber = 0; partNumber < meta.partCount; partNumber += 1) {
        output.write(fs.readFileSync(partPath(uploadId, partNumber)));
      }
      output.end();
      const finalPath = path.join(targetDir, meta.filename);
      fs.renameSync(assemblingPath, finalPath);
      fs.rmSync(sessionDir(uploadId), { recursive: true, force: true });
      return {
        uploadId,
        rootId: meta.rootId,
        path: meta.targetPath === '.' ? meta.filename : path.posix.join(meta.targetPath, meta.filename),
        size: meta.size,
      };
    },

    abort(uploadId: string): ClientFileUploadAbortResult {
      fs.rmSync(sessionDir(uploadId), { recursive: true, force: true });
      return { uploadId, deleted: true };
    },
  };
}
```

- [ ] **Step 5: Re-run the upload-session test file**

Run:

```bash
pnpm --filter @rag/client test -- upload-session.test.ts
```

Expected: PASS with 3 passing tests.

- [ ] **Step 6: Commit the upload-session core**

Run:

```bash
git add packages/shared/src/types.ts packages/shared/src/index.ts apps/client/src/runtime/control-http/upload-session.ts apps/client/src/runtime/control-http/upload-session.test.ts
git commit -m "feat(client): add resumable upload session core"
```

Expected: commit succeeds.

---

## Task 2: Expose chunked upload routes on the client HTTP service

**Files:**
- Modify: `apps/client/src/runtime/control-http/file-routes.ts`
- Create: `apps/client/src/runtime/control-http/file-routes.upload.test.ts`

- [ ] **Step 1: Write failing route-level tests for the new upload endpoints**

Create `apps/client/src/runtime/control-http/file-routes.upload.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { EventEmitter } from 'node:events';
import { ControlHttpRouter } from './router.js';
import { registerFileRoutes } from './file-routes.js';

function makeWorkDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rag-file-routes-upload-'));
  fs.mkdirSync(path.join(dir, 'workspace'), { recursive: true });
  return dir;
}

function jsonRequest(method: string, url: string, payload: unknown) {
  const body = Buffer.from(JSON.stringify(payload));
  return {
    method,
    url,
    headers: {
      authorization: 'Bearer test-token',
      'content-type': 'application/json',
      'content-length': String(body.length),
    },
    async *[Symbol.asyncIterator]() {
      yield body;
    },
  };
}

function binaryRequest(method: string, url: string, payload: string, extraHeaders: Record<string, string> = {}) {
  const body = Buffer.from(payload, 'utf8');
  return {
    method,
    url,
    headers: {
      authorization: 'Bearer test-token',
      'content-type': 'application/octet-stream',
      'content-length': String(body.length),
      ...extraHeaders,
    },
    async *[Symbol.asyncIterator]() {
      yield body;
    },
  };
}

function createResponseCapture() {
  let statusCode = 0;
  let body = '';
  const res = new EventEmitter() as any;
  res.setHeader = () => undefined;
  res.writeHead = (code: number) => { statusCode = code; };
  res.end = (chunk?: Buffer | string) => {
    body = chunk ? String(chunk) : '';
    res.emit('finish');
  };
  return {
    res,
    get statusCode() { return statusCode; },
    get json() { return body ? JSON.parse(body) : null; },
  };
}

describe('upload routes', () => {
  it('supports init, part upload, status, complete, and abort', async () => {
    const workDir = makeWorkDir();
    const router = new ControlHttpRouter();

    registerFileRoutes(router, {
      token: 'test-token',
      workspaceDir: path.join(workDir, 'workspace'),
      allowedRoots: [path.join(workDir, 'workspace')],
      clientId: 'client-1',
    }, {
      execute: async ({ run }: any) => {
        const result = await run();
        return result.body;
      },
    } as any);

    const initRes = createResponseCapture();
    await router.handle(jsonRequest('POST', '/files/uploads/init', {
      rootId: 'root-0', path: 'drop', filename: 'demo.jar', size: 8, chunkSize: 4, fingerprint: 'fp-1',
    }) as any, initRes.res as any);
    const uploadId = initRes.json.data.uploadId as string;

    const part0 = createResponseCapture();
    await router.handle(binaryRequest('PUT', `/files/uploads/${uploadId}/parts/0?offset=0&size=4`, 'ABCD') as any, part0.res as any);

    const statusRes = createResponseCapture();
    await router.handle({ method: 'GET', url: `/files/uploads/${uploadId}/status`, headers: { authorization: 'Bearer test-token' }, async *[Symbol.asyncIterator]() {} } as any, statusRes.res as any);

    const part1 = createResponseCapture();
    await router.handle(binaryRequest('PUT', `/files/uploads/${uploadId}/parts/1?offset=4&size=4`, 'EFGH') as any, part1.res as any);

    const completeRes = createResponseCapture();
    await router.handle(jsonRequest('POST', `/files/uploads/${uploadId}/complete`, {}) as any, completeRes.res as any);

    expect(initRes.statusCode).toBe(200);
    expect(part0.json.data.uploadedBytes).toBe(4);
    expect(statusRes.json.data.uploadedParts).toEqual([0]);
    expect(completeRes.json.data.path).toBe('drop/demo.jar');
    expect(fs.readFileSync(path.join(workDir, 'workspace', 'drop', 'demo.jar'), 'utf8')).toBe('ABCDEFGH');
  });
});
```

- [ ] **Step 2: Run the route test file and verify failure**

Run:

```bash
pnpm --filter @rag/client test -- file-routes.upload.test.ts
```

Expected: FAIL because the new routes do not exist yet.

- [ ] **Step 3: Wire the upload session manager into `file-routes.ts`**

Modify `apps/client/src/runtime/control-http/file-routes.ts`.

Add the import near the top:

```ts
import { createUploadSessionManager } from './upload-session.js';
```

Create one manager inside `registerFileRoutes(...)` after `const roots = ...`:

```ts
  const uploadSessions = createUploadSessionManager({
    workspaceDir: options.workspaceDir,
    ttlMs: 24 * 60 * 60 * 1000,
  });
```

Add small helpers inside the file for upload routes:

```ts
function queryInteger(url: URL, key: string): number {
  const raw = url.searchParams.get(key);
  if (!raw) throw new Error(`${key} is required`);
  const value = Number(raw);
  if (!Number.isInteger(value) || value < 0) throw new Error(`${key} must be a non-negative integer`);
  return value;
}

function parseUploadRoute(url: URL): { uploadId: string; partNumber?: number } {
  const match = url.pathname.match(/^\/files\/uploads\/([^/]+)(?:\/parts\/(\d+)|\/(status|complete))?$/);
  if (!match) throw new Error('Invalid upload route');
  return {
    uploadId: decodeURIComponent(match[1]),
    partNumber: match[2] === undefined ? undefined : Number(match[2]),
  };
}
```

Register these routes before the legacy `/files/upload` route:

```ts
  router.add('POST', /^\/files\/uploads\/init$/, async (req, res) => {
    if (!requireBearerToken(req, res, options.token)) return;
    try {
      const payload = await readJson<{ rootId: string; path: string; filename: string; size: number; chunkSize?: number; fingerprint?: string }>(req);
      if (!payload.filename || payload.filename.includes('/') || payload.filename.includes('\\')) {
        return sendError(res, 400, 'INVALID_REQUEST', 'Invalid filename');
      }
      const targetDir = resolveRootPath(roots, payload.rootId, payload.path);
      ensureDir(targetDir);
      const responseBody = await uploadSessions.init({
        rootId: payload.rootId,
        targetPath: payload.path,
        filename: payload.filename,
        size: payload.size,
        chunkSize: payload.chunkSize ?? 8 * 1024 * 1024,
        fingerprint: payload.fingerprint ?? `${payload.filename}:${payload.size}`,
        resolvedTargetDir: targetDir,
      });
      sendOk(res, responseBody);
    } catch (err) {
      handleFailure(res, err);
    }
  });

  router.add('GET', /^\/files\/uploads\/[^/]+\/status$/, (req, res, url) => {
    if (!requireBearerToken(req, res, options.token)) return;
    try {
      const { uploadId } = parseUploadRoute(url);
      sendOk(res, uploadSessions.getStatus(uploadId));
    } catch (err) {
      handleFailure(res, err);
    }
  });

  router.add('PUT', /^\/files\/uploads\/[^/]+\/parts\/\d+$/, async (req, res, url) => {
    if (!requireBearerToken(req, res, options.token)) return;
    try {
      const { uploadId, partNumber } = parseUploadRoute(url);
      const offset = queryInteger(url, 'offset');
      const size = queryInteger(url, 'size');
      const responseBody = await uploadSessions.writePart(uploadId, partNumber!, req, { expectedOffset: offset, expectedSize: size });
      sendOk(res, responseBody);
    } catch (err) {
      handleFailure(res, err);
    }
  });

  router.add('POST', /^\/files\/uploads\/[^/]+\/complete$/, async (req, res, url) => {
    if (!requireBearerToken(req, res, options.token)) return;
    try {
      const { uploadId } = parseUploadRoute(url);
      const status = uploadSessions.getStatus(uploadId);
      const responseBody = await audit.execute({
        req,
        actionType: 'file.upload',
        resourceType: 'file',
        method: 'POST',
        path: '/files/uploads/:uploadId/complete',
        payload: { rootId: status.rootId, path: status.path, filename: status.filename, size: status.size },
        run: async () => {
          const completed = uploadSessions.complete(uploadId);
          return {
            httpStatus: 200,
            resultSummary: { size: completed.size },
            targetId: `${completed.rootId}:${completed.path}`,
            status: 'success',
            body: completed,
          };
        },
      });
      sendOk(res, responseBody);
    } catch (err) {
      handleFailure(res, err);
    }
  });

  router.add('DELETE', /^\/files\/uploads\/[^/]+$/, (req, res, url) => {
    if (!requireBearerToken(req, res, options.token)) return;
    try {
      const { uploadId } = parseUploadRoute(url);
      sendOk(res, uploadSessions.abort(uploadId));
    } catch (err) {
      handleFailure(res, err);
    }
  });
```

Keep the legacy `/files/upload` route unchanged in this task; the CLI migration happens later.

- [ ] **Step 4: Run the client upload route tests**

Run:

```bash
pnpm --filter @rag/client test -- file-routes.upload.test.ts upload-session.test.ts
```

Expected: PASS with both test files green.

- [ ] **Step 5: Commit the client HTTP route changes**

Run:

```bash
git add apps/client/src/runtime/control-http/file-routes.ts apps/client/src/runtime/control-http/file-routes.upload.test.ts apps/client/src/runtime/control-http/upload-session.ts apps/client/src/runtime/control-http/upload-session.test.ts
git commit -m "feat(client): expose chunked upload session routes"
```

Expected: commit succeeds.

---

## Task 3: Add CLI upload-session API methods and transfer engine

**Files:**
- Modify: `apps/cli/src/http/client-http.ts`
- Modify: `apps/cli/src/http/http.test.ts`
- Create: `apps/cli/src/http/upload-transfer.ts`
- Create: `apps/cli/src/http/upload-transfer.test.ts`

- [ ] **Step 1: Write failing CLI HTTP and transfer tests**

Create `apps/cli/src/http/upload-transfer.test.ts`:

```ts
import { beforeEach, describe, expect, it, vi } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { CliError } from './http-error.js';
import { uploadFileWithProgress } from './upload-transfer.js';

function makeFile(content: string): string {
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'rag-upload-transfer-')), 'demo.jar');
  fs.writeFileSync(file, content, 'utf8');
  return file;
}

describe('uploadFileWithProgress', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('resumes already uploaded parts and reports progress for missing parts only', async () => {
    const file = makeFile('ABCDEFGHIJKL');
    const api = {
      initUploadSession: vi.fn().mockResolvedValue({
        uploadId: 'upl_1',
        rootId: 'root-0',
        path: 'drop',
        filename: 'demo.jar',
        size: 12,
        chunkSize: 4,
        partCount: 3,
        uploadedParts: [0],
        uploadedBytes: 4,
        resumed: true,
      }),
      uploadPart: vi.fn().mockResolvedValue(undefined),
      completeUploadSession: vi.fn().mockResolvedValue({ uploadId: 'upl_1', rootId: 'root-0', path: 'drop/demo.jar', size: 12 }),
      abortUploadSession: vi.fn(),
    } as any;
    const progress = vi.fn();

    const result = await uploadFileWithProgress(api, {
      rootId: 'root-0',
      path: 'drop',
      filePath: file,
      filename: 'demo.jar',
      chunkSize: 4,
      onProgress: progress,
    });

    expect(api.uploadPart).toHaveBeenCalledTimes(2);
    expect(api.uploadPart).toHaveBeenNthCalledWith(1, 'upl_1', 1, expect.any(Uint8Array), { offset: 4, size: 4 });
    expect(api.uploadPart).toHaveBeenNthCalledWith(2, 'upl_1', 2, expect.any(Uint8Array), { offset: 8, size: 4 });
    expect(api.completeUploadSession).toHaveBeenCalledWith('upl_1');
    expect(progress).toHaveBeenLastCalledWith(expect.objectContaining({ uploadedBytes: 12, totalBytes: 12, partNumber: 2, partCount: 3 }));
    expect(result.path).toBe('drop/demo.jar');
  });

  it('retries retryable part failures before succeeding', async () => {
    const file = makeFile('ABCDEFGH');
    const api = {
      initUploadSession: vi.fn().mockResolvedValue({
        uploadId: 'upl_2',
        rootId: 'root-0',
        path: '.',
        filename: 'demo.jar',
        size: 8,
        chunkSize: 4,
        partCount: 2,
        uploadedParts: [],
        uploadedBytes: 0,
        resumed: false,
      }),
      uploadPart: vi.fn()
        .mockRejectedValueOnce(new CliError('HTTP_ERROR', 'gateway reset', 504))
        .mockResolvedValueOnce(undefined)
        .mockResolvedValueOnce(undefined),
      completeUploadSession: vi.fn().mockResolvedValue({ uploadId: 'upl_2', rootId: 'root-0', path: 'demo.jar', size: 8 }),
      abortUploadSession: vi.fn(),
    } as any;

    await uploadFileWithProgress(api, {
      rootId: 'root-0',
      path: '.',
      filePath: file,
      filename: 'demo.jar',
      chunkSize: 4,
    });

    expect(api.uploadPart).toHaveBeenCalledTimes(3);
  });
});
```

Append these tests to `apps/cli/src/http/http.test.ts` inside `describe('ClientHttpApi', ...)`:

```ts
  it('initializes upload sessions with json payload', async () => {
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({ uploadId: 'upl_1', partCount: 2 }), { status: 200 }));
    const api = new ClientHttpApi({ baseUrl: 'http://client:20000', token: 'client-token' });

    await api.initUploadSession({ rootId: 'root-0', path: 'drop', filename: 'demo.jar', size: 8, chunkSize: 4, fingerprint: 'fp' });

    expect(fetchMock).toHaveBeenCalledWith('http://client:20000/files/uploads/init', expect.objectContaining({
      method: 'POST',
      headers: expect.objectContaining({ Authorization: 'Bearer client-token', 'Content-Type': 'application/json' }),
    }));
  });

  it('uploads one binary part with offset and size query params', async () => {
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({ uploadId: 'upl_1', partNumber: 0, size: 4, uploadedBytes: 4 }), { status: 200 }));
    const api = new ClientHttpApi({ baseUrl: 'http://client:20000', token: 'client-token' });

    await api.uploadPart('upl_1', 0, new Uint8Array([1, 2, 3, 4]), { offset: 0, size: 4 });

    expect(fetchMock).toHaveBeenCalledWith('http://client:20000/files/uploads/upl_1/parts/0?offset=0&size=4', expect.objectContaining({
      method: 'PUT',
      headers: expect.objectContaining({ Authorization: 'Bearer client-token', 'Content-Type': 'application/octet-stream' }),
    }));
  });
```

- [ ] **Step 2: Run the CLI tests and verify failure**

Run:

```bash
pnpm --filter @rag/cli test -- http.test.ts upload-transfer.test.ts
```

Expected: FAIL because the new methods/helper do not exist.

- [ ] **Step 3: Add upload-session methods to `ClientHttpApi`**

Modify `apps/cli/src/http/client-http.ts`.

Add imports/types at the top:

```ts
import type {
  ClientFileUploadAbortResult,
  ClientFileUploadCompleteResult,
  ClientFileUploadInitPayload,
  ClientFileUploadInitResult,
  ClientFileUploadPartResult,
  ClientFileUploadStatusResult,
} from '@rag/shared';
```

Add these methods to `ClientHttpApi`:

```ts
  initUploadSession(payload: ClientFileUploadInitPayload): Promise<ClientFileUploadInitResult> {
    return this.request('POST', '/files/uploads/init', payload) as Promise<ClientFileUploadInitResult>;
  }

  getUploadStatus(uploadId: string): Promise<ClientFileUploadStatusResult> {
    return this.request('GET', `/files/uploads/${encodeURIComponent(uploadId)}/status`) as Promise<ClientFileUploadStatusResult>;
  }

  uploadPart(uploadId: string, partNumber: number, body: Uint8Array, options: { offset: number; size: number }): Promise<ClientFileUploadPartResult> {
    const search = new URLSearchParams({ offset: String(options.offset), size: String(options.size) });
    return this.request('PUT', `/files/uploads/${encodeURIComponent(uploadId)}/parts/${partNumber}?${search.toString()}`, body, 'json', 'application/octet-stream') as Promise<ClientFileUploadPartResult>;
  }

  completeUploadSession(uploadId: string): Promise<ClientFileUploadCompleteResult> {
    return this.request('POST', `/files/uploads/${encodeURIComponent(uploadId)}/complete`, {}) as Promise<ClientFileUploadCompleteResult>;
  }

  abortUploadSession(uploadId: string): Promise<ClientFileUploadAbortResult> {
    return this.request('DELETE', `/files/uploads/${encodeURIComponent(uploadId)}`) as Promise<ClientFileUploadAbortResult>;
  }
```

Leave the existing `request(...)` method intact; it already supports binary request bodies through the `contentType` parameter.

- [ ] **Step 4: Implement the chunked transfer helper**

Create `apps/cli/src/http/upload-transfer.ts`:

```ts
import { createHash } from 'node:crypto';
import * as fs from 'node:fs/promises';
import type { ClientFileUploadCompleteResult, ClientFileUploadInitResult } from '@rag/shared';
import type { ClientHttpApi } from './client-http.js';
import { CliError } from './http-error.js';

export interface UploadProgress {
  filename: string;
  uploadedBytes: number;
  totalBytes: number;
  partNumber: number;
  partCount: number;
  attempt: number;
  rateBytesPerSecond: number;
  elapsedMs: number;
}

export async function uploadFileWithProgress(
  client: Pick<ClientHttpApi, 'initUploadSession' | 'uploadPart' | 'completeUploadSession' | 'abortUploadSession'>,
  options: {
    rootId: string;
    path: string;
    filePath: string;
    filename: string;
    chunkSize?: number;
    retries?: number;
    onProgress?: (progress: UploadProgress) => void;
  },
): Promise<ClientFileUploadCompleteResult> {
  const stat = await fs.stat(options.filePath);
  const chunkSize = options.chunkSize ?? 8 * 1024 * 1024;
  const retries = options.retries ?? 5;
  const fingerprint = await createFingerprint(options.filePath, stat.size, stat.mtimeMs);
  const init = await client.initUploadSession({
    rootId: options.rootId,
    path: options.path,
    filename: options.filename,
    size: stat.size,
    chunkSize,
    lastModifiedMs: Math.trunc(stat.mtimeMs),
    fingerprint,
  });

  const file = await fs.open(options.filePath, 'r');
  const startedAt = Date.now();
  let uploadedBytes = init.uploadedBytes;
  const uploadedParts = new Set(init.uploadedParts);

  try {
    for (let partNumber = 0; partNumber < init.partCount; partNumber += 1) {
      if (uploadedParts.has(partNumber)) continue;
      const offset = partNumber * init.chunkSize;
      const size = resolvePartSize(init, partNumber);
      const buffer = Buffer.alloc(size);
      const { bytesRead } = await file.read(buffer, 0, size, offset);
      if (bytesRead !== size) throw new CliError('IO_ERROR', `Expected ${size} bytes at offset ${offset}, got ${bytesRead}`);
      await uploadPartWithRetry(client, init.uploadId, partNumber, buffer, { offset, size }, retries);
      uploadedBytes += size;
      options.onProgress?.({
        filename: options.filename,
        uploadedBytes,
        totalBytes: stat.size,
        partNumber,
        partCount: init.partCount,
        attempt: 1,
        rateBytesPerSecond: uploadedBytes / Math.max((Date.now() - startedAt) / 1000, 1),
        elapsedMs: Date.now() - startedAt,
      });
    }
    return await client.completeUploadSession(init.uploadId);
  } catch (error) {
    if (!isRetryable(error)) {
      await client.abortUploadSession(init.uploadId).catch(() => undefined);
    }
    throw error;
  } finally {
    await file.close();
  }
}

function resolvePartSize(init: ClientFileUploadInitResult, partNumber: number): number {
  if (partNumber === init.partCount - 1) return init.size - (init.chunkSize * (init.partCount - 1));
  return init.chunkSize;
}

async function createFingerprint(filePath: string, size: number, mtimeMs: number): Promise<string> {
  const file = await fs.open(filePath, 'r');
  try {
    const head = Buffer.alloc(Math.min(size, 64 * 1024));
    const tail = Buffer.alloc(Math.min(size, 64 * 1024));
    await file.read(head, 0, head.length, 0);
    await file.read(tail, 0, tail.length, Math.max(0, size - tail.length));
    return createHash('sha256').update(String(size)).update(String(Math.trunc(mtimeMs))).update(head).update(tail).digest('hex');
  } finally {
    await file.close();
  }
}

async function uploadPartWithRetry(
  client: Pick<ClientHttpApi, 'uploadPart'>,
  uploadId: string,
  partNumber: number,
  buffer: Uint8Array,
  meta: { offset: number; size: number },
  retries: number,
): Promise<void> {
  for (let attempt = 1; attempt <= retries; attempt += 1) {
    try {
      await client.uploadPart(uploadId, partNumber, buffer, meta);
      return;
    } catch (error) {
      if (!isRetryable(error) || attempt === retries) throw error;
      await sleep(resolveBackoffMs(attempt));
    }
  }
}

function isRetryable(error: unknown): boolean {
  if (error instanceof CliError && error.code === 'HTTP_ERROR') return [502, 503, 504].includes(error.status ?? 0);
  const message = error instanceof Error ? error.message.toLowerCase() : String(error).toLowerCase();
  return message.includes('econnreset') || message.includes('etimedout') || message.includes('fetch failed') || message.includes('socket hang up');
}

function resolveBackoffMs(attempt: number): number {
  return [0, 2000, 5000, 10000, 10000, 10000][attempt] ?? 10000;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
```

- [ ] **Step 5: Run the CLI upload tests**

Run:

```bash
pnpm --filter @rag/cli test -- http.test.ts upload-transfer.test.ts
```

Expected: PASS with the new API and transfer tests green.

- [ ] **Step 6: Commit the CLI transport layer**

Run:

```bash
git add apps/cli/src/http/client-http.ts apps/cli/src/http/http.test.ts apps/cli/src/http/upload-transfer.ts apps/cli/src/http/upload-transfer.test.ts
git commit -m "feat(cli): add resumable chunked upload transport"
```

Expected: commit succeeds.

---

## Task 4: Switch `files upload` to the new helper and update docs

**Files:**
- Modify: `apps/cli/src/commands/files.ts`
- Modify: `apps/cli/src/commands/commands.test.ts`
- Modify: `README.md`
- Modify: `skills/rag-agent/references/api-map.md`
- Modify: `skills/rag-agent/references/workflows.md`

- [ ] **Step 1: Add a failing `files upload` command test**

Modify `apps/cli/src/commands/commands.test.ts` by hoisting a mock for the new helper and adding an upload case:

```ts
const { uploadFileWithProgressMock } = vi.hoisted(() => ({
  uploadFileWithProgressMock: vi.fn(),
}));

vi.mock('../http/upload-transfer.js', () => ({
  uploadFileWithProgress: uploadFileWithProgressMock,
}));
```

Add this test inside `describe('client direct command groups', ...)`:

```ts
  it('runs files upload through the resumable transfer helper', async () => {
    const outputs: unknown[] = [];
    const clientHttp = {};
    uploadFileWithProgressMock.mockResolvedValueOnce({
      uploadId: 'upl_1',
      rootId: 'root-0',
      path: 'drop/demo.jar',
      size: 12,
    });

    const program = new Command();
    program.exitOverride();
    registerFilesCommands(program, {
      discoverClientHttp: async () => clientHttp as any,
      write: (value) => outputs.push(value),
      writeRaw: (value) => outputs.push(value),
    });

    await program.parseAsync(['files', 'upload', '--client', 'client-1', '--root', 'root-0', '--path', 'drop', '--file', 'demo.jar'], { from: 'user' });

    expect(uploadFileWithProgressMock).toHaveBeenCalledWith(clientHttp, expect.objectContaining({
      rootId: 'root-0',
      path: 'drop',
      filePath: 'demo.jar',
      filename: 'demo.jar',
      onProgress: expect.any(Function),
    }));
    expect(outputs[0]).toEqual({ ok: true, data: { uploadId: 'upl_1', rootId: 'root-0', path: 'drop/demo.jar', size: 12 } });
  });
```

- [ ] **Step 2: Run the command tests and verify failure**

Run:

```bash
pnpm --filter @rag/cli test -- commands.test.ts
```

Expected: FAIL because `files.ts` still reads the whole file and never calls the helper.

- [ ] **Step 3: Switch the command to `uploadFileWithProgress`**

Modify `apps/cli/src/commands/files.ts`.

Add the import near the top:

```ts
import { uploadFileWithProgress } from '../http/upload-transfer.js';
```

Replace the existing `files.command('upload')...` action with:

```ts
  files.command('upload')
    .requiredOption('--client <clientId>')
    .requiredOption('--root <rootId>')
    .requiredOption('--path <path>')
    .requiredOption('--file <file>')
    .option('--filename <filename>')
    .action(async (options: any) => {
      const client = await deps.discoverClientHttp(requiredString(options.client, '--client'));
      const filename = options.filename ?? options.file.split(/[\\/]/).pop();
      const result = await uploadFileWithProgress(client, {
        rootId: options.root,
        path: options.path,
        filePath: options.file,
        filename,
        onProgress: (progress) => {
          const percent = ((progress.uploadedBytes / progress.totalBytes) * 100).toFixed(1);
          const kbPerSecond = (progress.rateBytesPerSecond / 1024).toFixed(1);
          const remainingBytes = progress.totalBytes - progress.uploadedBytes;
          const etaSeconds = progress.rateBytesPerSecond <= 0 ? 0 : Math.ceil(remainingBytes / progress.rateBytesPerSecond);
          process.stderr.write(
            `\rUploading ${progress.filename} ${percent}% (${progress.uploadedBytes}/${progress.totalBytes}) | ${kbPerSecond} KB/s | ETA ${etaSeconds}s | chunk ${progress.partNumber + 1}/${progress.partCount}`,
          );
          if (progress.uploadedBytes === progress.totalBytes) process.stderr.write('\n');
        },
      });
      deps.write(successEnvelope(result));
    });
```

Also remove this import because the command no longer uses whole-file buffering:

```ts
import { readFile, writeFile } from 'node:fs/promises';
```

Replace it with:

```ts
import { writeFile } from 'node:fs/promises';
```

- [ ] **Step 4: Update docs to reflect the new upload behavior**

Modify `README.md`.

In the Client HTTP API table, replace the single-upload row with both the legacy and new session routes:

```md
| `POST` | `/files/upload?rootId=...&path=...&filename=...` | 旧版单请求上传（保留兼容，不推荐大文件） |
| `POST` | `/files/uploads/init` | 初始化/恢复分片上传会话 |
| `GET` | `/files/uploads/:uploadId/status` | 查询分片上传状态 |
| `PUT` | `/files/uploads/:uploadId/parts/:partNumber?offset=...&size=...` | 上传单个分片 |
| `POST` | `/files/uploads/:uploadId/complete` | 合并并发布最终文件 |
| `DELETE` | `/files/uploads/:uploadId` | 中止并清理上传会话 |
```

Add this note under the CLI file workflow section:

```md
`files upload` 现在默认使用可续传的分片上传协议：

- 对调用方仍然保持同一条命令
- 自动显示进度、速度与剩余时间
- 弱网/FRP 抖动时按分片重试
- 再次执行同样的上传命令时会尽量续传，而不是从 0 开始
```

Modify `skills/rag-agent/references/api-map.md` for the file upload row:

```md
| `node ./run.cjs files upload --client <id> --root root-0 --path . --file ./x` | `POST /files/uploads/init` → `PUT /files/uploads/:uploadId/parts/:partNumber` → `POST /files/uploads/:uploadId/complete` |
```

Modify `skills/rag-agent/references/workflows.md` near the upload examples:

```md
`files upload` 会持续输出进度；大文件/弱网场景下如果命令被外层调用超时中断，重新执行相同命令会优先尝试续传。
```

- [ ] **Step 5: Run full verification for upload-related suites**

Run:

```bash
pnpm --filter @rag/shared typecheck
pnpm --filter @rag/client test -- upload-session.test.ts file-routes.upload.test.ts
pnpm --filter @rag/cli test -- http.test.ts upload-transfer.test.ts commands.test.ts
pnpm --filter @rag/client typecheck
pnpm --filter @rag/cli typecheck
```

Expected:

- all listed tests PASS
- both package typechecks PASS with zero TypeScript errors

- [ ] **Step 6: Commit the command switch and docs**

Run:

```bash
git add apps/cli/src/commands/files.ts apps/cli/src/commands/commands.test.ts README.md skills/rag-agent/references/api-map.md skills/rag-agent/references/workflows.md
git commit -m "feat(cli): use resumable upload workflow by default"
```

Expected: commit succeeds.

---

## Task 5: Final integration verification on a live client

**Files:**
- No source changes required unless verification uncovers a bug.

- [ ] **Step 1: Build the workspace artifacts used by the skill bundle**

Run:

```bash
pnpm build
```

Expected: workspace build completes successfully and refreshes the bundled CLI output used by `skills/rag-agent/run.cjs`.

- [ ] **Step 2: Smoke-test a resumable upload against a real client with a small file**

Run:

```bash
node skills/rag-agent/run.cjs files upload --client licheng --root root-0 --path verify_small --file apps/client/workspace/workspace/test-upload.txt
```

Expected:

- progress output appears
- command returns `{ "ok": true, ... }`
- resulting path ends with `verify_small/test-upload.txt`

- [ ] **Step 3: Smoke-test resume behavior with a larger file by interrupting once and retrying**

First run with a large local file and interrupt it manually after at least one chunk completes:

```bash
node skills/rag-agent/run.cjs files upload --client licheng --root root-0 --path verify_large --file D:/OptiMinderHub/OptiMinder/jar_chunks/chunk_ae
```

Then immediately rerun the exact same command:

```bash
node skills/rag-agent/run.cjs files upload --client licheng --root root-0 --path verify_large --file D:/OptiMinderHub/OptiMinder/jar_chunks/chunk_ae
```

Expected:

- second run shows progress starting above 0% or skipping already uploaded chunks
- final command succeeds without retransmitting the entire file

- [ ] **Step 4: Capture verification notes before declaring completion**

Record these facts in the final handoff note:

```md
- exact commands run
- whether progress was visible
- whether resume skipped previously uploaded chunks
- any observed throughput number on the live tunnel
- any follow-up issue still remaining (if any)
```

Expected: completion note includes evidence, not just a claim.

---

## Self-Review

### Spec coverage

- Upload-session protocol: Task 2
- Resume support: Tasks 1 and 3
- Progress visibility: Tasks 3 and 4
- Lower memory pressure: Tasks 1, 2, and 4 remove whole-file buffering in the CLI path and whole-request buffering in the new client path
- Retry on unstable links: Task 3
- Cleanup of stale sessions: Task 1
- Docs and caller simplicity: Task 4
- Live verification: Task 5

### Placeholder scan

Checked this plan for placeholder markers and vague “add validation/error handling” instructions. None remain.

### Type consistency

The plan consistently uses:

- `ClientFileUploadInitPayload`
- `ClientFileUploadInitResult`
- `ClientFileUploadStatusResult`
- `ClientFileUploadPartResult`
- `ClientFileUploadCompleteResult`
- `ClientFileUploadAbortResult`
- `uploadFileWithProgress(...)`
- `createUploadSessionManager(...)`

No conflicting names remain across tasks.
