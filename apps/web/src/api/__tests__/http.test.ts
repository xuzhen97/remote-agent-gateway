import { describe, expect, it, vi } from 'vitest';
import { ApiError, createApiClient } from '../http.js';

describe('createApiClient', () => {
  it('sends bearer token and parses JSON', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ ok: true }), { status: 200 }));
    const api = createApiClient({ baseUrl: 'http://server', getToken: () => 'admin-token', fetchImpl: fetchMock as any });
    const result = await api.get('/api/health');

    expect(fetchMock).toHaveBeenCalledWith('http://server/api/health', expect.objectContaining({ headers: { Authorization: 'Bearer admin-token' } }));
    expect(result).toEqual({ ok: true });
  });

  it('preserves server error codes on thrown api errors', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      ok: false,
      error: { code: 'RELEASE_IN_USE', message: 'Release is referenced by existing campaigns' },
    }), { status: 409 }));

    const api = createApiClient({ baseUrl: 'http://server', getToken: () => 't', fetchImpl: fetchMock as any });

    await expect(api.delete('/admin/updates/releases/v1.4.0')).rejects.toMatchObject({
      code: 'RELEASE_IN_USE',
      message: 'Release is referenced by existing campaigns',
    });
  });

  it('throws on non-ok responses', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ error: 'fail' }), { status: 401 }));
    const api = createApiClient({ baseUrl: 'http://server', getToken: () => 't', fetchImpl: fetchMock as any });
    await expect(api.get('/api/clients')).rejects.toThrow('fail');
  });
});
