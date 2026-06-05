import { beforeEach, describe, expect, it, vi } from 'vitest';
import { uploadClientFile } from './client-file-upload.js';

const fetchMock = vi.fn();

describe('uploadClientFile', () => {
  beforeEach(() => {
    fetchMock.mockReset();
    vi.stubGlobal('fetch', fetchMock);
  });

  it('resumes missing chunks only and reports progress', async () => {
    const file = new File(['ABCDEFGHIJKL'], 'demo.jar', { type: 'application/java-archive', lastModified: 1710000000000 });
    const progress = vi.fn();

    fetchMock
      .mockResolvedValueOnce(new Response(JSON.stringify({ ok: true, data: {
        uploadId: 'upl_1',
        rootId: 'root-0',
        path: 'drop',
        filename: 'demo.jar',
        size: 12,
        chunkSize: 4,
        partCount: 3,
        uploadedParts: [0],
        uploadedBytes: 4,
        resumed: true,
      } }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ ok: true, data: { uploadId: 'upl_1', partNumber: 1, size: 4, uploadedBytes: 8 } }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ ok: true, data: { uploadId: 'upl_1', partNumber: 2, size: 4, uploadedBytes: 12 } }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ ok: true, data: { uploadId: 'upl_1', rootId: 'root-0', path: 'drop/demo.jar', size: 12 } }), { status: 200 }));

    const result = await uploadClientFile({
      baseUrl: 'http://client:20000',
      token: 'client-token',
      rootId: 'root-0',
      path: 'drop',
      file,
      chunkSize: 4,
      onProgress: progress,
      retryDelayMs: () => 0,
    });

    expect(fetchMock).toHaveBeenCalledTimes(4);
    expect(fetchMock).toHaveBeenNthCalledWith(2, 'http://client:20000/files/uploads/upl_1/parts/1?offset=4&size=4', expect.objectContaining({ method: 'PUT' }));
    expect(fetchMock).toHaveBeenNthCalledWith(3, 'http://client:20000/files/uploads/upl_1/parts/2?offset=8&size=4', expect.objectContaining({ method: 'PUT' }));
    expect(progress).toHaveBeenLastCalledWith(expect.objectContaining({ uploadedBytes: 12, totalBytes: 12, partNumber: 2, partCount: 3 }));
    expect(result.path).toBe('drop/demo.jar');
  });

  it('retries retryable chunk failures before succeeding', async () => {
    const file = new File(['ABCDEFGH'], 'demo.jar', { type: 'application/java-archive', lastModified: 1710000000001 });

    fetchMock
      .mockResolvedValueOnce(new Response(JSON.stringify({ ok: true, data: {
        uploadId: 'upl_2',
        rootId: 'root-0',
        path: '.',
        filename: 'demo.jar',
        size: 8,
        chunkSize: 4,
        partCount: 2,
        uploadedParts: [],
        uploadedBytes: 0,
        resumed: false,
      } }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ ok: false, error: { message: 'gateway timeout' } }), { status: 504 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ ok: true, data: { uploadId: 'upl_2', partNumber: 0, size: 4, uploadedBytes: 4 } }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ ok: true, data: { uploadId: 'upl_2', partNumber: 1, size: 4, uploadedBytes: 8 } }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ ok: true, data: { uploadId: 'upl_2', rootId: 'root-0', path: 'demo.jar', size: 8 } }), { status: 200 }));

    await uploadClientFile({
      baseUrl: 'http://client:20000',
      token: 'client-token',
      rootId: 'root-0',
      path: '.',
      file,
      chunkSize: 4,
      retryDelayMs: () => 0,
    });

    expect(fetchMock).toHaveBeenCalledTimes(5);
  });
});
