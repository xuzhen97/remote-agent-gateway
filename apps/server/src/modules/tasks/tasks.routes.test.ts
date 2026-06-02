import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import Fastify from 'fastify';
import { taskRoutes } from './tasks.routes.js';

vi.mock('../auth/auth.middleware.js', () => ({
  authMiddleware: async (request: unknown) => {
    (request as { authRole?: string }).authRole = 'agent';
  },
}));

const { deleteTaskByIdMock, deleteTasksByIdsMock, auditLogMock } = vi.hoisted(() => ({
  deleteTaskByIdMock: vi.fn(),
  deleteTasksByIdsMock: vi.fn(),
  auditLogMock: vi.fn(),
}));

vi.mock('./tasks.service.js', () => ({
  tasksService: {
    createTask: vi.fn(),
    updateTaskStatus: vi.fn(),
    listTasks: vi.fn(() => []),
    getTask: vi.fn(),
    getLogs: vi.fn(() => []),
    toApi: vi.fn((value) => value),
    deleteTaskById: deleteTaskByIdMock,
    deleteTasksByIds: deleteTasksByIdsMock,
  },
}));

vi.mock('../audit/audit.service.js', () => ({
  auditService: { log: auditLogMock },
}));

vi.mock('../connections/connections.manager.js', () => ({
  connectionManager: { sendToClient: vi.fn() },
}));

vi.mock('../clients/clients.service.js', () => ({
  clientsService: { getClient: vi.fn() },
}));

describe('task delete routes', () => {
  let app: ReturnType<typeof Fastify>;

  beforeEach(async () => {
    deleteTaskByIdMock.mockReset();
    deleteTasksByIdsMock.mockReset();
    auditLogMock.mockReset();
    app = Fastify();
    await app.register(taskRoutes);
  });

  afterEach(async () => {
    await app.close();
  });

  it('deletes a single task and writes an audit log', async () => {
    deleteTaskByIdMock.mockReturnValue({ deletedTask: true, deletedLogs: 2 });

    const response = await app.inject({ method: 'DELETE', url: '/api/tasks/task_1' });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ taskId: 'task_1', deletedTask: true, deletedLogs: 2 });
    expect(deleteTaskByIdMock).toHaveBeenCalledWith('task_1');
    expect(auditLogMock).toHaveBeenCalledWith({
      actor: 'agent',
      action: 'task.delete',
      targetType: 'task',
      targetId: 'task_1',
      detail: 'Deleted task task_1 with 2 logs',
    });
  });

  it('returns 404 when deleting a missing task', async () => {
    deleteTaskByIdMock.mockReturnValue({ deletedTask: false, deletedLogs: 0 });

    const response = await app.inject({ method: 'DELETE', url: '/api/tasks/task_missing' });

    expect(response.statusCode).toBe(404);
    expect(response.json()).toEqual({ error: 'Task not found' });
  });

  it('bulk deletes tasks, deduplicates ids, and writes an audit log', async () => {
    deleteTasksByIdsMock.mockReturnValue({ deletedTasks: 2, deletedLogs: 3 });

    const response = await app.inject({
      method: 'POST',
      url: '/api/tasks/bulk-delete',
      payload: { taskIds: ['task_a', 'task_b', 'task_a'] },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ requested: 2, deletedTasks: 2, deletedLogs: 3 });
    expect(deleteTasksByIdsMock).toHaveBeenCalledWith(['task_a', 'task_b']);
    expect(auditLogMock).toHaveBeenCalledWith({
      actor: 'agent',
      action: 'task.bulk_delete',
      targetType: 'task',
      targetId: 'bulk',
      detail: 'Deleted 2 tasks (requested: 2, logs: 3): task_a, task_b',
    });
  });

  it('rejects an empty bulk delete payload', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/tasks/bulk-delete',
      payload: { taskIds: [] },
    });

    expect(response.statusCode).toBe(400);
    expect(response.json()).toEqual({ error: 'Invalid payload', details: 'taskIds must be a non-empty array' });
    expect(deleteTasksByIdsMock).not.toHaveBeenCalled();
  });
});
