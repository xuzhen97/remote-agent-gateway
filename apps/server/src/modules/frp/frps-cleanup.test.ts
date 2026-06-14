import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { env } from '../../config/env.js';
import { cleanupDeletedProxyFromDashboard } from './frps-cleanup.js';

const originalEnv = { ...process.env };

describe('cleanupDeletedProxyFromDashboard', () => {
  beforeEach(() => {
    process.env = {
      ...originalEnv,
      RAG_SERVER_CONFIG: '',
    };
    vi.stubGlobal('fetch', vi.fn());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    process.env = { ...originalEnv };
  });

  it('waits for proxy to go offline, clears offline records, then confirms removal', async () => {
    vi.mocked(fetch)
      .mockResolvedValueOnce(new Response(JSON.stringify({ status: 'online', conf: { name: 'proxy-a' } }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ status: 'offline', conf: null }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ Code: 200, Msg: 'success' }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ Code: 404, Msg: 'no proxy info found' }), { status: 404 }));

    const result = await cleanupDeletedProxyFromDashboard({
      name: 'proxy-a',
      proxyType: 'tcp',
      timeoutMs: 100,
      intervalMs: 0,
    });

    const dashboardBase = `${env.FRPS_DASHBOARD_SCHEME}://${env.FRPS_DASHBOARD_HOST}:${env.FRPS_DASHBOARD_PORT}`;

    expect(result).toBe(true);
    expect(fetch).toHaveBeenNthCalledWith(1,
      `${dashboardBase}/api/proxy/tcp/proxy-a`,
      expect.objectContaining({ headers: expect.objectContaining({ Authorization: expect.stringMatching(/^Basic\s+/) }) }),
    );
    expect(fetch).toHaveBeenNthCalledWith(2,
      `${dashboardBase}/api/proxy/tcp/proxy-a`,
      expect.objectContaining({ headers: expect.objectContaining({ Authorization: expect.stringMatching(/^Basic\s+/) }) }),
    );
    expect(fetch).toHaveBeenNthCalledWith(3,
      `${dashboardBase}/api/proxies?status=offline`,
      expect.objectContaining({ method: 'DELETE' }),
    );
    expect(fetch).toHaveBeenNthCalledWith(4,
      `${dashboardBase}/api/proxy/tcp/proxy-a`,
      expect.objectContaining({ headers: expect.objectContaining({ Authorization: expect.stringMatching(/^Basic\s+/) }) }),
    );
  });
});
