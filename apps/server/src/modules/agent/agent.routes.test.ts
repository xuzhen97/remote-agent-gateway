import { describe, expect, it, vi } from 'vitest';
import Fastify from 'fastify';
import { agentRoutes } from './agent.routes.js';

vi.mock('../auth/auth.middleware.js', () => ({
  authMiddleware: async (request: unknown) => {
    (request as { authRole?: string }).authRole = 'agent';
  },
}));

const { listClientsMock, getClientMock, toApiMock, startSessionMock, stopSessionMock, rootsMock, createTaskMock, sendToClientMock } = vi.hoisted(() => ({
  listClientsMock: vi.fn(() => [{ id: 'client-1', name: 'Test Box' }]),
  getClientMock: vi.fn((id: string) => id === 'client-1' ? { id: 'client-1', name: 'Test Box' } : undefined),
  toApiMock: vi.fn((c: unknown) => c),
  startSessionMock: vi.fn(),
  stopSessionMock: vi.fn(),
  rootsMock: vi.fn(),
  createTaskMock: vi.fn(() => ({ id: 'task_1' })),
  sendToClientMock: vi.fn(() => true),
}));

vi.mock('../clients/clients.service.js', () => ({
  clientsService: {
    listClients: listClientsMock,
    getClient: getClientMock,
    toApi: toApiMock,
  },
}));

vi.mock('../client-files/client-file-sessions.service.js', () => ({
  clientFileSessionsService: {
    startSession: startSessionMock,
    stopSession: stopSessionMock,
  },
}));

vi.mock('../client-files/client-file-proxy.service.js', () => ({
  clientFileProxyService: {
    roots: rootsMock,
  },
}));

vi.mock('../tasks/tasks.service.js', () => ({
  tasksService: {
    createTask: createTaskMock,
    getTask: vi.fn(),
    toApi: vi.fn((t: unknown) => t),
  },
}));

vi.mock('../connections/connections.manager.js', () => ({
  connectionManager: {
    isOnline: vi.fn(() => true),
    sendToClient: sendToClientMock,
  },
}));

vi.mock('../files/files.service.js', () => ({
  filesService: {
    getFile: vi.fn(),
  },
}));

vi.mock('../frp/frp.service.js', () => ({
  frpService: {
    createMapping: vi.fn(),
    toApi: vi.fn(),
    getMapping: vi.fn(),
    deleteMapping: vi.fn(),
  },
  getFrpsConnectionInfo: vi.fn(() => ({
    serverAddr: 'frps.example.com',
    serverPort: 7000,
    authToken: 'frps-token',
  })),
}));

vi.mock('../audit/audit.service.js', () => ({
  auditService: { log: vi.fn() },
}));

describe('agent routes', () => {
  // --- Clients ---

  it('lists clients via GET /api/agent/clients', async () => {
    const app = Fastify();
    await app.register(agentRoutes);
    const res = await app.inject({ method: 'GET', url: '/api/agent/clients' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual([{ id: 'client-1', name: 'Test Box' }]);
  });

  it('returns a single client via GET /api/agent/clients/:clientId', async () => {
    const app = Fastify();
    await app.register(agentRoutes);
    const res = await app.inject({ method: 'GET', url: '/api/agent/clients/client-1' });
    expect(res.statusCode).toBe(200);
  });

  it('returns 404 for unknown client via GET /api/agent/clients/:clientId', async () => {
    const app = Fastify();
    await app.register(agentRoutes);
    const res = await app.inject({ method: 'GET', url: '/api/agent/clients/nonexistent' });
    expect(res.statusCode).toBe(404);
    expect(res.json()).toEqual({ error: 'Client not found' });
  });

  // --- File Session ---

  it('creates file session via POST /api/agent/file-session', async () => {
    startSessionMock.mockResolvedValueOnce({
      clientId: 'client-1',
      publicUrl: 'http://frps.example.com:23001',
      token: 'file_abc123',
      localPort: 45123,
      mappingId: 'pm_file',
      startedAt: 1000,
      expiresAt: Date.now() + 1800000,
    });
    rootsMock.mockResolvedValueOnce({
      roots: [{ id: 'root-0', label: 'workspace', path: '/home/user/workspace' }],
    });

    const app = Fastify();
    await app.register(agentRoutes);
    const res = await app.inject({
      method: 'POST',
      url: '/api/agent/file-session',
      payload: { clientId: 'client-1' },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.publicUrl).toBe('http://frps.example.com:23001');
    expect(body.token).toBe('file_abc123');
    expect(body.roots).toEqual([{ id: 'root-0', label: 'workspace', path: '/home/user/workspace' }]);
  });

  it('returns 404 if client not found in file-session', async () => {
    const app = Fastify();
    await app.register(agentRoutes);
    const res = await app.inject({
      method: 'POST',
      url: '/api/agent/file-session',
      payload: { clientId: 'nonexistent' },
    });
    expect(res.statusCode).toBe(404);
    expect(res.json()).toEqual({ error: 'Client not found' });
  });

  it('returns 500 if startSession throws', async () => {
    startSessionMock.mockRejectedValueOnce(new Error('Client is offline'));

    const app = Fastify();
    await app.register(agentRoutes);
    const res = await app.inject({
      method: 'POST',
      url: '/api/agent/file-session',
      payload: { clientId: 'client-1' },
    });
    expect(res.statusCode).toBe(500);
    expect(res.json()).toEqual({ error: 'Client is offline' });
  });

  it('returns roots as empty array when roots fetch fails', async () => {
    startSessionMock.mockResolvedValueOnce({
      clientId: 'client-1',
      publicUrl: 'http://frps.example.com:23001',
      token: 'file_abc123',
      localPort: 45123,
      mappingId: 'pm_file',
      startedAt: 1000,
      expiresAt: Date.now() + 1800000,
    });
    rootsMock.mockRejectedValueOnce(new Error('connection refused'));

    const app = Fastify();
    await app.register(agentRoutes);
    const res = await app.inject({
      method: 'POST',
      url: '/api/agent/file-session',
      payload: { clientId: 'client-1' },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json().roots).toEqual([]);
  });

  // --- Delete File Session ---

  it('stops file session via DELETE /api/agent/file-session', async () => {
    stopSessionMock.mockResolvedValueOnce({
      clientId: 'client-1',
      publicUrl: 'http://frps.example.com:23001',
      token: 'file_abc123',
      localPort: 45123,
      mappingId: 'pm_file',
      startedAt: 1000,
      expiresAt: Date.now() + 1800000,
    });

    const app = Fastify();
    await app.register(agentRoutes);
    const res = await app.inject({
      method: 'DELETE',
      url: '/api/agent/file-session',
      payload: { clientId: 'client-1' },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ success: true });
  });

  it('returns 404 when no active session to stop', async () => {
    stopSessionMock.mockResolvedValueOnce(undefined);

    const app = Fastify();
    await app.register(agentRoutes);
    const res = await app.inject({
      method: 'DELETE',
      url: '/api/agent/file-session',
      payload: { clientId: 'client-1' },
    });
    expect(res.statusCode).toBe(404);
    expect(res.json()).toEqual({ error: 'No active session for this client' });
  });

  // --- Existing endpoints still work ---

  it('run-script still works', async () => {
    const app = Fastify();
    await app.register(agentRoutes);
    const res = await app.inject({
      method: 'POST',
      url: '/api/agent/run-script',
      payload: { target: { clientId: 'client-1' }, script: 'console.log(1)' },
    });
    expect(res.statusCode).toBe(201);
  });
});
