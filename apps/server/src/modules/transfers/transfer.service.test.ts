import { beforeAll, describe, expect, it, vi } from 'vitest';

vi.mock('../connections/connections.manager.js', () => ({
  connectionManager: { sendToClient: vi.fn(() => true), isOnline: vi.fn(() => true) },
}));

vi.mock('../aliyundrive/aliyundrive-auth.service.js', () => ({
  aliyunDriveAuthService: {
    getStatus: vi.fn(() => ({ configured: true, authorized: true })),
    getConfig: vi.fn(() => ({ openapiBase: 'https://openapi.alipan.com', transferFolder: 'RemoteAgentGatewayTransfers', cleanupTtlMs: 86400000 })),
    getAuth: vi.fn(() => ({ accessToken: 'access-token', driveId: 'drive-1', expiresAt: Date.now() + 3600000 })),
  },
}));

const ensureFolderPath = vi.fn(async () => 'folder-1');
const createFileUpload = vi.fn(async () => ({ file_id: 'file-1', upload_id: 'upload-1', part_info_list: [{ part_number: 1, upload_url: 'https://upload' }] }));

vi.mock('../aliyundrive/aliyundrive-openapi.client.js', () => ({
  AliyunDriveOpenApiClient: vi.fn().mockImplementation(() => ({
    ensureFolderPath,
    createFileUpload,
    getDownloadUrl: vi.fn(),
  })),
}));

import { initDb } from '../../db/index.js';
import { TransferService } from './transfer.service.js';

describe('TransferService', () => {
  beforeAll(async () => { await initDb(); });

  it('returns frps_chunked when aliyundrive is not available in auto mode', async () => {
    const service = new TransferService({
      now: () => 1000,
      id: () => 'tr_1',
      authStatus: () => ({ configured: false, authorized: false }),
    } as any);
    const result = await service.createUpload({ clientId: 'client-1', rootId: 'workspace', path: '.', filename: 'a.zip', size: 10, transfer: 'auto' });
    expect(result.mode).toBe('frps_chunked');
  });

  it('throws when aliyundrive is forced but unavailable', async () => {
    const service = new TransferService({ now: () => 1000, id: () => 'tr_1', authStatus: () => ({ configured: false, authorized: false }) } as any);
    await expect(service.createUpload({ clientId: 'client-1', rootId: 'workspace', path: '.', filename: 'a.zip', size: 10, transfer: 'aliyundrive' })).rejects.toThrow('Aliyun Drive is not configured or authorized');
  });

  it('returns direct mode for transfer=direct', async () => {
    const service = new TransferService({ now: () => 1000, id: () => 'tr_1', authStatus: () => ({ configured: true, authorized: true }) } as any);
    const result = await service.createUpload({ clientId: 'client-1', rootId: 'workspace', path: '.', filename: 'a.zip', size: 10, transfer: 'direct' });
    expect(result.mode).toBe('frps_chunked');
  });

  it('creates relay uploads inside the configured transfer folder', async () => {
    ensureFolderPath.mockClear();
    createFileUpload.mockClear();
    const service = new TransferService({ now: () => 1000, id: () => 'tr_1', authStatus: () => ({ configured: true, authorized: true }) } as any);
    await service.createUpload({ clientId: 'client-1', rootId: 'workspace', path: '.', filename: 'a.zip', size: 10, transfer: 'auto' });
    expect(ensureFolderPath).toHaveBeenCalledWith({ driveId: 'drive-1', folderPath: 'RemoteAgentGatewayTransfers' });
    expect(createFileUpload).toHaveBeenCalledWith(expect.objectContaining({ parentFileId: 'folder-1' }));
  });
});
