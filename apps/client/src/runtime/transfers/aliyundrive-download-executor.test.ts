import { describe, expect, it, vi } from 'vitest';

const mockSend = vi.fn();
const mockFetch = vi.fn(async (url: string) => {
  if (url.includes('/api/transfers/tr_1')) {
    return new Response(JSON.stringify({
      id: 'tr_1', clientId: 'client-1', rootId: 'root-0', targetDir: '.', filename: 'demo.txt', size: 5,
      accessToken: 'token', openapiBase: 'https://openapi.alipan.com', driveId: 'drive-1', fileId: 'file-1', downloadUrl: 'https://download',
    }), { status: 200 });
  }
  return new Response('hello', { status: 200, headers: { 'content-length': '5' } });
});

const mockFs: Record<string, unknown> = {};

vi.mock('node:fs', async (importOriginal) => ({
  ...(await importOriginal<typeof import('node:fs')>()),
  createWriteStream: vi.fn(() => ({
    write: vi.fn((_chunk: unknown) => true),
    end: vi.fn((cb: (() => void) | undefined) => { cb?.(); }),
    once: vi.fn((_event: string, cb: () => void) => { cb(); }),
  })),
}));

vi.mock('node:fs/promises', () => ({
  mkdir: vi.fn(async () => undefined),
  rename: vi.fn(async () => undefined),
  readFile: vi.fn(async (p: string) => mockFs[p]),
  rm: vi.fn(async () => undefined),
}));

import { downloadAliyunTransfer } from './aliyundrive-download-executor.js';

describe('downloadAliyunTransfer', () => {
  it('downloads to a temp file then renames into allowed root', async () => {
    await downloadAliyunTransfer({
      transferId: 'tr_1',
      clientId: 'client-1',
      apiBaseUrl: 'http://server',
      serverToken: 'server-token',
      workspaceDir: '/tmp',
      allowedRoots: ['/tmp'],
      fetchImpl: mockFetch as any,
      sendWs: mockSend,
    });
    expect(mockSend).toHaveBeenCalledWith(expect.objectContaining({ type: 'client.transfer.complete' }));
  });
});
