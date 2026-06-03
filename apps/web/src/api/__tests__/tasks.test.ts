import { describe, expect, it, vi } from 'vitest';
import { listTasks, getTaskDetail } from '../tasks.js';

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
});
