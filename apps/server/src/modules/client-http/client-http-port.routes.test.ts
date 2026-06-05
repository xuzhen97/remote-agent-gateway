import { describe, expect, it, vi, beforeEach } from 'vitest';
import Fastify from 'fastify';
import { clientHttpPortRoutes } from './client-http-port.routes.js';

const { cleanupDeletedProxyFromDashboardMock } = vi.hoisted(() => ({
  cleanupDeletedProxyFromDashboardMock: vi.fn(),
}));

vi.mock('../auth/auth.middleware.js', () => ({
  authMiddleware: async (request: unknown) => {
    (request as { authRole?: string }).authRole = 'agent';
  },
}));

vi.mock('../frp/frp.service.js', () => ({
  frpService: {
    createMapping: vi.fn(),
    getMapping: vi.fn(),
    deleteMapping: vi.fn(),
    toApi: vi.fn(),
  },
}));

vi.mock('../frp/frps-cleanup.js', () => ({
  cleanupDeletedProxyFromDashboard: cleanupDeletedProxyFromDashboardMock,
}));

vi.mock('../audit/audit.service.js', () => ({
  auditService: { log: vi.fn() },
}));

describe('clientHttpPortRoutes', () => {
  beforeEach(() => {
    cleanupDeletedProxyFromDashboardMock.mockReset();
  });

  it('logs cleanup success when dashboard cleanup succeeds', async () => {
    cleanupDeletedProxyFromDashboardMock.mockResolvedValue(true);

    const app = Fastify();
    await app.register(clientHttpPortRoutes);

    const response = await app.inject({
      method: 'POST',
      url: '/api/client-http/ports/cleanup-dashboard',
      headers: { authorization: 'Bearer test-token' },
      payload: { name: 'proxy-a', proxyType: 'tcp' },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ success: true });

    const { auditService } = await import('../audit/audit.service.js');
    expect(auditService.log).toHaveBeenCalledWith(expect.objectContaining({
      actor: 'agent',
      action: 'client_http.business_port.cleanup_dashboard.success',
      targetType: 'port_mapping',
      targetId: 'proxy-a',
      detail: 'proxyType=tcp',
    }));
  });

  it('logs cleanup failure when dashboard cleanup fails', async () => {
    cleanupDeletedProxyFromDashboardMock.mockResolvedValue(false);

    const app = Fastify();
    await app.register(clientHttpPortRoutes);

    const response = await app.inject({
      method: 'POST',
      url: '/api/client-http/ports/cleanup-dashboard',
      headers: { authorization: 'Bearer test-token' },
      payload: { name: 'proxy-b', proxyType: 'tcp' },
    });

    expect(response.statusCode).toBe(409);
    expect(response.json()).toEqual({ error: 'Failed to clear deleted proxy from FRPS dashboard' });

    const { auditService } = await import('../audit/audit.service.js');
    expect(auditService.log).toHaveBeenCalledWith(expect.objectContaining({
      actor: 'agent',
      action: 'client_http.business_port.cleanup_dashboard.failed',
      targetType: 'port_mapping',
      targetId: 'proxy-b',
      detail: 'proxyType=tcp',
    }));
  });
});
