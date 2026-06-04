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
    deleteByRecordId: vi.fn(() => ({ deleted: false })),
    deleteByRecordIds: vi.fn(() => ({ requested: 0, deleted: 0 })),
  },
}));

vi.mock('../audit/audit.service.js', () => ({
  auditService: { log: vi.fn() },
}));

describe('taskRoutes', () => {
  it('accepts mirrored records', async () => {
    const app = Fastify();
    await app.register(taskRoutes);

    const response = await app.inject({
      method: 'POST',
      url: '/api/client-audit/records',
      headers: { authorization: 'Bearer test-token' },
      payload: {
        recordId: 'rec_01', clientId: 'client-1', requestId: 'req_01',
        resourceType: 'file', actionType: 'file.write', method: 'PUT',
        path: '/files/write', targetId: 'workspace:src/index.ts',
        sourceType: 'web-console', actorType: 'admin-token',
        actorLabel: 'web-console/admin-token', requestSummary: {}, resultSummary: {},
        status: 'success', httpStatus: 200, startedAt: 1, finishedAt: 2,
        durationMs: 1, reportedAt: 2,
      },
    });
    expect(response.statusCode).toBe(200);
  });

  it('returns task list', async () => {
    const app = Fastify();
    await app.register(taskRoutes);
    const response = await app.inject({
      method: 'GET', url: '/api/tasks',
      headers: { authorization: 'Bearer test-token' },
    });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toHaveProperty('items');
  });

  it('deletes a single task history record and logs the action', async () => {
    const { tasksService } = await import('./tasks.service.js');
    vi.mocked(tasksService.deleteByRecordId).mockReturnValue({ deleted: true } as any);

    const app = Fastify();
    await app.register(taskRoutes);

    const response = await app.inject({
      method: 'DELETE',
      url: '/api/tasks/rec_delete_one',
      headers: { authorization: 'Bearer test-token' },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ deleted: true, recordId: 'rec_delete_one' });
    expect(tasksService.deleteByRecordId).toHaveBeenCalledWith('rec_delete_one');

    const { auditService } = await import('../audit/audit.service.js');
    expect(auditService.log).toHaveBeenCalledWith(expect.objectContaining({
      action: 'task_history.delete',
      targetType: 'task_history',
      targetId: 'rec_delete_one',
    }));
  });

  it('bulk deletes task history records and logs the action', async () => {
    const { tasksService } = await import('./tasks.service.js');
    vi.mocked(tasksService.deleteByRecordIds).mockReturnValue({ requested: 2, deleted: 2 } as any);

    const app = Fastify();
    await app.register(taskRoutes);

    const response = await app.inject({
      method: 'POST',
      url: '/api/tasks/bulk-delete',
      headers: { authorization: 'Bearer test-token' },
      payload: { recordIds: ['rec_bulk_a', 'rec_bulk_b', 'rec_bulk_a'] },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ requested: 2, deleted: 2, recordIds: ['rec_bulk_a', 'rec_bulk_b'] });
    expect(tasksService.deleteByRecordIds).toHaveBeenCalledWith(['rec_bulk_a', 'rec_bulk_b']);

    const { auditService } = await import('../audit/audit.service.js');
    expect(auditService.log).toHaveBeenCalledWith(expect.objectContaining({
      action: 'task_history.bulk_delete',
      targetType: 'task_history',
      targetId: 'bulk',
    }));
  });
});
