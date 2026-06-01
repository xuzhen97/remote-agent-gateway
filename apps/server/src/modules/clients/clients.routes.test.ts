import { describe, expect, it, vi } from 'vitest';
import Fastify from 'fastify';
import { clientRoutes } from './clients.routes.js';

vi.mock('../auth/auth.middleware.js', () => ({
  authMiddleware: async (request: unknown) => {
    (request as { authRole?: string }).authRole = 'agent';
  },
}));

const { createTaskMock, sendToClientMock, getFrpsInfoMock } = vi.hoisted(() => ({
  createTaskMock: vi.fn(() => ({ id: 'task_frpc_start' })),
  sendToClientMock: vi.fn(),
  getFrpsInfoMock: vi.fn(() => ({ serverAddr: 'frps.example.com', serverPort: 7000, authToken: 'frps-token' })),
}));

vi.mock('./clients.service.js', () => ({
  clientsService: {
    listClients: vi.fn(() => []),
    getClient: vi.fn(() => ({ id: 'client-1', name: 'Client 1' })),
    toApi: vi.fn((value) => value),
    deleteClientCascade: vi.fn(),
  },
}));

vi.mock('../tasks/tasks.service.js', () => ({
  tasksService: {
    createTask: createTaskMock,
  },
}));

vi.mock('../connections/connections.manager.js', () => ({
  connectionManager: {
    isOnline: vi.fn(() => true),
    sendToClient: sendToClientMock,
  },
}));

vi.mock('../audit/audit.service.js', () => ({
  auditService: { log: vi.fn() },
}));

vi.mock('../frp/frp.service.js', () => ({
  getFrpsConnectionInfo: getFrpsInfoMock,
}));

describe('client routes frpc control', () => {
  it('dispatches frpc_start with explicit frps connection info', async () => {
    const app = Fastify();
    await app.register(clientRoutes);

    const response = await app.inject({ method: 'POST', url: '/api/clients/client-1/frpc/start' });

    expect(response.statusCode).toBe(200);
    expect(createTaskMock).toHaveBeenCalledWith({
      clientId: 'client-1',
      type: 'frpc_start',
      payload: {
        serverAddr: 'frps.example.com',
        serverPort: 7000,
        authToken: 'frps-token',
      },
    });
    expect(sendToClientMock).toHaveBeenCalledWith('client-1', {
      type: 'task.dispatch',
      requestId: 'task_frpc_start',
      payload: {
        taskId: 'task_frpc_start',
        taskType: 'frpc_start',
        payload: {
          serverAddr: 'frps.example.com',
          serverPort: 7000,
          authToken: 'frps-token',
        },
      },
    });
  });
});
