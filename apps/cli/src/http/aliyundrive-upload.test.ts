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
  it('uploads each planned part and reports progress', async () => {
    const fetchImpl = vi.fn(async () => new Response('', { status: 200 }));
    const progress = vi.fn();
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
      serverApi: { reportCliProgress: vi.fn(), completeCliUpload: vi.fn(), refreshUploadUrl: vi.fn() } as any,
      fetchImpl: fetchImpl as any,
      onProgress: progress,
    });
    expect(fetchImpl).toHaveBeenCalledWith('https://upload', expect.objectContaining({ method: 'PUT' }));
    expect(progress).toHaveBeenCalledWith(expect.objectContaining({ uploadedBytes: 4, totalBytes: 4 }));
  });
});
