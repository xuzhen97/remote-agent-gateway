import { beforeEach, describe, expect, it, vi } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { CliError } from './http-error.js';
import { uploadFileWithProgress } from './upload-transfer.js';

function makeFile(content: string): string {
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'rag-upload-transfer-')), 'demo.jar');
  fs.writeFileSync(file, content, 'utf8');
  return file;
}

describe('uploadFileWithProgress', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('resumes already uploaded parts and reports progress for missing parts only', async () => {
    const file = makeFile('ABCDEFGHIJKL');
    const api = {
      initUploadSession: vi.fn().mockResolvedValue({
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
      }),
      uploadPart: vi.fn().mockResolvedValue(undefined),
      completeUploadSession: vi.fn().mockResolvedValue({ uploadId: 'upl_1', rootId: 'root-0', path: 'drop/demo.jar', size: 12 }),
      abortUploadSession: vi.fn(),
    } as any;
    const progress = vi.fn();

    const result = await uploadFileWithProgress(api, {
      rootId: 'root-0',
      path: 'drop',
      filePath: file,
      filename: 'demo.jar',
      chunkSize: 4,
      onProgress: progress,
    });

    expect(api.uploadPart).toHaveBeenCalledTimes(2);
    expect(api.uploadPart).toHaveBeenNthCalledWith(1, 'upl_1', 1, expect.any(Uint8Array), { offset: 4, size: 4 });
    expect(api.uploadPart).toHaveBeenNthCalledWith(2, 'upl_1', 2, expect.any(Uint8Array), { offset: 8, size: 4 });
    expect(api.completeUploadSession).toHaveBeenCalledWith('upl_1');
    expect(progress).toHaveBeenLastCalledWith(expect.objectContaining({ uploadedBytes: 12, totalBytes: 12, partNumber: 2, partCount: 3 }));
    expect(result.path).toBe('drop/demo.jar');
  });

  it('retries retryable part failures before succeeding', async () => {
    const file = makeFile('ABCDEFGH');
    const api = {
      initUploadSession: vi.fn().mockResolvedValue({
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
      }),
      uploadPart: vi.fn()
        .mockRejectedValueOnce(new CliError('HTTP_ERROR', 'gateway reset', 504))
        .mockResolvedValueOnce(undefined)
        .mockResolvedValueOnce(undefined),
      completeUploadSession: vi.fn().mockResolvedValue({ uploadId: 'upl_2', rootId: 'root-0', path: 'demo.jar', size: 8 }),
      abortUploadSession: vi.fn(),
    } as any;

    await uploadFileWithProgress(api, {
      rootId: 'root-0',
      path: '.',
      filePath: file,
      filename: 'demo.jar',
      chunkSize: 4,
    });

    expect(api.uploadPart).toHaveBeenCalledTimes(3);
  });
});
