import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { checkFrpsProxyRegistration, listFrpsProxies } from './frps-dashboard.service.js';

const originalEnv = { ...process.env };

describe('frps dashboard registration checks', () => {
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

  it('reports registered when dashboard returns proxy info', async () => {
    vi.mocked(fetch).mockResolvedValue(new Response(JSON.stringify({ name: 'proxy-a' }), { status: 200 }));

    const result = await checkFrpsProxyRegistration({
      dashboard: {
        scheme: 'http',
        host: 'frps.example.com',
        port: 7500,
        user: 'admin',
        password: 'secret',
      },
      mapping: {
        name: 'proxy-a',
        proxyType: 'tcp',
        remotePort: 20000,
      },
    });

    expect(result).toEqual(expect.objectContaining({
      registered: true,
      dashboardReachable: true,
      reason: 'registered',
      proxyType: 'tcp',
      name: 'proxy-a',
    }));
  });

  it('reports not registered when dashboard returns 404', async () => {
    vi.mocked(fetch).mockResolvedValue(new Response(JSON.stringify({ msg: 'not found' }), { status: 404 }));

    const result = await checkFrpsProxyRegistration({
      dashboard: {
        scheme: 'http',
        host: 'frps.example.com',
        port: 7500,
        user: 'admin',
        password: 'secret',
      },
      mapping: {
        name: 'proxy-missing',
        proxyType: 'tcp',
        remotePort: 20001,
      },
    });

    expect(result).toEqual(expect.objectContaining({
      registered: false,
      dashboardReachable: true,
      reason: 'not_found',
      name: 'proxy-missing',
    }));
  });

  it('reports dashboard auth failure on 401', async () => {
    vi.mocked(fetch).mockResolvedValue(new Response('unauthorized', { status: 401 }));

    const result = await checkFrpsProxyRegistration({
      dashboard: {
        scheme: 'http',
        host: 'frps.example.com',
        port: 7500,
        user: 'admin',
        password: 'secret',
      },
      mapping: {
        name: 'proxy-a',
        proxyType: 'tcp',
        remotePort: 20000,
      },
    });

    expect(result).toEqual(expect.objectContaining({
      registered: false,
      dashboardReachable: true,
      reason: 'auth_failed',
      statusCode: 401,
    }));
  });

  it('lists proxy summaries across tcp/http/https endpoints', async () => {
    vi.mocked(fetch)
      .mockResolvedValueOnce(new Response(JSON.stringify({ proxies: [{ name: 'tcp-a', remotePort: 23001 }] }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ proxies: [{ name: 'http-a', remotePort: 23002 }] }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ proxies: [{ name: 'https-a', remotePort: 23003 }] }), { status: 200 }));

    const result = await listFrpsProxies({
      scheme: 'http',
      host: 'frps.example.com',
      port: 7500,
      user: 'admin',
      password: 'secret',
    });

    expect(result).toEqual({
      dashboardReachable: true,
      proxies: [
        { name: 'tcp-a', proxyType: 'tcp', remotePort: 23001 },
        { name: 'http-a', proxyType: 'http', remotePort: 23002 },
        { name: 'https-a', proxyType: 'https', remotePort: 23003 },
      ],
    });
  });

  it('returns dashboardReachable false when list endpoint fetch throws', async () => {
    vi.mocked(fetch).mockRejectedValue(new Error('connect ECONNREFUSED'));

    const result = await listFrpsProxies({
      scheme: 'http',
      host: 'frps.example.com',
      port: 7500,
      user: 'admin',
      password: 'secret',
    });

    expect(result).toEqual(expect.objectContaining({
      dashboardReachable: false,
      proxies: [],
      detail: expect.stringContaining('ECONNREFUSED'),
    }));
  });
});
