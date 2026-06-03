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
});
