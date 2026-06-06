import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  mockSend,
  mockFetch,
  mockMkdir,
  mockRename,
  mockExistsSync,
} = vi.hoisted(() => {
  const mockSend = vi.fn();
  return {
    mockSend,
    mockFetch: vi.fn(async (url: string) => {
      if (url.includes('/api/transfers/tr_drive_root')) {
        return new Response(JSON.stringify({
          id: 'tr_drive_root', clientId: 'client-1', rootId: 'root-0', targetDir: '.', filename: 'demo.txt', size: 5,
          accessToken: 'token', openapiBase: 'https://openapi.alipan.com', driveId: 'drive-1', fileId: 'file-1', downloadUrl: 'https://download',
        }), { status: 200 });
      }
      if (url.includes('/api/transfers/tr_1')) {
        return new Response(JSON.stringify({
          id: 'tr_1', clientId: 'client-1', rootId: 'root-0', targetDir: '.', filename: 'demo.txt', size: 5,
          accessToken: 'token', openapiBase: 'https://openapi.alipan.com', driveId: 'drive-1', fileId: 'file-1', downloadUrl: 'https://download',
        }), { status: 200 });
      }
      return new Response('hello', { status: 200, headers: { 'content-length': '5' } });
    }),
    mockMkdir: vi.fn(async (dir: string) => {
      if (dir === 'D:\\') throw Object.assign(new Error("EPERM: operation not permitted, mkdir 'D:\\'"), { code: 'EPERM' });
    }),
    mockRename: vi.fn(async () => undefined),
    mockExistsSync: vi.fn((dir: string) => dir === 'D:\\'),
  };
});

const mockFs: Record<string, unknown> = {};

vi.mock('node:fs', async (importOriginal) => ({
  ...(await importOriginal<typeof import('node:fs')>()),
  existsSync: mockExistsSync,
  createWriteStream: vi.fn(() => ({
    write: vi.fn((_chunk: unknown) => true),
    end: vi.fn((cb: (() => void) | undefined) => { cb?.(); }),
    once: vi.fn((_event: string, cb: () => void) => { cb(); }),
  })),
}));

vi.mock('node:fs/promises', () => ({
  mkdir: mockMkdir,
  rename: mockRename,
  readFile: vi.fn(async (p: string) => mockFs[p]),
  rm: vi.fn(async () => undefined),
}));

import { downloadAliyunTransfer } from './aliyundrive-download-executor.js';

describe('downloadAliyunTransfer', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockExistsSync.mockImplementation((dir: string) => dir === 'D:\\');
  });

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

  it('does not try to mkdir an existing Windows drive root target directory', async () => {
    await downloadAliyunTransfer({
      transferId: 'tr_drive_root',
      clientId: 'client-1',
      apiBaseUrl: 'http://server',
      serverToken: 'server-token',
      workspaceDir: 'D:\\',
      allowedRoots: ['D:\\'],
      fetchImpl: mockFetch as any,
      sendWs: mockSend,
    });

    expect(mockMkdir).not.toHaveBeenCalledWith('D:\\', expect.anything());
    expect(mockSend).toHaveBeenCalledWith(expect.objectContaining({ type: 'client.transfer.complete' }));
  });
});
