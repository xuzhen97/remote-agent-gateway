# Task History Delete and Bulk Delete Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add single-delete and checkbox-based bulk delete for task history records in the React task page, deleting the selected server-side task history rows together with their related detail/log access while preserving client-side local audit archives.

**Architecture:** Keep delete rules in the server `tasks` module, expose REST endpoints for single and bulk deletion, write a management audit log for deletion actions, and extend the React `TasksPage` with row selection, bulk actions, and delete affordances. Deletion only touches server-side `task_history`; client local `.rag/task-audit.jsonl` remains unchanged.

**Tech Stack:** TypeScript, Fastify, sql.js, React, Ant Design, Vitest.

---

## File Structure

### Existing files to modify
- `apps/server/src/modules/tasks/tasks.service.ts`
  - Add single/bulk delete methods for `task_history` rows.
- `apps/server/src/modules/tasks/tasks.routes.ts`
  - Add `DELETE /api/tasks/:recordId` and `POST /api/tasks/bulk-delete`.
- `apps/web/src/api/tasks.ts`
  - Add helpers for single and bulk delete requests.
- `apps/web/src/pages/TasksPage.tsx`
  - Add checkbox row selection, delete buttons, bulk delete action, and refresh/selection reset logic.
- `apps/web/src/pages/TasksPage.test.tsx`
  - Add UI tests for row selection and delete flows.
- `apps/server/src/modules/tasks/tasks.service.test.ts`
  - Add delete coverage for task history rows.
- `apps/server/src/modules/tasks/tasks.routes.test.ts`
  - Add route coverage for delete APIs and audit logging.

### Existing files to read during implementation
- `apps/server/src/modules/audit/audit.service.ts`
  - Reuse for deletion audit logs.
- `apps/web/src/api/http.ts`
  - Existing API client methods used by delete helpers.

### Verification commands
- `pnpm --filter @rag/server exec vitest run src/modules/tasks/tasks.service.test.ts`
- `pnpm --filter @rag/server exec vitest run src/modules/tasks/tasks.routes.test.ts`
- `pnpm --filter @rag/web exec vitest run src/pages/TasksPage.test.tsx src/api/__tests__/tasks.test.ts`
- `pnpm --filter @rag/server test`
- `pnpm --filter @rag/web test`
- `pnpm --filter @rag/server typecheck`
- `pnpm --filter @rag/web typecheck`

---

### Task 1: Add delete support to the server task-history service

**Files:**
- Modify: `apps/server/src/modules/tasks/tasks.service.ts`
- Modify: `apps/server/src/modules/tasks/tasks.service.test.ts`
- Test: `apps/server/src/modules/tasks/tasks.service.test.ts`

- [ ] **Step 1: Write the failing service tests**

Append these tests to `apps/server/src/modules/tasks/tasks.service.test.ts`:

```ts
  it('deletes a single task history record by recordId', async () => {
    await tasksService.upsertMirrorRecord({
      recordId: 'rec_delete_one',
      clientId: 'client-1',
      requestId: 'req_delete_one',
      resourceType: 'job',
      actionType: 'job.command' as const,
      method: 'POST',
      path: '/jobs/command',
      targetId: 'job_1',
      sourceType: 'agent-api' as const,
      actorType: 'agent-token' as const,
      actorLabel: 'agent-api/agent-token',
      requestSummary: { command: 'ipconfig' },
      resultSummary: { jobId: 'job_1', status: 'running' },
      status: 'success' as const,
      httpStatus: 200,
      startedAt: 1,
      finishedAt: 2,
      durationMs: 1,
      reportedAt: 2,
    } as any);

    const summary = tasksService.deleteByRecordId('rec_delete_one');

    expect(summary).toEqual({ deleted: true });
    expect(tasksService.getByRecordId('rec_delete_one')).toBeNull();
    expect(tasksService.list({ page: 1, pageSize: 20 }).total).toBe(0);
  });

  it('bulk deletes task history records by recordId and deduplicates ids', async () => {
    await tasksService.upsertMirrorRecord({
      recordId: 'rec_bulk_a', clientId: 'client-1', requestId: 'req_a',
      resourceType: 'job', actionType: 'job.command' as const,
      method: 'POST', path: '/jobs/command', targetId: 'job_a',
      sourceType: 'agent-api' as const, actorType: 'agent-token' as const,
      actorLabel: 'agent-api/agent-token', requestSummary: {}, resultSummary: {},
      status: 'success' as const, httpStatus: 200, startedAt: 1, finishedAt: 2, durationMs: 1, reportedAt: 2,
    } as any);
    await tasksService.upsertMirrorRecord({
      recordId: 'rec_bulk_b', clientId: 'client-1', requestId: 'req_b',
      resourceType: 'job', actionType: 'job.command' as const,
      method: 'POST', path: '/jobs/command', targetId: 'job_b',
      sourceType: 'agent-api' as const, actorType: 'agent-token' as const,
      actorLabel: 'agent-api/agent-token', requestSummary: {}, resultSummary: {},
      status: 'success' as const, httpStatus: 200, startedAt: 1, finishedAt: 2, durationMs: 1, reportedAt: 2,
    } as any);

    const summary = tasksService.deleteByRecordIds(['rec_bulk_a', 'rec_bulk_b', 'rec_bulk_a', 'rec_missing']);

    expect(summary).toEqual({ requested: 3, deleted: 2 });
    expect(tasksService.getByRecordId('rec_bulk_a')).toBeNull();
    expect(tasksService.getByRecordId('rec_bulk_b')).toBeNull();
  });
```

- [ ] **Step 2: Run the service test to verify it fails**

Run:
```bash
pnpm --filter @rag/server exec vitest run src/modules/tasks/tasks.service.test.ts
```

Expected: FAIL because `deleteByRecordId` and `deleteByRecordIds` do not exist yet.

- [ ] **Step 3: Implement minimal delete methods in `tasks.service.ts`**

Add these methods inside `class TasksService`:

```ts
  deleteByRecordId(recordId: string): { deleted: boolean } {
    const db = getDb();
    db.run('DELETE FROM task_history WHERE record_id = ?', [recordId]);
    return { deleted: db.getRowsModified() > 0 };
  }

  deleteByRecordIds(recordIds: string[]): { requested: number; deleted: number } {
    const ids = [...new Set(recordIds.map((id) => id.trim()).filter(Boolean))];
    if (!ids.length) return { requested: 0, deleted: 0 };

    const db = getDb();
    const placeholders = ids.map(() => '?').join(', ');
    db.run(`DELETE FROM task_history WHERE record_id IN (${placeholders})`, ids);
    return { requested: ids.length, deleted: db.getRowsModified() };
  }
```

- [ ] **Step 4: Run the service test to verify it passes**

Run:
```bash
pnpm --filter @rag/server exec vitest run src/modules/tasks/tasks.service.test.ts
```

Expected: PASS including the new single-delete and bulk-delete tests.

- [ ] **Step 5: Commit**

```bash
git add apps/server/src/modules/tasks/tasks.service.ts apps/server/src/modules/tasks/tasks.service.test.ts
git commit -m "feat(server): add task history delete service methods"
```

---

### Task 2: Add delete APIs and deletion audit logging

**Files:**
- Modify: `apps/server/src/modules/tasks/tasks.routes.ts`
- Modify: `apps/server/src/modules/tasks/tasks.routes.test.ts`
- Test: `apps/server/src/modules/tasks/tasks.routes.test.ts`

- [ ] **Step 1: Write failing route tests**

Append these tests to `apps/server/src/modules/tasks/tasks.routes.test.ts` and extend the mocked `tasksService` / `auditService` exports accordingly:

```ts
  it('deletes a single task history record and logs the action', async () => {
    vi.mocked(tasksService.deleteByRecordId).mockReturnValue({ deleted: true } as any);

    const response = await app.inject({
      method: 'DELETE',
      url: '/api/tasks/rec_delete_one',
      headers: { authorization: 'Bearer test-token' },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ deleted: true, recordId: 'rec_delete_one' });
    expect(tasksService.deleteByRecordId).toHaveBeenCalledWith('rec_delete_one');
    expect(auditService.log).toHaveBeenCalledWith(expect.objectContaining({
      action: 'task_history.delete',
      targetType: 'task_history',
      targetId: 'rec_delete_one',
    }));
  });

  it('bulk deletes task history records and logs the action', async () => {
    vi.mocked(tasksService.deleteByRecordIds).mockReturnValue({ requested: 2, deleted: 2 } as any);

    const response = await app.inject({
      method: 'POST',
      url: '/api/tasks/bulk-delete',
      headers: { authorization: 'Bearer test-token' },
      payload: { recordIds: ['rec_bulk_a', 'rec_bulk_b', 'rec_bulk_a'] },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ requested: 2, deleted: 2, recordIds: ['rec_bulk_a', 'rec_bulk_b'] });
    expect(tasksService.deleteByRecordIds).toHaveBeenCalledWith(['rec_bulk_a', 'rec_bulk_b']);
    expect(auditService.log).toHaveBeenCalledWith(expect.objectContaining({
      action: 'task_history.bulk_delete',
      targetType: 'task_history',
      targetId: 'bulk',
    }));
  });
```

Also extend the mock setup at the top of the file:

```ts
vi.mock('./tasks.service.js', () => ({
  tasksService: {
    upsertMirrorRecord: vi.fn(async () => ({ inserted: true })),
    list: vi.fn(() => ({ items: [], total: 0, page: 1, pageSize: 20 })),
    getByRecordId: vi.fn(() => null),
    deleteByRecordId: vi.fn(() => ({ deleted: false })),
    deleteByRecordIds: vi.fn(() => ({ requested: 0, deleted: 0 })),
  },
}));

vi.mock('../audit/audit.service.js', () => ({
  auditService: { log: vi.fn() },
}));
```

- [ ] **Step 2: Run the route tests to verify they fail**

Run:
```bash
pnpm --filter @rag/server exec vitest run src/modules/tasks/tasks.routes.test.ts
```

Expected: FAIL because the delete endpoints do not exist yet.

- [ ] **Step 3: Implement delete routes in `tasks.routes.ts`**

Add imports:

```ts
import { z } from 'zod';
import { auditService } from '../audit/audit.service.js';

const BulkDeleteTaskHistorySchema = z.object({
  recordIds: z.array(z.string().min(1)).min(1),
});
```

Then add the new routes after `GET /api/tasks/:recordId`:

```ts
  app.delete<{ Params: { recordId: string } }>('/api/tasks/:recordId', async (request, reply) => {
    const result = tasksService.deleteByRecordId(request.params.recordId);
    if (!result.deleted) return reply.code(404).send({ error: 'Task record not found' });

    auditService.log({
      actor: (request as unknown as { authRole: string }).authRole,
      action: 'task_history.delete',
      targetType: 'task_history',
      targetId: request.params.recordId,
      detail: `Deleted task history record ${request.params.recordId}`,
    });

    return reply.send({ deleted: true, recordId: request.params.recordId });
  });

  app.post('/api/tasks/bulk-delete', async (request, reply) => {
    const parsed = BulkDeleteTaskHistorySchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: 'Invalid payload', details: parsed.error.flatten() });

    const recordIds = [...new Set(parsed.data.recordIds.map((id) => id.trim()).filter(Boolean))];
    const result = tasksService.deleteByRecordIds(recordIds);

    auditService.log({
      actor: (request as unknown as { authRole: string }).authRole,
      action: 'task_history.bulk_delete',
      targetType: 'task_history',
      targetId: 'bulk',
      detail: `Deleted ${result.deleted}/${result.requested} task history records: ${recordIds.join(', ')}`,
    });

    return reply.send({ requested: result.requested, deleted: result.deleted, recordIds });
  });
```

- [ ] **Step 4: Run the route tests to verify they pass**

Run:
```bash
pnpm --filter @rag/server exec vitest run src/modules/tasks/tasks.routes.test.ts
```

Expected: PASS for existing and new route tests.

- [ ] **Step 5: Commit**

```bash
git add apps/server/src/modules/tasks/tasks.routes.ts apps/server/src/modules/tasks/tasks.routes.test.ts
git commit -m "feat(server): add task history delete APIs"
```

---

### Task 3: Add task delete API helpers on the web client

**Files:**
- Modify: `apps/web/src/api/tasks.ts`
- Modify: `apps/web/src/api/__tests__/tasks.test.ts`
- Test: `apps/web/src/api/__tests__/tasks.test.ts`

- [ ] **Step 1: Write failing API helper tests**

Append these tests to `apps/web/src/api/__tests__/tasks.test.ts`:

```ts
  it('deletes a single task record', async () => {
    const api = { delete: vi.fn(async () => ({ deleted: true, recordId: 'rec_01' })) } as any;
    const result = await deleteTaskRecord(api, 'rec_01');
    expect(result).toEqual({ deleted: true, recordId: 'rec_01' });
    expect(api.delete).toHaveBeenCalledWith('/api/tasks/rec_01');
  });

  it('bulk deletes task records', async () => {
    const api = { post: vi.fn(async () => ({ requested: 2, deleted: 2, recordIds: ['rec_01', 'rec_02'] })) } as any;
    const result = await bulkDeleteTaskRecords(api, ['rec_01', 'rec_02']);
    expect(result.deleted).toBe(2);
    expect(api.post).toHaveBeenCalledWith('/api/tasks/bulk-delete', { recordIds: ['rec_01', 'rec_02'] });
  });
```

Update imports at the top:

```ts
import { listTasks, getTaskDetail, summarizeTaskResult, deleteTaskRecord, bulkDeleteTaskRecords } from '../tasks.js';
```

- [ ] **Step 2: Run the API helper tests to verify they fail**

Run:
```bash
pnpm --filter @rag/web exec vitest run src/api/__tests__/tasks.test.ts
```

Expected: FAIL because the delete helper exports do not exist yet.

- [ ] **Step 3: Implement the helpers in `tasks.ts`**

Add:

```ts
export function deleteTaskRecord(api: Api, recordId: string) {
  return api.delete(`/api/tasks/${encodeURIComponent(recordId)}`);
}

export function bulkDeleteTaskRecords(api: Api, recordIds: string[]) {
  return api.post('/api/tasks/bulk-delete', { recordIds });
}
```

- [ ] **Step 4: Run the API helper tests to verify they pass**

Run:
```bash
pnpm --filter @rag/web exec vitest run src/api/__tests__/tasks.test.ts
```

Expected: PASS for all task API helper tests.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/api/tasks.ts apps/web/src/api/__tests__/tasks.test.ts
git commit -m "feat(web): add task delete api helpers"
```

---

### Task 4: Add checkbox selection and delete UI to the React task page

**Files:**
- Modify: `apps/web/src/pages/TasksPage.tsx`
- Modify: `apps/web/src/pages/TasksPage.test.tsx`
- Test: `apps/web/src/pages/TasksPage.test.tsx`

- [ ] **Step 1: Write failing UI tests**

Append a new test to `apps/web/src/pages/TasksPage.test.tsx`:

```ts
  it('supports row selection and bulk deletion of task records', async () => {
    const api = {
      get: vi.fn()
        .mockResolvedValueOnce([{ id: 'dev-client-01', name: 'Development Machine' }])
        .mockResolvedValueOnce({
          items: [
            { recordId: 'rec_a', clientId: 'dev-client-01', actorLabel: 'actor', actionType: 'job.command', targetId: 'job_a', status: 'success', durationMs: 10, resultSummary: { status: 'running' }, startedAt: 1, finishedAt: 2 },
            { recordId: 'rec_b', clientId: 'dev-client-01', actorLabel: 'actor', actionType: 'job.command', targetId: 'job_b', status: 'success', durationMs: 10, resultSummary: { status: 'running' }, startedAt: 1, finishedAt: 2 },
          ],
          total: 2,
          page: 1,
          pageSize: 20,
        })
        .mockResolvedValueOnce([{ id: 'dev-client-01', name: 'Development Machine' }])
        .mockResolvedValueOnce({ items: [], total: 0, page: 1, pageSize: 20 }),
      post: vi.fn(async () => ({ requested: 2, deleted: 2, recordIds: ['rec_a', 'rec_b'] })),
      delete: vi.fn(async () => ({ deleted: true, recordId: 'rec_a' })),
    } as any;

    vi.stubGlobal('confirm', vi.fn(() => true));
    render(<TasksPage api={api} />);

    expect(await screen.findByText('job_a')).toBeInTheDocument();
    const checkboxes = screen.getAllByRole('checkbox');
    fireEvent.click(checkboxes[1]);
    fireEvent.click(checkboxes[2]);
    fireEvent.click(screen.getByRole('button', { name: '删除选中' }));

    expect(api.post).toHaveBeenCalledWith('/api/tasks/bulk-delete', { recordIds: ['rec_a', 'rec_b'] });
  });
```

- [ ] **Step 2: Run the page tests to verify they fail**

Run:
```bash
pnpm --filter @rag/web exec vitest run src/pages/TasksPage.test.tsx
```

Expected: FAIL because there are no checkboxes or delete buttons yet.

- [ ] **Step 3: Implement selection and delete UI in `TasksPage.tsx`**

Make these concrete changes:

1. Extend imports:
```ts
import { Button, Drawer, Input, Select, Space, Table, Typography } from 'antd';
import { bulkDeleteTaskRecords, deleteTaskRecord, getTaskDetail, listTasks, summarizeTaskResult } from '../api/tasks';
```

2. Add state:
```ts
  const [selectedRowKeys, setSelectedRowKeys] = useState<React.Key[]>([]);
```

3. Reset selection after each successful reload:
```ts
    setRows(taskPage.items ?? []);
    setSelectedRowKeys((current) => current.filter((key) => (taskPage.items ?? []).some((row: any) => row.recordId === key)));
```

4. Add toolbar delete button next to 刷新:
```tsx
        <Button
          danger
          disabled={selectedRowKeys.length === 0}
          onClick={async () => {
            if (!confirm(`确定删除选中的 ${selectedRowKeys.length} 条任务记录吗？`)) return;
            await bulkDeleteTaskRecords(api, selectedRowKeys.map(String));
            setSelectedRowKeys([]);
            await load();
          }}
        >
          删除选中
        </Button>
```

5. Add `rowSelection` on the `Table`:
```tsx
        rowSelection={{
          selectedRowKeys,
          onChange: (keys) => setSelectedRowKeys(keys),
        }}
```

6. Expand the action column to include single delete:
```tsx
            render: (_: unknown, row: any) => (
              <Space>
                <Button
                  size="small"
                  onClick={async () => {
                    const value = await getTaskDetail(api, row.recordId);
                    setDetail(value);
                    setDetailLogs([]);
                    setDrawerOpen(true);
                  }}
                >
                  查看详情
                </Button>
                <Button
                  size="small"
                  danger
                  onClick={async () => {
                    if (!confirm(`确定删除任务记录 ${row.recordId} 吗？`)) return;
                    await deleteTaskRecord(api, row.recordId);
                    setSelectedRowKeys((current) => current.filter((key) => key !== row.recordId));
                    await load();
                  }}
                >
                  删除
                </Button>
              </Space>
            ),
```

- [ ] **Step 4: Run the page tests to verify they pass**

Run:
```bash
pnpm --filter @rag/web exec vitest run src/pages/TasksPage.test.tsx
```

Expected: PASS for existing detail/log tests and the new selection/delete test.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/pages/TasksPage.tsx apps/web/src/pages/TasksPage.test.tsx
git commit -m "feat(web): add task history row selection and delete actions"
```

---

### Task 5: Final verification and manual flow check

**Files:**
- Modify: none
- Test: verification only

- [ ] **Step 1: Run full targeted verification**

Run:
```bash
pnpm --filter @rag/server test
pnpm --filter @rag/web test
pnpm --filter @rag/server typecheck
pnpm --filter @rag/web typecheck
```

Expected: all commands succeed.

- [ ] **Step 2: Manual browser verification**

Run the app:
```bash
pnpm dev
```

In the browser verify:
1. Task table shows row checkboxes.
2. Selecting rows enables `删除选中`.
3. Single delete removes one row after confirmation.
4. Bulk delete removes multiple selected rows after confirmation.
5. Refresh shows deleted rows are gone.
6. Deletion only removes server-side task history records; existing client local `.rag/task-audit.jsonl` remains untouched.

- [ ] **Step 3: Final commit**

```bash
git add apps/server/src/modules/tasks/tasks.service.ts apps/server/src/modules/tasks/tasks.service.test.ts apps/server/src/modules/tasks/tasks.routes.ts apps/server/src/modules/tasks/tasks.routes.test.ts apps/web/src/api/tasks.ts apps/web/src/api/__tests__/tasks.test.ts apps/web/src/pages/TasksPage.tsx apps/web/src/pages/TasksPage.test.tsx
git commit -m "feat: add task history delete and bulk delete"
```
