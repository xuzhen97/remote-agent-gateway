import { describe, expect, it, vi } from 'vitest';
import { uploadClientFileViaRelay } from './client-file-relay-upload.js';

describe('uploadClientFileViaRelay', () => {
  it('falls back to direct when auto resolves to frps_chunked', async () => {
    const api = {
      post: vi.fn(async () => ({ mode: 'frps_chunked' })),
      get: vi.fn(),
      put: vi.fn(),
      delete: vi.fn(),
    } as any;
    const file = new File(['hello'], 'demo.bin');

    const result = await uploadClientFileViaRelay({
      api,
      clientId: 'client-1',
      rootId: 'root-0',
      path: '.',
      file,
      requestedMode: 'auto',
      onStateChange: vi.fn(),
      pollIntervalMs: 0,
    });

    expect(result).toEqual({ kind: 'fallback_to_direct', reason: 'server_returned_frps_chunked' });
  });

  it('uploads parts to aliyun and polls transfer until completed', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response('', { status: 200 }))
      .mockResolvedValueOnce(new Response('', { status: 200 }));
    const api = {
      post: vi.fn(async (path: string) => {
        if (path === '/api/transfers/uploads') {
          return {
            mode: 'aliyundrive',
            transferId: 'tr_1',
            accessToken: 'token',
            openapiBase: 'https://openapi.alipan.com',
            driveId: 'drive-1',
            fileId: 'file-1',
            uploadId: 'upload-1',
            partSize: 3,
            partCount: 2,
            uploadParts: [
              { partNumber: 1, uploadUrl: 'https://upload.example/1', size: 3 },
              { partNumber: 2, uploadUrl: 'https://upload.example/2', size: 2 },
            ],
          };
        }
        if (path === '/api/transfers/tr_1/cli-progress') return { ok: true };
        if (path === '/api/transfers/tr_1/cli-upload-complete') return { ok: true };
        throw new Error(`unexpected post ${path}`);
      }),
      get: vi.fn(async () => ({ id: 'tr_1', status: 'completed', downloadedBytes: 5, writtenBytes: 5, totalBytes: 5 })),
      put: vi.fn(),
      delete: vi.fn(),
    } as any;
    const onStateChange = vi.fn();
    const file = new File(['hello'], 'demo.bin');

    const result = await uploadClientFileViaRelay({
      api,
      clientId: 'client-1',
      rootId: 'root-0',
      path: '.',
      file,
      requestedMode: 'aliyundrive',
      onStateChange,
      fetchImpl: fetchMock,
      pollIntervalMs: 0,
    });

    expect(result).toEqual({ kind: 'completed', transferId: 'tr_1', resolvedMode: 'aliyundrive' });
    expect(onStateChange).toHaveBeenCalled();
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(api.post).toHaveBeenCalledWith('/api/transfers/tr_1/cli-upload-complete', {});
    expect(api.get).toHaveBeenCalledWith('/api/transfers/tr_1');
  });
});
