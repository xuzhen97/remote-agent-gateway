# Client HTTP Task Audit and History Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add client-local audit persistence, server mirrored task history APIs, and a web `任务` page for all mutating client HTTP operations.

**Architecture:** The client remains the audit source of truth by recording one structured history row per mutating client HTTP request, then asynchronously mirrors a redacted summary to the server. The server stores an idempotent task-history projection in SQLite and exposes list/detail APIs that power a reusable `TasksPage` with both global and per-client views.

**Tech Stack:** TypeScript, Node.js, Fastify, sql.js, React 19, Vite, Ant Design, Vitest, Zod

---

## File Structure

### Shared contracts

- Create: `packages/shared/src/task-audit.ts` — shared enums, helper types, redaction helpers, and Zod-backed DTOs for task audit records and task query filters
- Modify: `packages/shared/src/types.ts` — export concrete task-audit interfaces used by client/server/web
- Modify: `packages/shared/src/schemas.ts` — export task-audit schemas and query schemas
- Modify: `packages/shared/src/index.ts` — re-export new task-audit APIs
- Test: `packages/shared/src/__tests__/schemas.test.ts` — schema validation coverage for task-audit payloads and filters

### Client-side audit source of truth

- Create: `apps/client/src/runtime/control-http/request-context.ts` — parse trusted audit headers and generate request IDs
- Create: `apps/client/src/runtime/control-http/task-audit-store.ts` — structured local persistence and sync-status updates
- Create: `apps/client/src/runtime/control-http/task-audit-redaction.ts` — request/result redaction helpers per action type
- Create: `apps/client/src/runtime/control-http/task-audit-actions.ts` — explicit action-to-summary mapping for every audited mutating route
- Create: `apps/client/src/runtime/control-http/task-audit-reporter.ts` — async mirror upload to server and local sync-status transitions
- Create: `apps/client/src/runtime/control-http/task-audit.ts` — orchestration helper for executing audited mutating routes
- Modify: `apps/client/src/runtime/control-http/auth.ts` — expose bearer-token parsing helper and request audit identity extraction
- Modify: `apps/client/src/runtime/control-http/server.ts` — construct audit dependencies and inject them into route registration
- Modify: `apps/client/src/runtime/control-http/job-routes.ts` — wrap mutating job routes with audit recording
- Modify: `apps/client/src/runtime/control-http/file-routes.ts` — wrap mutating file routes with audit recording
- Modify: `apps/client/src/runtime/control-http/frp-routes.ts` — wrap mutating FRP routes with audit recording
- Modify: `apps/client/src/config/client.config.ts` — add local task-audit storage path config with sensible default
- Modify: `apps/client/src/main.ts` — pass task-audit storage config into control HTTP server startup
- Test: `apps/client/src/runtime/control-http/task-audit-store.test.ts` — local persistence behavior
- Test: `apps/client/src/runtime/control-http/task-audit-redaction.test.ts` — redaction boundaries for every in-scope mutating action
- Test: `apps/client/src/runtime/control-http/task-audit-reporter.test.ts` — sync success/failure behavior
- Test: `apps/client/src/runtime/control-http/job-routes.test.ts` — job route auditing coverage
- Test: `apps/client/src/runtime/control-http/file-routes.test.ts` — file route auditing coverage
- Test: `apps/client/src/runtime/control-http/frp-routes.test.ts` — FRP route auditing coverage

### Server-side mirrored projection

- Create: `apps/server/src/modules/tasks/tasks.schemas.ts` — server-side task-history query parsing helpers built from shared schemas
- Create: `apps/server/src/modules/tasks/tasks.service.ts` — idempotent insert and query methods over SQLite task-history table
- Create: `apps/server/src/modules/tasks/tasks.routes.ts` — `/api/tasks` list/detail endpoints and `/api/client-audit/records` ingest endpoint
- Test: `apps/server/src/modules/tasks/tasks.service.test.ts` — insert/query/idempotency behavior
- Test: `apps/server/src/modules/tasks/tasks.routes.test.ts` — route auth, list filters, detail, and ingest behavior
- Modify: `apps/server/src/db/migrate.ts` — create task-history mirror table and indexes
- Modify: `apps/server/src/main.ts` — register task routes
- Modify: `apps/server/src/modules/client-http/client-http-admin.service.ts` — propagate trusted source headers for server-mediated client HTTP calls
- Modify: `apps/server/src/modules/client-http/client-http-admin.routes.ts` — add `/tasks` pass-through only if needed for client-specific future extension; do not block current plan if omitted

### Web task history UI

- Create: `apps/web/src/api/tasks.ts` — typed task list/detail API calls
- Create: `apps/web/src/pages/TasksPage.tsx` — unified global/per-client task history page with filters, table, and detail drawer
- Modify: `apps/web/package.json` — add React Testing Library dependencies needed by the new page tests
- Modify: `apps/web/src/components/AppLayout.tsx` — add `任务` nav item
- Modify: `apps/web/src/App.tsx` — add `tasks` route state and client-filter navigation support
- Modify: `apps/web/src/pages/ClientsPage.tsx` — add per-client `任务` button
- Modify: `apps/web/src/components/StatusTag.tsx` — ensure task status labels render clearly
- Test: `apps/web/src/api/__tests__/tasks.test.ts` — API helper tests
- Test: `apps/web/src/pages/TasksPage.test.tsx` — page rendering, filters, and drawer behavior

### Docs and verification

- Modify: `README.md` — document task audit/history capability and new task page
- Modify: `docs/TESTING.md` — document new verification paths and tests

## Task 1: Add shared task-audit contracts and schema coverage

**Files:**
- Create: `packages/shared/src/task-audit.ts`
- Modify: `packages/shared/src/types.ts`
- Modify: `packages/shared/src/schemas.ts`
- Modify: `packages/shared/src/index.ts`
- Test: `packages/shared/src/__tests__/schemas.test.ts`

- [ ] **Step 1: Write the failing schema tests for task-audit records and task queries**

```ts
import { describe, expect, it } from 'vitest';
import {
  ClientTaskAuditMirrorRecordSchema,
  ClientTaskAuditLocalRecordSchema,
  TaskHistoryQuerySchema,
} from '../schemas.js';

describe('task audit schemas', () => {
  it('accepts a local record with sync metadata', () => {
    const value = ClientTaskAuditLocalRecordSchema.parse({
      recordId: 'rec_01',
      clientId: 'client-1',
      requestId: 'req_01',
      resourceType: 'file',
      actionType: 'file.write',
      method: 'PUT',
      path: '/files/write',
      targetId: 'workspace:src/index.ts',
      sourceType: 'web-console',
      actorType: 'admin-token',
      actorLabel: 'web-console/admin-token',
      requestSummary: { rootId: 'workspace', path: 'src/index.ts', size: 123 },
      resultSummary: { size: 123 },
      status: 'success',
      httpStatus: 200,
      startedAt: 1710000000000,
      finishedAt: 1710000000100,
      durationMs: 100,
      syncStatus: 'pending',
      reportedAt: 1710000000101,
    });

    expect(value.syncStatus).toBe('pending');
  });

  it('accepts mirrored query filters', () => {
    const value = TaskHistoryQuerySchema.parse({
      clientId: 'client-1',
      status: 'failed',
      resourceType: 'file',
      actionType: 'file.write',
      sourceType: 'web-console',
      page: '2',
      pageSize: '20',
    });

    expect(value.page).toBe(2);
    expect(value.pageSize).toBe(20);
  });

  it('rejects invalid audit statuses', () => {
    expect(() => ClientTaskAuditMirrorRecordSchema.parse({
      recordId: 'rec_01',
      clientId: 'client-1',
      requestId: 'req_01',
      resourceType: 'file',
      actionType: 'file.write',
      method: 'PUT',
      path: '/files/write',
      targetId: 'workspace:src/index.ts',
      sourceType: 'web-console',
      actorType: 'admin-token',
      actorLabel: 'web-console/admin-token',
      requestSummary: {},
      resultSummary: {},
      status: 'running',
      httpStatus: 200,
      startedAt: 1710000000000,
      finishedAt: 1710000000100,
      durationMs: 100,
      reportedAt: 1710000000101,
    })).toThrow();
  });
});
```

- [ ] **Step 2: Run the shared schema test to verify it fails**

Run: `pnpm --filter @rag/shared test -- schemas.test.ts`
Expected: FAIL with missing task-audit schemas/exports.

- [ ] **Step 3: Add shared task-audit types and schemas**

```ts
// packages/shared/src/task-audit.ts
import { z } from 'zod';

export const TaskResourceTypeSchema = z.enum(['job', 'file', 'frp_mapping']);
export const TaskActionTypeSchema = z.enum([
  'job.command',
  'job.script',
  'job.cancel',
  'file.write',
  'file.upload',
  'file.mkdir',
  'file.delete',
  'file.move',
  'file.copy',
  'frp_mapping.create',
  'frp_mapping.delete',
]);
export const TaskStatusSchema = z.enum(['success', 'failed', 'cancelled']);
export const TaskSourceTypeSchema = z.enum(['web-console', 'agent-api', 'server-proxy', 'direct-client-http', 'unknown']);
export const TaskActorTypeSchema = z.enum(['admin-token', 'agent-token', 'client-token', 'unknown-token']);
export const TaskSyncStatusSchema = z.enum(['pending', 'synced', 'sync_failed']);

export const TaskSummaryJsonSchema = z.record(z.string(), z.unknown());

export const ClientTaskAuditMirrorRecordSchema = z.object({
  recordId: z.string().min(1),
  clientId: z.string().min(1),
  clientNameSnapshot: z.string().optional(),
  requestId: z.string().min(1),
  jobId: z.string().optional().nullable(),
  resourceType: TaskResourceTypeSchema,
  actionType: TaskActionTypeSchema,
  method: z.string().min(1),
  path: z.string().min(1),
  targetId: z.string().min(1),
  sourceType: TaskSourceTypeSchema,
  actorType: TaskActorTypeSchema,
  actorLabel: z.string().min(1),
  querySummary: TaskSummaryJsonSchema.optional(),
  requestSummary: TaskSummaryJsonSchema,
  resultSummary: TaskSummaryJsonSchema,
  status: TaskStatusSchema,
  httpStatus: z.number().int(),
  startedAt: z.number().int(),
  finishedAt: z.number().int(),
  durationMs: z.number().int().min(0),
  errorCode: z.string().optional().nullable(),
  errorMessage: z.string().optional().nullable(),
  reportedAt: z.number().int(),
  receivedAt: z.number().int().optional(),
});

export const ClientTaskAuditLocalRecordSchema = ClientTaskAuditMirrorRecordSchema.extend({
  syncStatus: TaskSyncStatusSchema,
  syncedAt: z.number().int().optional().nullable(),
  syncError: z.string().optional().nullable(),
  metadata: TaskSummaryJsonSchema.optional(),
});

export const TaskHistoryQuerySchema = z.object({
  clientId: z.string().min(1).optional(),
  status: TaskStatusSchema.optional(),
  resourceType: TaskResourceTypeSchema.optional(),
  actionType: TaskActionTypeSchema.optional(),
  sourceType: TaskSourceTypeSchema.optional(),
  keyword: z.string().min(1).optional(),
  from: z.coerce.number().int().optional(),
  to: z.coerce.number().int().optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
});

export type ClientTaskAuditMirrorRecord = z.infer<typeof ClientTaskAuditMirrorRecordSchema>;
export type ClientTaskAuditLocalRecord = z.infer<typeof ClientTaskAuditLocalRecordSchema>;
export type TaskHistoryQuery = z.infer<typeof TaskHistoryQuerySchema>;
```

```ts
// packages/shared/src/types.ts
export interface ClientTaskHistoryItem {
  recordId: string;
  clientId: string;
  clientNameSnapshot?: string;
  requestId: string;
  jobId?: string | null;
  resourceType: 'job' | 'file' | 'frp_mapping';
  actionType:
    | 'job.command'
    | 'job.script'
    | 'job.cancel'
    | 'file.write'
    | 'file.upload'
    | 'file.mkdir'
    | 'file.delete'
    | 'file.move'
    | 'file.copy'
    | 'frp_mapping.create'
    | 'frp_mapping.delete';
  method: string;
  path: string;
  targetId: string;
  sourceType: 'web-console' | 'agent-api' | 'server-proxy' | 'direct-client-http' | 'unknown';
  actorType: 'admin-token' | 'agent-token' | 'client-token' | 'unknown-token';
  actorLabel: string;
  querySummary?: Record<string, unknown>;
  requestSummary: Record<string, unknown>;
  resultSummary: Record<string, unknown>;
  status: 'success' | 'failed' | 'cancelled';
  httpStatus: number;
  startedAt: number;
  finishedAt: number;
  durationMs: number;
  errorCode?: string | null;
  errorMessage?: string | null;
  reportedAt: number;
  receivedAt?: number;
}
```

```ts
// packages/shared/src/index.ts
export * from './task-audit.js';
```

- [ ] **Step 4: Run the shared schema test to verify it passes**

Run: `pnpm --filter @rag/shared test -- schemas.test.ts`
Expected: PASS with task-audit schema coverage green.

- [ ] **Step 5: Commit shared task-audit contracts**

```bash
git add packages/shared/src/task-audit.ts packages/shared/src/types.ts packages/shared/src/schemas.ts packages/shared/src/index.ts packages/shared/src/__tests__/schemas.test.ts
git commit -m "feat(shared): add task audit contracts"
```

## Task 2: Add client-local task-audit storage and redaction helpers

**Files:**
- Create: `apps/client/src/runtime/control-http/request-context.ts`
- Create: `apps/client/src/runtime/control-http/task-audit-store.ts`
- Create: `apps/client/src/runtime/control-http/task-audit-redaction.ts`
- Create: `apps/client/src/runtime/control-http/task-audit-actions.ts`
- Modify: `apps/client/src/runtime/control-http/auth.ts`
- Modify: `apps/client/src/config/client.config.ts`
- Modify: `apps/client/src/main.ts`
- Test: `apps/client/src/runtime/control-http/task-audit-store.test.ts`
- Test: `apps/client/src/runtime/control-http/task-audit-redaction.test.ts`

- [ ] **Step 1: Write failing tests for local persistence and redaction rules**

```ts
import { describe, expect, it } from 'vitest';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createTaskAuditStore } from './task-audit-store.js';
import { summarizeTaskAudit } from './task-audit-redaction.js';

describe('task audit store', () => {
  it('persists records and updates sync status', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'rag-task-audit-'));
    const store = createTaskAuditStore(join(dir, 'task-audit.jsonl'));

    await store.append({
      recordId: 'rec_01',
      clientId: 'client-1',
      requestId: 'req_01',
      resourceType: 'file',
      actionType: 'file.write',
      method: 'PUT',
      path: '/files/write',
      targetId: 'workspace:src/index.ts',
      sourceType: 'web-console',
      actorType: 'admin-token',
      actorLabel: 'web-console/admin-token',
      requestSummary: { path: 'src/index.ts', size: 12 },
      resultSummary: { size: 12 },
      status: 'success',
      httpStatus: 200,
      startedAt: 1,
      finishedAt: 2,
      durationMs: 1,
      syncStatus: 'pending',
      reportedAt: 2,
    });

    await store.updateSync('rec_01', { syncStatus: 'synced', syncedAt: 3, syncError: null });

    const text = readFileSync(join(dir, 'task-audit.jsonl'), 'utf8');
    expect(text).toContain('"recordId":"rec_01"');
    expect(text).toContain('"syncStatus":"synced"');
  });
});

describe('task audit redaction', () => {
  it('redacts script bodies and env values', () => {
    const summary = summarizeTaskAudit({
      actionType: 'job.script',
      method: 'POST',
      path: '/jobs/script',
      payload: {
        runtime: 'node',
        script: 'console.log(process.env.SECRET)',
        env: { SECRET: 'shh', SAFE: 'ok' },
        timeoutMs: 1000,
      },
      result: { jobId: 'job_01', status: 'queued' },
    });

    expect(summary.requestSummary).toEqual({
      runtime: 'node',
      scriptLength: 31,
      envKeys: ['SAFE', 'SECRET'],
      timeoutMs: 1000,
    });
    expect(JSON.stringify(summary)).not.toContain('shh');
    expect(JSON.stringify(summary)).not.toContain('console.log(process.env.SECRET)');
  });

  it('summarizes all remaining mutating routes without leaking raw bodies', () => {
    expect(summarizeTaskAudit({
      actionType: 'job.command',
      method: 'POST',
      path: '/jobs/command',
      payload: { command: 'node', args: ['-e', 'console.log(1)'], env: { TOKEN: 'secret' } },
      result: { jobId: 'job_02', status: 'queued' },
    }).requestSummary).toMatchObject({ command: 'node', argsPreview: ['-e', 'console.log(1)'], envKeys: ['TOKEN'] });

    expect(summarizeTaskAudit({
      actionType: 'job.cancel',
      method: 'POST',
      path: '/jobs/job_02/cancel',
      payload: { jobId: 'job_02' },
      result: { status: 'cancelled' },
    }).targetId).toBe('job_02');

    expect(summarizeTaskAudit({
      actionType: 'file.upload',
      method: 'POST',
      path: '/files/upload',
      payload: { rootId: 'workspace', path: 'dist', filename: 'app.zip', size: 2048 },
      result: { size: 2048 },
    }).requestSummary).toEqual({ rootId: 'workspace', path: 'dist', filename: 'app.zip', size: 2048 });

    expect(summarizeTaskAudit({
      actionType: 'file.mkdir',
      method: 'POST',
      path: '/files/mkdir',
      payload: { rootId: 'workspace', path: 'logs', recursive: true },
      result: {},
    }).targetId).toBe('workspace:logs');

    expect(summarizeTaskAudit({
      actionType: 'file.delete',
      method: 'DELETE',
      path: '/files',
      payload: { rootId: 'workspace', path: 'tmp.log', recursive: false },
      result: { deleted: true },
    }).requestSummary).toEqual({ rootId: 'workspace', path: 'tmp.log', recursive: false });

    expect(summarizeTaskAudit({
      actionType: 'file.move',
      method: 'POST',
      path: '/files/move',
      payload: { rootId: 'workspace', from: 'a.txt', to: 'archive/a.txt', overwrite: false },
      result: {},
    }).requestSummary).toEqual({ rootId: 'workspace', from: 'a.txt', to: 'archive/a.txt', overwrite: false });

    expect(summarizeTaskAudit({
      actionType: 'file.copy',
      method: 'POST',
      path: '/files/copy',
      payload: { rootId: 'workspace', from: 'a.txt', to: 'copy/a.txt', overwrite: true },
      result: {},
    }).requestSummary).toEqual({ rootId: 'workspace', from: 'a.txt', to: 'copy/a.txt', overwrite: true });

    expect(summarizeTaskAudit({
      actionType: 'frp_mapping.create',
      method: 'POST',
      path: '/frp/mappings',
      payload: { name: 'vite', type: 'tcp', localHost: '127.0.0.1', localPort: 5173, remotePort: 15173 },
      result: { id: 'pm_01', remotePort: 15173 },
    }).targetId).toBe('pm_01');

    expect(summarizeTaskAudit({
      actionType: 'frp_mapping.delete',
      method: 'DELETE',
      path: '/frp/mappings/pm_01',
      payload: { mappingId: 'pm_01' },
      result: { deleted: true },
    }).targetId).toBe('pm_01');
  });
});
```

- [ ] **Step 2: Run the client tests to verify they fail**

Run: `pnpm --filter @rag/client test -- task-audit-store.test.ts task-audit-redaction.test.ts`
Expected: FAIL with missing store/redaction modules.

- [ ] **Step 3: Implement task-audit store, request context, and redaction helpers**

```ts
// apps/client/src/runtime/control-http/task-audit-store.ts
import * as fs from 'node:fs';
import * as path from 'node:path';
import type { ClientTaskAuditLocalRecord } from '@rag/shared';

interface SyncPatch {
  syncStatus: 'pending' | 'synced' | 'sync_failed';
  syncedAt?: number | null;
  syncError?: string | null;
}

export interface TaskAuditStore {
  append(record: ClientTaskAuditLocalRecord): Promise<void>;
  updateSync(recordId: string, patch: SyncPatch): Promise<void>;
  list(): Promise<ClientTaskAuditLocalRecord[]>;
}

export function createTaskAuditStore(filePath: string): TaskAuditStore {
  function ensureDir() {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    if (!fs.existsSync(filePath)) fs.writeFileSync(filePath, '', 'utf8');
  }

  async function list(): Promise<ClientTaskAuditLocalRecord[]> {
    ensureDir();
    const text = fs.readFileSync(filePath, 'utf8').trim();
    if (!text) return [];
    return text.split(/\r?\n/).filter(Boolean).map((line) => JSON.parse(line) as ClientTaskAuditLocalRecord);
  }

  async function writeAll(records: ClientTaskAuditLocalRecord[]): Promise<void> {
    ensureDir();
    const body = records.map((record) => JSON.stringify(record)).join('\n');
    fs.writeFileSync(filePath, body ? `${body}\n` : '', 'utf8');
  }

  return {
    async append(record) {
      ensureDir();
      fs.appendFileSync(filePath, `${JSON.stringify(record)}\n`, 'utf8');
    },
    async updateSync(recordId, patch) {
      const records = await list();
      const next = records.map((record) => (
        record.recordId === recordId
          ? { ...record, ...patch }
          : record
      ));
      await writeAll(next);
    },
    list,
  };
}
```

```ts
// apps/client/src/runtime/control-http/task-audit-actions.ts
import type { TaskActionType } from '@rag/shared';

export interface TaskAuditActionSummary {
  targetId: string;
  requestSummary: Record<string, unknown>;
  resultSummary: Record<string, unknown>;
}

export function buildTaskAuditActionSummary(input: {
  actionType: TaskActionType;
  method: string;
  path: string;
  payload?: Record<string, unknown>;
  result?: Record<string, unknown>;
}): TaskAuditActionSummary {
  const payload = input.payload ?? {};
  const result = input.result ?? {};

  switch (input.actionType) {
    case 'job.command':
      return {
        targetId: String(result.jobId ?? 'job:pending'),
        requestSummary: {
          command: payload.command ?? null,
          argsPreview: Array.isArray(payload.args) ? payload.args.slice(0, 5) : [],
          cwd: payload.cwd ?? null,
          timeoutMs: payload.timeoutMs ?? null,
          envKeys: payload.env && typeof payload.env === 'object' ? Object.keys(payload.env as Record<string, string>).sort() : [],
        },
        resultSummary: { jobId: result.jobId ?? null, status: result.status ?? null },
      };
    case 'job.script': {
      const script = typeof payload.script === 'string' ? payload.script : '';
      return {
        targetId: String(result.jobId ?? 'job:pending'),
        requestSummary: {
          runtime: payload.runtime ?? 'node',
          scriptLength: script.length,
          cwd: payload.cwd ?? null,
          timeoutMs: payload.timeoutMs ?? null,
          envKeys: payload.env && typeof payload.env === 'object' ? Object.keys(payload.env as Record<string, string>).sort() : [],
        },
        resultSummary: { jobId: result.jobId ?? null, status: result.status ?? null },
      };
    }
    case 'job.cancel':
      return {
        targetId: String(payload.jobId ?? result.jobId ?? 'job:unknown'),
        requestSummary: { jobId: payload.jobId ?? result.jobId ?? null },
        resultSummary: { status: result.status ?? 'cancelled' },
      };
    case 'file.write':
      return {
        targetId: `${payload.rootId ?? 'root'}:${payload.path ?? 'unknown'}`,
        requestSummary: { rootId: payload.rootId ?? null, path: payload.path ?? null, size: payload.size ?? null },
        resultSummary: { size: result.size ?? null },
      };
    case 'file.upload':
      return {
        targetId: `${payload.rootId ?? 'root'}:${payload.path ?? 'unknown'}/${payload.filename ?? 'unknown'}`,
        requestSummary: { rootId: payload.rootId ?? null, path: payload.path ?? null, filename: payload.filename ?? null, size: payload.size ?? null },
        resultSummary: { size: result.size ?? null },
      };
    case 'file.mkdir':
      return {
        targetId: `${payload.rootId ?? 'root'}:${payload.path ?? 'unknown'}`,
        requestSummary: { rootId: payload.rootId ?? null, path: payload.path ?? null, recursive: payload.recursive ?? true },
        resultSummary: {},
      };
    case 'file.delete':
      return {
        targetId: `${payload.rootId ?? 'root'}:${payload.path ?? 'unknown'}`,
        requestSummary: { rootId: payload.rootId ?? null, path: payload.path ?? null, recursive: payload.recursive ?? false },
        resultSummary: { deleted: result.deleted ?? null },
      };
    case 'file.move':
      return {
        targetId: `${payload.rootId ?? 'root'}:${payload.to ?? 'unknown'}`,
        requestSummary: { rootId: payload.rootId ?? null, from: payload.from ?? null, to: payload.to ?? null, overwrite: payload.overwrite ?? false },
        resultSummary: {},
      };
    case 'file.copy':
      return {
        targetId: `${payload.rootId ?? 'root'}:${payload.to ?? 'unknown'}`,
        requestSummary: { rootId: payload.rootId ?? null, from: payload.from ?? null, to: payload.to ?? null, overwrite: payload.overwrite ?? false },
        resultSummary: {},
      };
    case 'frp_mapping.create':
      return {
        targetId: String(result.id ?? 'mapping:pending'),
        requestSummary: { name: payload.name ?? null, type: payload.type ?? null, localHost: payload.localHost ?? null, localPort: payload.localPort ?? null, remotePort: payload.remotePort ?? null },
        resultSummary: { id: result.id ?? null, remotePort: result.remotePort ?? null, publicUrl: result.publicUrl ?? null },
      };
    case 'frp_mapping.delete':
      return {
        targetId: String(payload.mappingId ?? result.id ?? 'mapping:unknown'),
        requestSummary: { mappingId: payload.mappingId ?? result.id ?? null },
        resultSummary: { deleted: result.deleted ?? null },
      };
  }
}
```

```ts
// apps/client/src/runtime/control-http/task-audit-redaction.ts
import type { TaskActionType, ClientTaskAuditMirrorRecord } from '@rag/shared';
import { buildTaskAuditActionSummary } from './task-audit-actions.js';

export function summarizeTaskAudit(input: {
  actionType: TaskActionType;
  method: string;
  path: string;
  payload?: Record<string, unknown>;
  result?: Record<string, unknown>;
}): Pick<ClientTaskAuditMirrorRecord, 'requestSummary' | 'resultSummary' | 'targetId'> {
  return buildTaskAuditActionSummary(input);
}
```

```ts
// apps/client/src/runtime/control-http/request-context.ts
import { randomUUID } from 'node:crypto';
import type { IncomingMessage } from 'node:http';
import { parseBearerToken } from './auth.js';

export interface TaskAuditRequestContext {
  requestId: string;
  sourceType: 'web-console' | 'agent-api' | 'server-proxy' | 'direct-client-http' | 'unknown';
  actorType: 'admin-token' | 'agent-token' | 'client-token' | 'unknown-token';
  actorLabel: string;
}

export function resolveTaskAuditRequestContext(req: IncomingMessage): TaskAuditRequestContext {
  const sourceHeader = req.headers['x-rag-source'];
  const actorHeader = req.headers['x-rag-actor-type'];
  const sourceType = typeof sourceHeader === 'string' ? sourceHeader as TaskAuditRequestContext['sourceType'] : 'direct-client-http';
  const actorType = typeof actorHeader === 'string'
    ? actorHeader as TaskAuditRequestContext['actorType']
    : (parseBearerToken(req.headers.authorization) ? 'client-token' : 'unknown-token');
  return {
    requestId: randomUUID(),
    sourceType,
    actorType,
    actorLabel: `${sourceType}/${actorType}`,
  };
}
```

```ts
// apps/client/src/runtime/control-http/auth.ts
export function parseBearerToken(authHeader?: string): string | null {
  if (!authHeader) return null;
  const [scheme, token] = authHeader.split(' ');
  if (scheme !== 'Bearer' || !token) return null;
  return token;
}
```

```ts
// apps/client/src/config/client.config.ts
export interface ClientConfig {
  // existing fields...
  taskAuditStorePath: string;
}

// inside normalizeYamlConfig()
const taskAuditStorePath = path.resolve(configDir, '.rag/task-audit.jsonl');
return {
  // existing fields...
  taskAuditStorePath,
};
```

```ts
// apps/client/src/main.ts
      job: {
        maxConcurrent: config.jobMaxConcurrent,
        defaultTimeoutMs: config.jobDefaultTimeoutMs,
        maxTimeoutMs: config.jobMaxTimeoutMs,
        logBufferLines: config.jobLogBufferLines,
      },
      taskAuditStorePath: config.taskAuditStorePath,
```

- [ ] **Step 4: Run the client tests to verify they pass**

Run: `pnpm --filter @rag/client test -- task-audit-store.test.ts task-audit-redaction.test.ts`
Expected: PASS with local persistence and redaction behavior green.

- [ ] **Step 5: Commit the client audit storage foundation**

```bash
git add apps/client/src/runtime/control-http/request-context.ts apps/client/src/runtime/control-http/task-audit-store.ts apps/client/src/runtime/control-http/task-audit-redaction.ts apps/client/src/runtime/control-http/task-audit-actions.ts apps/client/src/runtime/control-http/auth.ts apps/client/src/config/client.config.ts apps/client/src/main.ts apps/client/src/runtime/control-http/task-audit-store.test.ts apps/client/src/runtime/control-http/task-audit-redaction.test.ts
git commit -m "feat(client): add local task audit storage"
```

## Task 3: Wrap mutating client HTTP routes with audited execution and mirror reporting

**Files:**
- Create: `apps/client/src/runtime/control-http/task-audit-reporter.ts`
- Create: `apps/client/src/runtime/control-http/task-audit.ts`
- Create: `apps/client/src/runtime/control-http/task-audit-actions.ts`
- Modify: `apps/client/src/runtime/control-http/server.ts`
- Modify: `apps/client/src/runtime/control-http/job-routes.ts`
- Modify: `apps/client/src/runtime/control-http/file-routes.ts`
- Modify: `apps/client/src/runtime/control-http/frp-routes.ts`
- Test: `apps/client/src/runtime/control-http/task-audit-reporter.test.ts`
- Test: `apps/client/src/runtime/control-http/job-routes.test.ts`
- Test: `apps/client/src/runtime/control-http/file-routes.test.ts`
- Test: `apps/client/src/runtime/control-http/frp-routes.test.ts`

- [ ] **Step 1: Write failing tests for audit recording around mutating routes**

```ts
import { describe, expect, it, vi } from 'vitest';
import * as http from 'node:http';
import { registerJobRoutes } from './job-routes.js';
import { ControlHttpRouter } from './router.js';

describe('registerJobRoutes auditing', () => {
  it('records a success audit event for POST /jobs/command', async () => {
    const router = new ControlHttpRouter();
    const manager = { createCommand: vi.fn(() => ({ jobId: 'job_01', status: 'queued' })) } as any;
    const audit = { execute: vi.fn(async ({ run }) => run()) } as any;
    registerJobRoutes(router, manager, 'client-token', audit);

    const req = new http.IncomingMessage(null as any);
    req.method = 'POST';
    req.url = '/jobs/command';
    req.headers.authorization = 'Bearer client-token';

    expect(typeof audit.execute).toBe('function');
  });
});
```

```ts
import { describe, expect, it, vi } from 'vitest';
import { createTaskAuditReporter } from './task-audit-reporter.js';

describe('task audit reporter', () => {
  it('marks sync_failed when mirror upload fails', async () => {
    const store = { updateSync: vi.fn(async () => undefined) };
    const fetchImpl = vi.fn().mockResolvedValue(new Response('boom', { status: 500 }));
    const reporter = createTaskAuditReporter({
      apiBaseUrl: 'http://server',
      serverToken: 'agent-token',
      clientName: 'Client One',
      store: store as any,
      fetchImpl: fetchImpl as any,
    });

    await reporter.report({
      recordId: 'rec_01',
      clientId: 'client-1',
      requestId: 'req_01',
      resourceType: 'file',
      actionType: 'file.write',
      method: 'PUT',
      path: '/files/write',
      targetId: 'workspace:src/index.ts',
      sourceType: 'web-console',
      actorType: 'admin-token',
      actorLabel: 'web-console/admin-token',
      requestSummary: {},
      resultSummary: {},
      status: 'success',
      httpStatus: 200,
      startedAt: 1,
      finishedAt: 2,
      durationMs: 1,
      syncStatus: 'pending',
      reportedAt: 2,
    });

    expect(store.updateSync).toHaveBeenCalledWith('rec_01', expect.objectContaining({ syncStatus: 'sync_failed' }));
  });
});
```

- [ ] **Step 2: Run the client route tests to verify they fail**

Run: `pnpm --filter @rag/client test -- task-audit-reporter.test.ts job-routes.test.ts file-routes.test.ts frp-routes.test.ts`
Expected: FAIL because audited execution dependencies are not wired into route modules.

- [ ] **Step 3: Implement reporter and audited route execution**

```ts
// apps/client/src/runtime/control-http/task-audit-reporter.ts
import type { ClientTaskAuditLocalRecord } from '@rag/shared';
import type { TaskAuditStore } from './task-audit-store.js';

export function createTaskAuditReporter(options: {
  apiBaseUrl?: string;
  serverToken?: string;
  clientName: string;
  store: TaskAuditStore;
  fetchImpl?: typeof fetch;
}) {
  const fetcher = options.fetchImpl ?? fetch;

  return {
    async report(record: ClientTaskAuditLocalRecord): Promise<void> {
      if (!options.apiBaseUrl || !options.serverToken) return;
      try {
        const response = await fetcher(`${options.apiBaseUrl}/api/client-audit/records`, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${options.serverToken}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ ...record, clientNameSnapshot: options.clientName }),
        });
        if (!response.ok) throw new Error(`Mirror upload failed: ${response.status}`);
        await options.store.updateSync(record.recordId, { syncStatus: 'synced', syncedAt: Date.now(), syncError: null });
      } catch (error) {
        await options.store.updateSync(record.recordId, {
          syncStatus: 'sync_failed',
          syncedAt: null,
          syncError: error instanceof Error ? error.message : String(error),
        });
      }
    },
  };
}
```

```ts
// apps/client/src/runtime/control-http/task-audit.ts
import { randomUUID } from 'node:crypto';
import type { IncomingMessage } from 'node:http';
import type { ClientTaskAuditLocalRecord, TaskActionType, TaskStatus } from '@rag/shared';
import { resolveTaskAuditRequestContext } from './request-context.js';
import { summarizeTaskAudit } from './task-audit-redaction.js';
import type { TaskAuditStore } from './task-audit-store.js';

export interface TaskAuditExecutor {
  execute<T>(input: {
    req: IncomingMessage;
    clientId: string;
    actionType: TaskActionType;
    resourceType: 'job' | 'file' | 'frp_mapping';
    method: string;
    path: string;
    payload?: Record<string, unknown>;
    run: () => Promise<{ httpStatus: number; resultSummary?: Record<string, unknown>; targetId?: string; status?: TaskStatus; body?: T }>;
  }): Promise<T>;
}

export function createTaskAuditExecutor(options: {
  clientId: string;
  store: TaskAuditStore;
  reporter: { report(record: ClientTaskAuditLocalRecord): Promise<void> };
}) : TaskAuditExecutor {
  return {
    async execute<T>(input) {
      const context = resolveTaskAuditRequestContext(input.req);
      const startedAt = Date.now();
      let record: ClientTaskAuditLocalRecord | null = null;
      try {
        const result = await input.run();
        const summary = summarizeTaskAudit({
          actionType: input.actionType,
          method: input.method,
          path: input.path,
          payload: input.payload,
          result: result.resultSummary,
        });
        record = {
          recordId: `rec_${randomUUID().slice(0, 12)}`,
          clientId: options.clientId,
          requestId: context.requestId,
          resourceType: input.resourceType,
          actionType: input.actionType,
          method: input.method,
          path: input.path,
          targetId: result.targetId ?? summary.targetId,
          sourceType: context.sourceType,
          actorType: context.actorType,
          actorLabel: context.actorLabel,
          querySummary: {},
          requestSummary: summary.requestSummary,
          resultSummary: result.resultSummary ?? summary.resultSummary,
          status: result.status ?? 'success',
          httpStatus: result.httpStatus,
          startedAt,
          finishedAt: Date.now(),
          durationMs: Date.now() - startedAt,
          reportedAt: Date.now(),
          syncStatus: 'pending',
        };
        await options.store.append(record);
        void options.reporter.report(record);
        return result.body as T;
      } catch (error) {
        const finishedAt = Date.now();
        const summary = summarizeTaskAudit({
          actionType: input.actionType,
          method: input.method,
          path: input.path,
          payload: input.payload,
          result: {},
        });
        record = {
          recordId: `rec_${randomUUID().slice(0, 12)}`,
          clientId: options.clientId,
          requestId: context.requestId,
          resourceType: input.resourceType,
          actionType: input.actionType,
          method: input.method,
          path: input.path,
          targetId: summary.targetId,
          sourceType: context.sourceType,
          actorType: context.actorType,
          actorLabel: context.actorLabel,
          querySummary: {},
          requestSummary: summary.requestSummary,
          resultSummary: {},
          status: 'failed',
          httpStatus: 500,
          startedAt,
          finishedAt,
          durationMs: finishedAt - startedAt,
          errorMessage: error instanceof Error ? error.message : String(error),
          reportedAt: finishedAt,
          syncStatus: 'pending',
        };
        await options.store.append(record);
        void options.reporter.report(record);
        throw error;
      }
    },
  };
}
```

```ts
// apps/client/src/runtime/control-http/server.ts
  const store = createTaskAuditStore(options.taskAuditStorePath);
  const reporter = createTaskAuditReporter({
    apiBaseUrl: options.apiBaseUrl,
    serverToken: options.serverToken,
    clientName: options.clientId,
    store,
  });
  const audit = createTaskAuditExecutor({ clientId: options.clientId, store, reporter });

  registerJobRoutes(router, jobManager, options.token, audit, { clientId: options.clientId });
  registerFileRoutes(router, { token: options.token, workspaceDir: options.workspaceDir, allowedRoots: options.allowedRoots, clientId: options.clientId }, audit);
  registerFrpRoutes(router, {
    token: options.token,
    clientId: options.clientId,
    apiBaseUrl: options.apiBaseUrl,
    serverToken: options.serverToken,
    frpcPath: options.frpcPath,
    frpcWorkDir: options.frpcWorkDir,
    workspaceDir: options.workspaceDir,
  }, audit);
```

```ts
// apps/client/src/runtime/control-http/job-routes.ts
export function registerJobRoutes(router: ControlHttpRouter, manager: JobManager, token: string, audit: TaskAuditExecutor, options: { clientId: string }): void {
  router.add('POST', /^\/jobs\/command$/, async (req, res) => {
    if (!requireBearerToken(req, res, token)) return;
    try {
      const payload = ClientJobCommandPayloadSchema.parse(await readJson(req));
      const body = await audit.execute({
        req,
        clientId: options.clientId,
        actionType: 'job.command',
        resourceType: 'job',
        method: 'POST',
        path: '/jobs/command',
        payload,
        run: async () => {
          const job = manager.createCommand(payload);
          return {
            httpStatus: 200,
            resultSummary: { jobId: job.jobId, status: job.status },
            targetId: job.jobId,
            status: 'success',
            body: { jobId: job.jobId, status: job.status },
          };
        },
      });
      sendOk(res, body);
    } catch (err) {
      sendError(res, 400, 'INVALID_REQUEST', err instanceof Error ? err.message : String(err));
    }
  });
}
```

```ts
// apps/client/src/runtime/control-http/file-routes.ts
const responseBody = await audit.execute({
  req,
  clientId: options.clientId,
  actionType: 'file.write',
  resourceType: 'file',
  method: 'PUT',
  path: '/files/write',
  payload: { rootId, path: clientPath, size: body.length },
  run: async () => {
    fs.writeFileSync(fullPath, body);
    return {
      httpStatus: 200,
      resultSummary: { size: body.length },
      targetId: `${rootId}:${clientPath}`,
      status: 'success',
      body: { rootId, path: clientPath, size: body.length },
    };
  },
});
sendOk(res, responseBody);
```

```ts
// apps/client/src/runtime/control-http/frp-routes.ts
const responseBody = await audit.execute({
  req,
  clientId: options.clientId,
  actionType: 'frp_mapping.create',
  resourceType: 'frp_mapping',
  method: 'POST',
  path: '/frp/mappings',
  payload,
  run: async () => {
    const allocated = await allocateMapping(options, payload);
    const mapping = buildBusinessMapping(payload, allocated);
    addMapping(workDir, mapping);
    rebuildIfConfigured(options);
    return {
      httpStatus: 200,
      resultSummary: { id: mapping.id, name: mapping.name, remotePort: mapping.remotePort ?? null },
      targetId: mapping.id,
      status: 'success',
      body: mapping,
    };
  },
});
sendOk(res, responseBody);
```

- [ ] **Step 4: Run the client route tests to verify they pass**

Run: `pnpm --filter @rag/client test -- task-audit-reporter.test.ts job-routes.test.ts file-routes.test.ts frp-routes.test.ts`
Expected: PASS with audited mutating route coverage green.

- [ ] **Step 5: Commit audited route execution**

```bash
git add apps/client/src/runtime/control-http/task-audit-reporter.ts apps/client/src/runtime/control-http/task-audit.ts apps/client/src/runtime/control-http/server.ts apps/client/src/runtime/control-http/job-routes.ts apps/client/src/runtime/control-http/file-routes.ts apps/client/src/runtime/control-http/frp-routes.ts apps/client/src/runtime/control-http/task-audit-reporter.test.ts apps/client/src/runtime/control-http/job-routes.test.ts apps/client/src/runtime/control-http/file-routes.test.ts apps/client/src/runtime/control-http/frp-routes.test.ts
git commit -m "feat(client): audit mutating control HTTP routes"
```

## Task 4: Add server-side mirrored task-history storage and APIs

**Files:**
- Create: `apps/server/src/modules/tasks/tasks.schemas.ts`
- Create: `apps/server/src/modules/tasks/tasks.service.ts`
- Create: `apps/server/src/modules/tasks/tasks.routes.ts`
- Modify: `apps/server/src/db/migrate.ts`
- Modify: `apps/server/src/main.ts`
- Test: `apps/server/src/modules/tasks/tasks.service.test.ts`
- Test: `apps/server/src/modules/tasks/tasks.routes.test.ts`

- [ ] **Step 1: Write failing tests for mirror ingest, idempotency, and query filters**

```ts
import { beforeEach, describe, expect, it } from 'vitest';
import { initDb, getDb } from '../../db/index.js';
import { tasksService } from './tasks.service.js';

beforeEach(async () => {
  await initDb();
  getDb().run('DELETE FROM task_history');
});

describe('tasksService', () => {
  it('stores mirrored records idempotently', async () => {
    const record = {
      recordId: 'rec_01',
      clientId: 'client-1',
      requestId: 'req_01',
      resourceType: 'file',
      actionType: 'file.write',
      method: 'PUT',
      path: '/files/write',
      targetId: 'workspace:src/index.ts',
      sourceType: 'web-console',
      actorType: 'admin-token',
      actorLabel: 'web-console/admin-token',
      requestSummary: { path: 'src/index.ts' },
      resultSummary: { size: 12 },
      status: 'success',
      httpStatus: 200,
      startedAt: 1,
      finishedAt: 2,
      durationMs: 1,
      reportedAt: 2,
    };

    await tasksService.upsertMirrorRecord(record as any);
    await tasksService.upsertMirrorRecord(record as any);

    const page = tasksService.list({ page: 1, pageSize: 20 });
    expect(page.total).toBe(1);
    expect(page.items[0].recordId).toBe('rec_01');
  });
});
```

```ts
import { describe, expect, it, vi } from 'vitest';
import Fastify from 'fastify';
import { taskRoutes } from './tasks.routes.js';

vi.mock('../auth/auth.middleware.js', () => ({
  authMiddleware: async (request: unknown) => {
    (request as { authRole?: string }).authRole = 'agent';
  },
}));

vi.mock('./tasks.service.js', () => ({
  tasksService: {
    upsertMirrorRecord: vi.fn(async () => ({ inserted: true })),
    list: vi.fn(() => ({ items: [], total: 0, page: 1, pageSize: 20 })),
    getByRecordId: vi.fn(() => null),
  },
}));

describe('taskRoutes', () => {
  it('accepts mirrored records', async () => {
    const app = Fastify();
    await app.register(taskRoutes);

    const response = await app.inject({
      method: 'POST',
      url: '/api/client-audit/records',
      headers: { authorization: 'Bearer test-agent-token' },
      payload: {
        recordId: 'rec_01',
        clientId: 'client-1',
        requestId: 'req_01',
        resourceType: 'file',
        actionType: 'file.write',
        method: 'PUT',
        path: '/files/write',
        targetId: 'workspace:src/index.ts',
        sourceType: 'web-console',
        actorType: 'admin-token',
        actorLabel: 'web-console/admin-token',
        requestSummary: {},
        resultSummary: {},
        status: 'success',
        httpStatus: 200,
        startedAt: 1,
        finishedAt: 2,
        durationMs: 1,
        reportedAt: 2,
      },
    });

    expect(response.statusCode).toBe(200);
  });
});
```

- [ ] **Step 2: Run the server tests to verify they fail**

Run: `pnpm --filter @rag/server test -- tasks.service.test.ts tasks.routes.test.ts`
Expected: FAIL because task-history table, service, and routes do not exist.

- [ ] **Step 3: Implement task-history migration, service, and routes**

```ts
// apps/server/src/db/migrate.ts
    CREATE TABLE IF NOT EXISTS task_history (
      record_id TEXT PRIMARY KEY,
      client_id TEXT NOT NULL,
      client_name_snapshot TEXT,
      request_id TEXT NOT NULL,
      job_id TEXT,
      resource_type TEXT NOT NULL,
      action_type TEXT NOT NULL,
      method TEXT NOT NULL,
      path TEXT NOT NULL,
      target_id TEXT NOT NULL,
      source_type TEXT NOT NULL,
      actor_type TEXT NOT NULL,
      actor_label TEXT NOT NULL,
      query_summary TEXT,
      request_summary TEXT NOT NULL,
      result_summary TEXT NOT NULL,
      status TEXT NOT NULL,
      http_status INTEGER NOT NULL,
      started_at INTEGER NOT NULL,
      finished_at INTEGER NOT NULL,
      duration_ms INTEGER NOT NULL,
      error_code TEXT,
      error_message TEXT,
      reported_at INTEGER NOT NULL,
      received_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_task_history_client_id ON task_history(client_id);
    CREATE INDEX IF NOT EXISTS idx_task_history_finished_at ON task_history(finished_at DESC);
    CREATE INDEX IF NOT EXISTS idx_task_history_status ON task_history(status);
```

```ts
// apps/server/src/modules/tasks/tasks.service.ts
import { getDb } from '../../db/index.js';
import type { ClientTaskAuditMirrorRecord, TaskHistoryQuery } from '@rag/shared';

class TasksService {
  async upsertMirrorRecord(record: ClientTaskAuditMirrorRecord): Promise<{ inserted: boolean }> {
    const db = getDb();
    const existsStmt = db.prepare('SELECT record_id FROM task_history WHERE record_id = ? LIMIT 1');
    existsStmt.bind([record.recordId]);
    const exists = existsStmt.step();
    existsStmt.free();
    if (exists) return { inserted: false };
    db.run(
      `INSERT INTO task_history (
        record_id, client_id, client_name_snapshot, request_id, job_id, resource_type, action_type, method, path, target_id,
        source_type, actor_type, actor_label, query_summary, request_summary, result_summary, status, http_status,
        started_at, finished_at, duration_ms, error_code, error_message, reported_at, received_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        record.recordId,
        record.clientId,
        record.clientNameSnapshot ?? null,
        record.requestId,
        record.jobId ?? null,
        record.resourceType,
        record.actionType,
        record.method,
        record.path,
        record.targetId,
        record.sourceType,
        record.actorType,
        record.actorLabel,
        JSON.stringify(record.querySummary ?? {}),
        JSON.stringify(record.requestSummary),
        JSON.stringify(record.resultSummary),
        record.status,
        record.httpStatus,
        record.startedAt,
        record.finishedAt,
        record.durationMs,
        record.errorCode ?? null,
        record.errorMessage ?? null,
        record.reportedAt,
        Date.now(),
      ],
    );
    return { inserted: true };
  }

  list(query: TaskHistoryQuery) {
    const db = getDb();
    const where: string[] = [];
    const params: unknown[] = [];
    if (query.clientId) { where.push('client_id = ?'); params.push(query.clientId); }
    if (query.status) { where.push('status = ?'); params.push(query.status); }
    if (query.resourceType) { where.push('resource_type = ?'); params.push(query.resourceType); }
    if (query.actionType) { where.push('action_type = ?'); params.push(query.actionType); }
    if (query.sourceType) { where.push('source_type = ?'); params.push(query.sourceType); }
    if (query.keyword) {
      where.push('(client_name_snapshot LIKE ? OR target_id LIKE ? OR action_type LIKE ? OR COALESCE(error_message, "") LIKE ?)');
      params.push(`%${query.keyword}%`, `%${query.keyword}%`, `%${query.keyword}%`, `%${query.keyword}%`);
    }
    if (query.from) { where.push('finished_at >= ?'); params.push(query.from); }
    if (query.to) { where.push('finished_at <= ?'); params.push(query.to); }
    const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
    const offset = (query.page - 1) * query.pageSize;

    const totalStmt = db.prepare(`SELECT COUNT(*) AS total FROM task_history ${whereSql}`);
    totalStmt.bind(params as any);
    totalStmt.step();
    const total = Number(totalStmt.getAsObject().total ?? 0);
    totalStmt.free();

    const stmt = db.prepare(`SELECT * FROM task_history ${whereSql} ORDER BY finished_at DESC LIMIT ? OFFSET ?`);
    stmt.bind([...(params as any), query.pageSize, offset]);
    const items: Record<string, unknown>[] = [];
    while (stmt.step()) items.push(stmt.getAsObject());
    stmt.free();
    return { items, total, page: query.page, pageSize: query.pageSize };
  }

  getByRecordId(recordId: string) {
    const db = getDb();
    const stmt = db.prepare('SELECT * FROM task_history WHERE record_id = ? LIMIT 1');
    stmt.bind([recordId]);
    const row = stmt.step() ? stmt.getAsObject() : null;
    stmt.free();
    return row;
  }
}

export const tasksService = new TasksService();
```

```ts
// apps/server/src/modules/tasks/tasks.routes.ts
import type { FastifyInstance } from 'fastify';
import { ClientTaskAuditMirrorRecordSchema } from '@rag/shared';
import { authMiddleware } from '../auth/auth.middleware.js';
import { tasksService } from './tasks.service.js';
import { parseTaskHistoryQuery } from './tasks.schemas.js';

export async function taskRoutes(app: FastifyInstance): Promise<void> {
  app.addHook('preHandler', authMiddleware);

  app.post('/api/client-audit/records', async (request, reply) => {
    const payload = ClientTaskAuditMirrorRecordSchema.parse(request.body);
    const result = await tasksService.upsertMirrorRecord(payload);
    return reply.send({ ok: true, inserted: result.inserted });
  });

  app.get('/api/tasks', async (request, reply) => {
    const query = parseTaskHistoryQuery(request.query);
    return reply.send(tasksService.list(query));
  });

  app.get<{ Params: { recordId: string } }>('/api/tasks/:recordId', async (request, reply) => {
    const row = tasksService.getByRecordId(request.params.recordId);
    if (!row) return reply.code(404).send({ error: 'Task record not found' });
    return reply.send(row);
  });
}
```

```ts
// apps/server/src/main.ts
import { taskRoutes } from './modules/tasks/tasks.routes.js';

await app.register(taskRoutes);
```

- [ ] **Step 4: Run the server tests to verify they pass**

Run: `pnpm --filter @rag/server test -- tasks.service.test.ts tasks.routes.test.ts`
Expected: PASS with mirror ingest, list filters, and detail APIs green.

- [ ] **Step 5: Commit server mirrored task-history support**

```bash
git add apps/server/src/db/migrate.ts apps/server/src/modules/tasks/tasks.schemas.ts apps/server/src/modules/tasks/tasks.service.ts apps/server/src/modules/tasks/tasks.routes.ts apps/server/src/main.ts apps/server/src/modules/tasks/tasks.service.test.ts apps/server/src/modules/tasks/tasks.routes.test.ts
git commit -m "feat(server): add task history mirror APIs"
```

## Task 5: Propagate trusted caller context for server-mediated client HTTP actions

**Files:**
- Modify: `apps/server/src/modules/client-http/client-http-admin.service.ts`
- Test: `apps/server/src/modules/client-http/client-http-admin.service.test.ts`

- [ ] **Step 1: Write the failing test for trusted audit headers**

```ts
import { describe, expect, it, vi } from 'vitest';
import { ClientHttpAdminService } from './client-http-admin.service.js';

vi.mock('../clients/clients.service.js', () => ({
  clientsService: {
    getClient: vi.fn(() => ({ http_base_url: 'http://client', http_token: 'client-token' })),
  },
}));

describe('ClientHttpAdminService', () => {
  it('sends trusted source and actor headers to client HTTP', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ ok: true }), { status: 200 }));
    const service = new ClientHttpAdminService(fetchMock as any);

    await service.request('client-1', {
      method: 'POST',
      path: '/frp/mappings',
      body: { name: 'vite', type: 'tcp', localPort: 5173 },
      auditContext: { sourceType: 'web-console', actorType: 'admin-token' },
    });

    expect(fetchMock).toHaveBeenCalledWith('http://client/frp/mappings', expect.objectContaining({
      headers: expect.objectContaining({
        'x-rag-source': 'web-console',
        'x-rag-actor-type': 'admin-token',
      }),
    }));
  });
});
```

- [ ] **Step 2: Run the admin client HTTP service test to verify it fails**

Run: `pnpm --filter @rag/server test -- client-http-admin.service.test.ts`
Expected: FAIL because auditContext and trusted headers are not implemented.

- [ ] **Step 3: Implement trusted audit-context propagation**

```ts
// apps/server/src/modules/client-http/client-http-admin.service.ts
export class ClientHttpAdminService {
  constructor(private readonly fetchImpl: typeof fetch = fetch) {}

  async request(clientId: string, input: {
    method: string;
    path: string;
    body?: unknown;
    auditContext?: { sourceType: 'web-console' | 'agent-api' | 'server-proxy'; actorType: 'admin-token' | 'agent-token' };
  }): Promise<{ status: number; body: unknown }> {
    const client = clientsService.getClient(clientId);
    if (!client?.http_base_url || !client.http_token) {
      return { status: 409, body: { ok: false, error: { code: 'CLIENT_HTTP_UNAVAILABLE', message: 'Client HTTP endpoint is not ready' } } };
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), env.CLIENT_HTTP_REQUEST_TIMEOUT_MS);
    try {
      const response = await this.fetchImpl(`${client.http_base_url}${input.path}`, {
        method: input.method,
        headers: {
          Authorization: `Bearer ${client.http_token}`,
          ...(input.body ? { 'Content-Type': 'application/json' } : {}),
          ...(input.auditContext ? {
            'x-rag-source': input.auditContext.sourceType,
            'x-rag-actor-type': input.auditContext.actorType,
          } : {}),
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
```

```ts
// call sites in admin routes
const auditContext = {
  sourceType: 'web-console' as const,
  actorType: ((request as unknown as { authRole: string }).authRole === 'admin' ? 'admin-token' : 'agent-token') as const,
};
const result = await clientHttpAdminService.request(request.params.clientId, {
  method: 'POST',
  path: '/frp/mappings',
  body: request.body,
  auditContext,
});
```

- [ ] **Step 4: Run the admin client HTTP service test to verify it passes**

Run: `pnpm --filter @rag/server test -- client-http-admin.service.test.ts`
Expected: PASS with trusted audit headers included in server-mediated client requests.

- [ ] **Step 5: Commit trusted caller-context propagation**

```bash
git add apps/server/src/modules/client-http/client-http-admin.service.ts apps/server/src/modules/client-http/client-http-admin.routes.ts apps/server/src/modules/client-http/client-http-admin.service.test.ts
git commit -m "feat(server): propagate task audit caller context"
```

## Task 6: Add web task-history API helper, navigation, page, and drawer

**Files:**
- Create: `apps/web/src/api/tasks.ts`
- Create: `apps/web/src/api/__tests__/tasks.test.ts`
- Create: `apps/web/src/pages/TasksPage.tsx`
- Create: `apps/web/src/pages/TasksPage.test.tsx`
- Modify: `apps/web/package.json`
- Modify: `apps/web/src/components/AppLayout.tsx`
- Modify: `apps/web/src/App.tsx`
- Modify: `apps/web/src/pages/ClientsPage.tsx`
- Modify: `apps/web/src/components/StatusTag.tsx`

- [ ] **Step 1: Write failing tests for task API helper and TasksPage rendering**

```ts
import { describe, expect, it, vi } from 'vitest';
import { listTasks, getTaskDetail } from '../tasks.js';

describe('task API helpers', () => {
  it('builds task list query strings', async () => {
    const api = {
      get: vi.fn(async () => ({ items: [], total: 0, page: 1, pageSize: 20 })),
    } as any;

    await listTasks(api, { clientId: 'client-1', status: 'failed', page: 2, pageSize: 20 });

    expect(api.get).toHaveBeenCalledWith('/api/tasks?clientId=client-1&status=failed&page=2&pageSize=20');
  });

  it('loads a task detail record', async () => {
    const api = { get: vi.fn(async () => ({ recordId: 'rec_01' })) } as any;
    const result = await getTaskDetail(api, 'rec_01');
    expect(result.recordId).toBe('rec_01');
  });
});
```

```tsx
import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { TasksPage } from './TasksPage.js';

describe('TasksPage', () => {
  it('renders rows and opens a detail drawer', async () => {
    const api = { get: vi.fn()
      .mockResolvedValueOnce({ items: [{
        recordId: 'rec_01',
        clientId: 'client-1',
        clientNameSnapshot: 'Client One',
        requestId: 'req_01',
        resourceType: 'file',
        actionType: 'file.write',
        targetId: 'workspace:src/index.ts',
        actorLabel: 'web-console/admin-token',
        status: 'success',
        durationMs: 12,
        resultSummary: { size: 1 },
        finishedAt: Date.now(),
      }], total: 1, page: 1, pageSize: 20 })
      .mockResolvedValueOnce({ recordId: 'rec_01', requestSummary: { path: 'src/index.ts' }, resultSummary: { size: 1 } }) } as any;

    render(<TasksPage api={api} />);

    expect(await screen.findByText('file.write')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: '查看详情' }));
    expect(await screen.findByText('src/index.ts')).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run the web tests to verify they fail**

Run: `pnpm --filter @rag/web test -- tasks.test.ts TasksPage.test.tsx`
Expected: FAIL because the task API helper and TasksPage do not exist.

- [ ] **Step 3: Implement task API helper, TasksPage, and navigation wiring**

```json
// apps/web/package.json
{
  "devDependencies": {
    "@testing-library/react": "^16.0.1",
    "@testing-library/user-event": "^14.5.2"
  }
}
```

```ts
// apps/web/src/api/tasks.ts
import type { Api } from './http';

export interface TaskListQuery {
  clientId?: string;
  status?: string;
  resourceType?: string;
  actionType?: string;
  sourceType?: string;
  keyword?: string;
  page?: number;
  pageSize?: number;
}

function toQueryString(query: TaskListQuery): string {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value !== undefined && value !== '') params.set(key, String(value));
  }
  const text = params.toString();
  return text ? `?${text}` : '';
}

export function listTasks(api: Api, query: TaskListQuery = {}) {
  return api.get(`/api/tasks${toQueryString(query)}`);
}

export function getTaskDetail(api: Api, recordId: string) {
  return api.get(`/api/tasks/${encodeURIComponent(recordId)}`);
}
```

```tsx
// apps/web/src/pages/TasksPage.tsx
import { useEffect, useMemo, useState } from 'react';
import { Button, Drawer, Input, Select, Space, Table, Typography } from 'antd';
import type { Api } from '../api/http';
import { getTaskDetail, listTasks } from '../api/tasks';
import { listClients } from '../api/clients';
import { StatusTag } from '../components/StatusTag';

const { Title, Text } = Typography;

export function TasksPage({ api, initialClientId, initialClientName }: {
  api: Api;
  initialClientId?: string;
  initialClientName?: string;
}) {
  const [filters, setFilters] = useState({ clientId: initialClientId ?? 'all', status: 'all', keyword: '' });
  const [clients, setClients] = useState<{ id: string; name: string }[]>([]);
  const [rows, setRows] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [detail, setDetail] = useState<any | null>(null);
  const [drawerOpen, setDrawerOpen] = useState(false);

  async function load() {
    setLoading(true);
    const query = {
      clientId: filters.clientId !== 'all' ? filters.clientId : undefined,
      status: filters.status !== 'all' ? filters.status : undefined,
      keyword: filters.keyword || undefined,
      page: 1,
      pageSize: 20,
    };
    const [clientList, taskPage] = await Promise.all([listClients(api), listTasks(api, query)]);
    setClients(clientList.map((client: any) => ({ id: client.id, name: client.name })));
    setRows(taskPage.items ?? []);
    setLoading(false);
  }

  useEffect(() => { load().catch(() => setLoading(false)); }, [filters.clientId, filters.status, filters.keyword]);

  const title = useMemo(() => (
    initialClientId ? `任务 — ${initialClientName ?? initialClientId}` : '任务'
  ), [initialClientId, initialClientName]);

  return (
    <div>
      <Title level={3} style={{ color: 'rgba(255,255,255,0.85)' }}>{title}</Title>
      <Space style={{ marginBottom: 12 }} wrap>
        <Select
          value={filters.clientId}
          style={{ minWidth: 220 }}
          options={[{ value: 'all', label: '全部客户端' }, ...clients.map((client) => ({ value: client.id, label: `${client.name} (${client.id})` }))]}
          onChange={(value) => setFilters((current) => ({ ...current, clientId: value }))}
        />
        <Select
          value={filters.status}
          style={{ width: 140 }}
          options={[{ value: 'all', label: '全部状态' }, { value: 'success', label: 'success' }, { value: 'failed', label: 'failed' }, { value: 'cancelled', label: 'cancelled' }]}
          onChange={(value) => setFilters((current) => ({ ...current, status: value }))}
        />
        <Input.Search
          allowClear
          placeholder="搜索 client / target / action / error"
          onSearch={(value) => setFilters((current) => ({ ...current, keyword: value }))}
          style={{ width: 280 }}
        />
        <Button onClick={() => load()}>刷新</Button>
      </Space>

      <Table
        rowKey="recordId"
        dataSource={rows}
        loading={loading}
        size="small"
        columns={[
          { title: '时间', key: 'time', width: 180, render: (_: unknown, row: any) => new Date(row.finishedAt ?? row.startedAt).toLocaleString() },
          { title: '客户端', key: 'client', width: 200, render: (_: unknown, row: any) => <Text code>{row.clientNameSnapshot ?? row.clientId}</Text> },
          { title: '来源', dataIndex: 'actorLabel', key: 'actorLabel', width: 200 },
          { title: '动作', dataIndex: 'actionType', key: 'actionType', width: 160 },
          { title: '目标', dataIndex: 'targetId', key: 'targetId' },
          { title: '状态', dataIndex: 'status', key: 'status', width: 120, render: (value: string) => <StatusTag status={value} /> },
          { title: '耗时', dataIndex: 'durationMs', key: 'durationMs', width: 100, render: (value: number) => value >= 1000 ? `${(value / 1000).toFixed(1)}s` : `${value}ms` },
          { title: '结果摘要', key: 'resultSummary', render: (_: unknown, row: any) => JSON.stringify(row.resultSummary ?? {}) },
          {
            title: '操作', key: 'actions', width: 120,
            render: (_: unknown, row: any) => (
              <Button
                size="small"
                onClick={async () => {
                  const value = await getTaskDetail(api, row.recordId);
                  setDetail(value);
                  setDrawerOpen(true);
                }}
              >
                查看详情
              </Button>
            ),
          },
        ]}
      />

      <Drawer title="任务详情" open={drawerOpen} width={720} onClose={() => setDrawerOpen(false)}>
        {detail ? (
          <Space direction="vertical" style={{ width: '100%' }} size={16}>
            <div>
              <Text strong>recordId</Text>
              <pre>{detail.recordId}</pre>
            </div>
            <div>
              <Text strong>requestSummary</Text>
              <pre>{JSON.stringify(detail.requestSummary ?? {}, null, 2)}</pre>
            </div>
            <div>
              <Text strong>resultSummary</Text>
              <pre>{JSON.stringify(detail.resultSummary ?? {}, null, 2)}</pre>
            </div>
            <div>
              <Text strong>error</Text>
              <pre>{detail.errorMessage ?? '-'}</pre>
            </div>
          </Space>
        ) : null}
      </Drawer>
    </div>
  );
}
```

```tsx
// apps/web/src/components/AppLayout.tsx
import { DashboardOutlined, CloudServerOutlined, LinkOutlined, OrderedListOutlined, LogoutOutlined } from '@ant-design/icons';

const menuItems = [
  { key: 'dashboard', icon: <DashboardOutlined />, label: '仪表盘' },
  { key: 'clients', icon: <CloudServerOutlined />, label: '客户端' },
  { key: 'tasks', icon: <OrderedListOutlined />, label: '任务' },
  { key: 'mappings', icon: <LinkOutlined />, label: '端口映射' },
];
```

```tsx
// apps/web/src/App.tsx
import { TasksPage } from './pages/TasksPage';

type Route =
  | { page: 'dashboard' }
  | { page: 'clients' }
  | { page: 'tasks'; clientId?: string; clientName?: string }
  | { page: 'client-detail'; clientId: string }
  | { page: 'client-files'; clientId: string; clientName: string }
  | { page: 'mappings'; clientId?: string; clientName?: string };

case 'tasks':
  navKey = 'tasks';
  content = <TasksPage api={api} initialClientId={route.clientId} initialClientName={route.clientName} />;
  break;

else if (key === 'tasks') setRoute({ page: 'tasks' });
```

```tsx
// apps/web/src/pages/ClientsPage.tsx
interface ClientsPageProps {
  api: Api;
  onViewDetail: (clientId: string) => void;
  onOpenFiles: (clientId: string) => void;
  onOpenMappings: (clientId: string) => void;
  onOpenTasks: (clientId: string, clientName: string) => void;
}

<Button size="small" onClick={() => onOpenTasks(record.id, record.name)}>任务</Button>
```

```tsx
// apps/web/src/components/StatusTag.tsx
const statusColor: Record<string, string> = {
  online: 'green',
  offline: 'red',
  success: 'green',
  failed: 'red',
  pending: 'gold',
  running: 'blue',
  dispatched: 'blue',
  active: 'green',
  inactive: 'default',
  error: 'red',
  cancelled: 'default',
  sync_failed: 'orange',
};
```

- [ ] **Step 4: Run the web tests to verify they pass**

Run: `pnpm --filter @rag/web test -- tasks.test.ts TasksPage.test.tsx`
Expected: PASS with task-history page, drawer, and navigation behavior green.

- [ ] **Step 5: Commit task-history web UI**

```bash
git add apps/web/package.json apps/web/src/api/tasks.ts apps/web/src/api/__tests__/tasks.test.ts apps/web/src/pages/TasksPage.tsx apps/web/src/pages/TasksPage.test.tsx apps/web/src/components/AppLayout.tsx apps/web/src/App.tsx apps/web/src/pages/ClientsPage.tsx apps/web/src/components/StatusTag.tsx
git commit -m "feat(web): add task history page"
```

## Task 7: Update docs and run end-to-end verification

**Files:**
- Modify: `README.md`
- Modify: `docs/TESTING.md`

- [ ] **Step 1: Write the failing documentation checklist in the plan workspace**

```md
- README lacks a `任务` / task-history capability description.
- docs/TESTING.md lacks commands for task-history tests.
- No verification step currently proves mirror ingest + list/detail APIs + web tests together.
```

- [ ] **Step 2: Update README and TESTING docs**

```md
<!-- README.md: add under architecture / capabilities -->
## Task Audit and History

Mutating client HTTP operations now produce structured task-audit records on the client and mirror redacted summaries to the server. The web console exposes a `任务` page for cross-client and single-client history views.

Audited operations include:

- job command / script creation and cancel
- file write / upload / mkdir / delete / move / copy
- FRP mapping create / delete

Sensitive payloads such as tokens, env values, file bodies, and raw script bodies are not stored in the server history mirror.
```

```md
<!-- docs/TESTING.md: add a new section -->
## Task audit and history verification

```bash
pnpm --filter @rag/shared test -- schemas.test.ts
pnpm --filter @rag/client test -- task-audit-store.test.ts task-audit-redaction.test.ts task-audit-reporter.test.ts job-routes.test.ts file-routes.test.ts frp-routes.test.ts
pnpm --filter @rag/server test -- tasks.service.test.ts tasks.routes.test.ts client-http-admin.service.test.ts
pnpm --filter @rag/web test -- tasks.test.ts TasksPage.test.tsx
pnpm typecheck
```

Expected:

- shared task-audit contracts validate successfully
- client mutating routes record local audit history and sync-state transitions
- server mirror ingest is idempotent and queryable
- web task page renders and opens task detail drawer
```
```

- [ ] **Step 3: Run the full verification suite**

Run: `pnpm --filter @rag/shared test -- schemas.test.ts && pnpm --filter @rag/client test -- task-audit-store.test.ts task-audit-redaction.test.ts task-audit-reporter.test.ts job-routes.test.ts file-routes.test.ts frp-routes.test.ts && pnpm --filter @rag/server test -- tasks.service.test.ts tasks.routes.test.ts client-http-admin.service.test.ts && pnpm --filter @rag/web test -- tasks.test.ts TasksPage.test.tsx && pnpm typecheck`
Expected: PASS across shared, client, server, web, and workspace typecheck.

- [ ] **Step 4: Commit docs and verification updates**

```bash
git add README.md docs/TESTING.md
git commit -m "docs: add task audit verification guide"
```

## Spec coverage self-check

- Client-local source-of-truth audit persistence: covered by Tasks 2 and 3.
- Asynchronous mirror upload to server: covered by Task 3.
- Idempotent server mirror table and list/detail APIs: covered by Task 4.
- Trusted source + actor classification for server-mediated calls: covered by Task 5.
- Web `任务` nav item, global history page, per-client entry, and drawer detail: covered by Task 6.
- Docs and verification commands: covered by Task 7.

## Placeholder scan self-check

- No `TODO`, `TBD`, or “implement later” placeholders remain in tasks.
- Every code-changing step includes concrete code blocks.
- Every validation step includes an exact command and expected outcome.

## Type consistency self-check

- Shared enums and schemas are defined first in Task 1 and reused in Tasks 2–6.
- Every in-scope mutating route has an explicit redaction mapping in `task-audit-actions.ts`, avoiding silent fallback behavior.
- Route-level action names align with the approved spec: `job.command`, `job.script`, `job.cancel`, `file.write`, `file.upload`, `file.mkdir`, `file.delete`, `file.move`, `file.copy`, `frp_mapping.create`, `frp_mapping.delete`.
- Query and detail APIs consistently use `recordId` as the stable identifier.
