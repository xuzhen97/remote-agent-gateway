import { describe, expect, it, vi, beforeEach } from 'vitest';
import Fastify from 'fastify';
import { frpRoutes } from './frp.routes.js';

vi.mock('../auth/auth.middleware.js', () => ({
  authMiddleware: async (request: unknown) => {
    (request as { authRole?: string }).authRole = 'agent';
  },
}));

const { checkRegistrationMock, createMappingMock } = vi.hoisted(() => ({
  checkRegistrationMock: vi.fn().mockResolvedValue({
    registered: true,
    dashboardReachable: true,
    reason: 'registered',
    proxyType: 'tcp',
    name: 'proxy-a',
    remotePort: 20000,
  }),
  createMappingMock: vi.fn(),
}));

vi.mock('./frps-dashboard.service.js', () => ({
  checkFrpsProxyRegistration: checkRegistrationMock,
}));

vi.mock('../../config/env.js', () => ({
  env: {
    FRPS_DASHBOARD_SCHEME: 'http',
    FRPS_DASHBOARD_HOST: 'frps.example.com',
    FRPS_DASHBOARD_PORT: 7500,
    FRPS_DASHBOARD_USER: 'admin',
    FRPS_DASHBOARD_PASSWORD: 'secret',
  },
}));

vi.mock('./frp.service.js', () => ({
  frpService: {
    createMapping: createMappingMock,
    listMappings: vi.fn(() => []),
    toApi: vi.fn((mapping) => ({
      id: mapping.id,
      clientId: mapping.client_id,
      name: mapping.name,
      proxyType: mapping.proxy_type,
      localIp: mapping.local_ip,
      localPort: mapping.local_port,
      remotePort: mapping.remote_port,
      customDomain: mapping.custom_domain,
      status: mapping.status,
      publicUrl: mapping.public_url,
    })),
    getMapping: vi.fn((mappingId: string) => mappingId === 'pm_tcp' ? {
      id: 'pm_tcp',
      client_id: 'client-1',
      name: 'proxy-a',
      proxy_type: 'tcp',
      local_ip: '127.0.0.1',
      local_port: 65231,
      remote_port: 20000,
      custom_domain: null,
      status: 'active',
      public_url: 'your-server-ip:20000',
    } : undefined),
    deleteMapping: vi.fn(),
  },
  getFrpsConnectionInfo: vi.fn(() => ({ serverAddr: 'frps.example.com', serverPort: 7000, authToken: 'frps-token' })),
}));

vi.mock('../audit/audit.service.js', () => ({ auditService: { log: vi.fn() } }));
vi.mock('../connections/connections.manager.js', () => ({ connectionManager: { sendToClient: vi.fn() } }));
vi.mock('../tasks/tasks.service.js', () => ({ tasksService: { createTask: vi.fn(() => ({ id: 'task-1' })) } }));
vi.mock('../clients/clients.service.js', () => ({ clientsService: { getClient: vi.fn(() => ({ id: 'client-1' })) } }));

describe('frp routes', () => {
  beforeEach(() => {
    createMappingMock.mockReset();
  });

  it('checks registration status through the frps dashboard service', async () => {
    const app = Fastify();
    await app.register(frpRoutes);

    const response = await app.inject({ method: 'POST', url: '/api/port-mappings/pm_tcp/check-registration' });

    expect(response.statusCode).toBe(200);
    expect(checkRegistrationMock).toHaveBeenCalledWith(expect.objectContaining({
      dashboard: expect.objectContaining({
        scheme: 'http',
        host: 'frps.example.com',
        port: 7500,
        user: 'admin',
        password: 'secret',
      }),
      mapping: expect.objectContaining({
        name: 'proxy-a',
        proxyType: 'tcp',
        remotePort: 20000,
      }),
    }));
    expect(response.json()).toEqual({
      registered: true,
      dashboardReachable: true,
      reason: 'registered',
      proxyType: 'tcp',
      name: 'proxy-a',
      remotePort: 20000,
    });
  });

  it('returns 409 when the requested remote port is already occupied', async () => {
    createMappingMock.mockRejectedValueOnce(Object.assign(new Error('Remote port already in use'), {
      name: 'PortConflictError',
      source: 'dashboard',
      port: 23001,
    }));

    const app = Fastify();
    await app.register(frpRoutes);

    const response = await app.inject({
      method: 'POST',
      url: '/api/port-mappings',
      payload: {
        clientId: 'client-1',
        name: 'preview',
        proxyType: 'tcp',
        localIp: '127.0.0.1',
        localPort: 3000,
        remotePort: 23001,
      },
    });

    expect(response.statusCode).toBe(409);
    expect(response.json()).toEqual({
      error: 'Remote port already in use',
      source: 'dashboard',
      port: 23001,
    });
  });
});
