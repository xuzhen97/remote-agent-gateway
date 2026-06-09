import { EventEmitter } from 'node:events';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ControlHttpRouter } from './router.js';
import { registerTransferRoutes } from './transfer-routes.js';

const { mockDownloadAliyunTransfer } = vi.hoisted(() => ({
  mockDownloadAliyunTransfer: vi.fn(),
}));

vi.mock('../transfers/aliyundrive-download-executor.js', () => ({
  downloadAliyunTransfer: mockDownloadAliyunTransfer,
}));

function createResponseCapture() {
  let statusCode = 0;
  let body = '';
  const res = new EventEmitter() as any;
  res.setHeader = vi.fn();
  res.writeHead = (code: number) => { statusCode = code; };
  res.end = (chunk?: Buffer | string) => {
    body = chunk ? String(chunk) : '';
    res.emit('finish');
  };
  return {
    res,
    get statusCode() { return statusCode; },
    get json() { return body ? JSON.parse(body) : null; },
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

describe('registerTransferRoutes', () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it('reports fallback transfer progress and completion back to the server API', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ ok: true }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ ok: true }), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    mockDownloadAliyunTransfer.mockImplementation(async (options: any) => {
      await options.reportProgress({ transferId: 'tr_1', clientId: 'client-1', phase: 'client_downloading', downloadedBytes: 5, writtenBytes: 5, totalBytes: 10 });
      await options.reportComplete({ transferId: 'tr_1', clientId: 'client-1', rootId: 'root-0', path: 'demo.txt', size: 10 });
    });

    const router = new ControlHttpRouter();
    registerTransferRoutes(router, {
      token: 'test-token',
      clientId: 'client-1',
      apiBaseUrl: 'http://server.example.com',
      serverToken: 'server-token',
      workspaceDir: '/tmp',
      allowedRoots: ['/tmp'],
    });

    const response = createResponseCapture();
    await router.handle(createPostRequest('/files/aliyundrive-download', { transferId: 'tr_1' }) as any, response.res as any);
    await new Promise((resolve) => setImmediate(resolve));

    expect(response.statusCode).toBe(200);
    expect(fetchMock).toHaveBeenNthCalledWith(1, 'http://server.example.com/api/transfers/tr_1/client-progress', {
      method: 'POST',
      headers: {
        Authorization: 'Bearer server-token',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ transferId: 'tr_1', clientId: 'client-1', phase: 'client_downloading', downloadedBytes: 5, writtenBytes: 5, totalBytes: 10 }),
    });
    expect(fetchMock).toHaveBeenNthCalledWith(2, 'http://server.example.com/api/transfers/tr_1/client-complete', {
      method: 'POST',
      headers: {
        Authorization: 'Bearer server-token',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ transferId: 'tr_1', clientId: 'client-1', rootId: 'root-0', path: 'demo.txt', size: 10 }),
    });
  });
});
