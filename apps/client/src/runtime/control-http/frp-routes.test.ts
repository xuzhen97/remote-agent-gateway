import { describe, expect, it, vi, beforeEach } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { EventEmitter } from 'node:events';
import { ControlHttpRouter } from './router.js';
import { registerFrpRoutes } from './frp-routes.js';

const { rebuildFrpcDaemonMock } = vi.hoisted(() => ({
  rebuildFrpcDaemonMock: vi.fn(),
}));

vi.mock('../frpc-daemon.js', () => ({
  rebuildFrpcDaemon: rebuildFrpcDaemonMock,
}));

function makeWorkDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'rag-frp-routes-'));
}

function writeStore(workDir: string, mappings: Array<Record<string, unknown>>): void {
  fs.writeFileSync(path.join(workDir, 'frp-mappings.json'), JSON.stringify(mappings, null, 2));
}

function createResponseCapture(onEnd?: () => void) {
  let statusCode = 0;
  let body = '';
  const headers = new Map<string, string>();
  const res = new EventEmitter() as any;
  res.setHeader = (name: string, value: string) => { headers.set(name.toLowerCase(), value); };
  res.writeHead = (code: number) => { statusCode = code; };
  res.end = (chunk?: Buffer | string) => {
    body = chunk ? String(chunk) : '';
    onEnd?.();
    res.emit('finish');
  };
  return {
    res,
    get statusCode() { return statusCode; },
    get json() { return body ? JSON.parse(body) : null; },
    headers,
  };
}

function createPostRequest(url: string, payload: unknown) {
  const body = Buffer.from(JSON.stringify(payload));
  return {
    method: 'POST',
    url,
    headers: { authorization: 'Bearer test-token', 'content-type': 'application/json', 'content-length': String(body.length) },
    async *[Symbol.asyncIterator]() { yield body; },
  };
}

function createDeleteRequest(url: string) {
  return {
    method: 'DELETE',
    url,
    headers: { authorization: 'Bearer test-token' },
    async *[Symbol.asyncIterator]() {},
  };
}

describe('registerFrpRoutes create flow', () => {
  beforeEach(() => {
    rebuildFrpcDaemonMock.mockReset();
    vi.stubGlobal('fetch', vi.fn());
  });

  it('sends the create response before rebuilding frpc so the control tunnel request can complete', async () => {
    const workDir = makeWorkDir();
    const events: string[] = [];

    vi.mocked(fetch).mockResolvedValue(new Response(JSON.stringify({ id: 'pm_01', remotePort: 23001, publicUrl: 'example:23001' }), { status: 200 }));
    rebuildFrpcDaemonMock.mockImplementation(() => {
      events.push('rebuild');
      return { proxyCount: 2 };
    });

    const router = new ControlHttpRouter();
    registerFrpRoutes(router, {
      token: 'test-token',
      clientId: 'client-1',
      workspaceDir: workDir,
      frpcPath: '/tmp/frpc',
      frpcWorkDir: workDir,
      apiBaseUrl: 'http://server.example.com',
      serverToken: 'server-token',
    }, {
      execute: async ({ run }: any) => {
        const result = await run();
        return result.body;
      },
    } as any);

    const response = createResponseCapture(() => events.push('end'));
    await router.handle(createPostRequest('/frp/mappings', {
      name: 'web',
      type: 'tcp',
      localHost: '127.0.0.1',
      localPort: 3010,
    }) as any, response.res as any);
    await new Promise((resolve) => setImmediate(resolve));

    expect(response.statusCode).toBe(200);
    expect(response.json).toEqual({ ok: true, data: {
      id: 'pm_01', kind: 'business', name: 'web', type: 'tcp', localHost: '127.0.0.1', localPort: 3010, remotePort: 23001, customDomain: undefined, publicUrl: 'example:23001',
    } });
    expect(events).toEqual(['end', 'rebuild']);
  });
});

describe('registerFrpRoutes delete flow', () => {
  beforeEach(() => {
    rebuildFrpcDaemonMock.mockReset();
    vi.stubGlobal('fetch', vi.fn());
  });

  it('waits for server-side mapping deletion before responding, then rebuilds frpc after the response finishes', async () => {
    const workDir = makeWorkDir();
    const events: string[] = [];
    writeStore(workDir, [{
      id: 'pm_01',
      kind: 'business',
      name: 'test-mapping',
      type: 'tcp',
      localHost: '127.0.0.1',
      localPort: 3000,
      remotePort: 23001,
    }]);

    vi.mocked(fetch).mockImplementation(async (input) => {
      const url = String(input);
      if (url.endsWith('/api/client-http/ports/pm_01')) {
        events.push('delete-server');
      }
      if (url.endsWith('/api/client-http/ports/cleanup-dashboard')) {
        events.push('cleanup');
      }
      return new Response(JSON.stringify({ success: true }), { status: 200 });
    });
    rebuildFrpcDaemonMock.mockImplementation(() => {
      events.push('rebuild');
      return { proxyCount: 1 };
    });

    const router = new ControlHttpRouter();
    registerFrpRoutes(router, {
      token: 'test-token',
      clientId: 'client-1',
      workspaceDir: workDir,
      frpcPath: '/tmp/frpc',
      frpcWorkDir: workDir,
      apiBaseUrl: 'http://server.example.com',
      serverToken: 'server-token',
    }, {
      execute: async ({ run }: any) => {
        const result = await run();
        return result.body;
      },
    } as any);

    const response = createResponseCapture(() => events.push('end'));
    await router.handle(createDeleteRequest('/frp/mappings/pm_01') as any, response.res as any);
    await new Promise((resolve) => setImmediate(resolve));

    expect(fetch).toHaveBeenNthCalledWith(1, 'http://server.example.com/api/client-http/ports/pm_01', {
      method: 'DELETE',
      headers: { Authorization: 'Bearer server-token' },
    });
    expect(fetch).toHaveBeenNthCalledWith(2, 'http://server.example.com/api/client-http/ports/cleanup-dashboard', {
      method: 'POST',
      headers: {
        Authorization: 'Bearer server-token',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ name: 'test-mapping', proxyType: 'tcp' }),
    });
    expect(response.statusCode).toBe(200);
    expect(response.json).toEqual({ ok: true, data: { id: 'pm_01', deleted: true } });
    expect(JSON.parse(fs.readFileSync(path.join(workDir, 'frp-mappings.json'), 'utf-8'))).toEqual([]);
    expect(rebuildFrpcDaemonMock).toHaveBeenCalledTimes(1);
    expect(events).toEqual(['delete-server', 'cleanup', 'end', 'rebuild']);
  });

  it('keeps the local mapping when server-side deletion fails', async () => {
    const workDir = makeWorkDir();
    writeStore(workDir, [{
      id: 'pm_02',
      kind: 'business',
      name: 'test-mapping-2',
      type: 'tcp',
      localHost: '127.0.0.1',
      localPort: 3001,
      remotePort: 23002,
    }]);

    vi.mocked(fetch).mockResolvedValue(new Response(JSON.stringify({ error: 'delete failed' }), { status: 500 }));

    const router = new ControlHttpRouter();
    registerFrpRoutes(router, {
      token: 'test-token',
      clientId: 'client-1',
      workspaceDir: workDir,
      frpcPath: '/tmp/frpc',
      frpcWorkDir: workDir,
      apiBaseUrl: 'http://server.example.com',
      serverToken: 'server-token',
    }, {
      execute: async ({ run }: any) => {
        const result = await run();
        return result.body;
      },
    } as any);

    const response = createResponseCapture();
    await router.handle(createDeleteRequest('/frp/mappings/pm_02') as any, response.res as any);

    expect(response.statusCode).toBe(400);
    expect(response.json).toEqual({ ok: false, error: { code: 'FRP_CONFIG_ERROR', message: 'delete failed' } });
    expect(JSON.parse(fs.readFileSync(path.join(workDir, 'frp-mappings.json'), 'utf-8'))).toHaveLength(1);
    expect(rebuildFrpcDaemonMock).not.toHaveBeenCalled();
  });
});
