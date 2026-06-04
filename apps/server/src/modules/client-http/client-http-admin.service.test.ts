import { describe, expect, it, vi } from 'vitest';
import { ClientHttpAdminService } from './client-http-admin.service.js';

vi.mock('../clients/clients.service.js', () => ({
  clientsService: {
    getClient: vi.fn(() => ({ http_base_url: 'http://client:20317', http_local_host: '127.0.0.1', http_local_port: 17890, http_token: 'client-token' })),
  },
}));

describe('ClientHttpAdminService', () => {
  it('sends trusted source and actor headers to client HTTP', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ ok: true }), { status: 200 })
    );
    const service = new ClientHttpAdminService(fetchMock as any);

    await service.request('client-1', {
      method: 'POST',
      path: '/frp/mappings',
      body: { name: 'vite', type: 'tcp', localPort: 5173 },
      auditContext: { sourceType: 'web-console', actorType: 'admin-token' },
    });

    expect(fetchMock).toHaveBeenCalledWith(
      'http://127.0.0.1:17890/frp/mappings',
      expect.objectContaining({
        headers: expect.objectContaining({
          'x-rag-source': 'web-console',
          'x-rag-actor-type': 'admin-token',
        }),
      })
    );
  });

  it('does not send audit headers when no context provided', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ ok: true }), { status: 200 })
    );
    const service = new ClientHttpAdminService(fetchMock as any);

    await service.request('client-1', {
      method: 'GET',
      path: '/health',
    });

    const callHeaders = fetchMock.mock.calls[0][1].headers;
    expect(callHeaders['x-rag-source']).toBeUndefined();
  });

  it('falls back to public base url when local client http is unreachable', async () => {
    const fetchMock = vi.fn()
      .mockRejectedValueOnce(new Error('connect ECONNREFUSED'))
      .mockResolvedValueOnce(new Response(JSON.stringify({ ok: true, data: { logs: [] } }), { status: 200 }));
    const service = new ClientHttpAdminService(fetchMock as any);

    const result = await service.request('client-1', {
      method: 'GET',
      path: '/jobs/job_01/logs',
    });

    expect(fetchMock).toHaveBeenNthCalledWith(1, 'http://127.0.0.1:17890/jobs/job_01/logs', expect.any(Object));
    expect(fetchMock).toHaveBeenNthCalledWith(2, 'http://client:20317/jobs/job_01/logs', expect.any(Object));
    expect(result.status).toBe(200);
  });
});
