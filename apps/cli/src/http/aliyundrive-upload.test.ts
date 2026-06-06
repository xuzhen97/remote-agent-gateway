import { describe, expect, it, vi } from 'vitest';
import { uploadFileToAliyunDrive } from './aliyundrive-upload.js';

vi.mock('node:fs/promises', () => ({
  stat: vi.fn(async () => ({ size: 4, mtimeMs: 1 })),
  open: vi.fn(async () => ({
    read: vi.fn(async (buffer: Buffer) => { buffer.write('test'); return { bytesRead: 4 }; }),
    close: vi.fn(async () => undefined),
  })),
}));

describe('uploadFileToAliyunDrive', () => {
  it('uploads each planned part, completes aliyun upload, and reports progress', async () => {
    const fetchImpl = vi.fn(async (url: string) => {
      if (url === 'https://upload') return new Response('', { status: 200 });
      if (url === 'https://openapi.alipan.com/adrive/v1.0/openFile/complete') return new Response(JSON.stringify({ file_id: 'file-1' }), { status: 200 });
      throw new Error(`unexpected url ${url}`);
    });
    const progress = vi.fn();
    const serverApi = { reportCliProgress: vi.fn(), completeCliUpload: vi.fn(), refreshUploadUrl: vi.fn() };
    await uploadFileToAliyunDrive({
      filePath: 'demo.bin',
      plan: {
        mode: 'aliyundrive',
        transferId: 'tr_1',
        accessToken: 'token',
        openapiBase: 'https://openapi.alipan.com',
        driveId: 'drive-1',
        fileId: 'file-1',
        uploadId: 'upload-1',
        partSize: 4,
        partCount: 1,
        uploadParts: [{ partNumber: 1, uploadUrl: 'https://upload', size: 4 }],
      },
      serverApi: serverApi as any,
      fetchImpl: fetchImpl as any,
      onProgress: progress,
    });
    expect(fetchImpl).toHaveBeenCalledWith('https://upload', expect.objectContaining({ method: 'PUT' }));
    expect(fetchImpl).toHaveBeenCalledWith('https://openapi.alipan.com/adrive/v1.0/openFile/complete', expect.objectContaining({ method: 'POST' }));
    expect(serverApi.completeCliUpload).toHaveBeenCalledWith('tr_1');
    expect(progress).toHaveBeenCalledWith(expect.objectContaining({ uploadedBytes: 4, totalBytes: 4 }));
  });
});
