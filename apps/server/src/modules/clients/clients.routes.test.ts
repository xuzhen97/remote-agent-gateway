import { describe, expect, it, vi } from 'vitest';
import Fastify from 'fastify';
import { clientRoutes } from './clients.routes.js';

vi.mock('../auth/auth.middleware.js', () => ({
  authMiddleware: async (request: unknown) => {
    (request as { authRole?: string }).authRole = 'agent';
  },
}));

vi.mock('./clients.service.js', () => ({
  clientsService: {
    listClients: vi.fn(() => []),
    getClient: vi.fn(() => ({ id: 'client-1', name: 'Client 1' })),
    toApi: vi.fn((value) => value),
    deleteClientCascade: vi.fn(),
  },
}));

vi.mock('../connections/connections.manager.js', () => ({
  connectionManager: {
    isOnline: vi.fn(() => true),
  },
}));

vi.mock('../audit/audit.service.js', () => ({
  auditService: { log: vi.fn() },
}));

describe('client routes', () => {
  it('does not register legacy frpc control routes', async () => {
    const app = Fastify();
    await app.register(clientRoutes);

    const startResponse = await app.inject({ method: 'POST', url: '/api/clients/client-1/frpc/start' });
    const stopResponse = await app.inject({ method: 'POST', url: '/api/clients/client-1/frpc/stop' });

    expect(startResponse.statusCode).toBe(404);
    expect(stopResponse.statusCode).toBe(404);
  });
});
