import { describe, expect, it, vi } from 'vitest';
import { listTasks, getTaskDetail, summarizeTaskResult, deleteTaskRecord, bulkDeleteTaskRecords } from '../tasks.js';

describe('task API helpers', () => {
  it('builds task list query strings with multiple params', async () => {
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

  it('omits undefined/empty query params', async () => {
    const api = { get: vi.fn(async () => ({ items: [], total: 0 })) } as any;
    await listTasks(api, { page: 1 });
    expect(api.get).toHaveBeenCalledWith('/api/tasks?page=1');
  });

  it('builds a readable task result summary from lifecycle and extracted fields', () => {
    expect(summarizeTaskResult({
      resultSummary: {
        lifecycle: { status: 'success', exitCode: 0, durationMs: 25 },
        extracted: { ipv4: ['192.168.0.12'] },
        output: { stdoutLineCount: 18 },
      },
      durationMs: 25,
    } as any)).toBe('success · exitCode 0 · IPv4 192.168.0.12 · stdout 18 行');
  });

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
});
