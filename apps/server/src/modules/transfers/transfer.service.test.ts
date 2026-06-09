import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const {
  sendToClientMock,
  requestClientHttpMock,
} = vi.hoisted(() => ({
  sendToClientMock: vi.fn(() => true),
  requestClientHttpMock: vi.fn(),
}));

vi.mock('../connections/connections.manager.js', () => ({
  connectionManager: { sendToClient: sendToClientMock, isOnline: vi.fn(() => true) },
}));

vi.mock('../client-http/client-http-admin.service.js', () => ({
  clientHttpAdminService: { request: requestClientHttpMock },
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

import { getDb, initDb } from '../../db/index.js';
import { TransferService } from './transfer.service.js';

describe('TransferService', () => {
  beforeAll(async () => { await initDb(); });

  beforeEach(() => {
    vi.clearAllMocks();
    getDb().run('DELETE FROM transfer_events');
    getDb().run('DELETE FROM transfer_jobs');
    sendToClientMock.mockReturnValue(true);
    requestClientHttpMock.mockResolvedValue({ status: 200, body: { ok: true, data: { queued: true } } });
  });

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

  it('falls back to client HTTP dispatch when websocket dispatch fails', async () => {
    sendToClientMock.mockReturnValue(false);
    const service = new TransferService({ now: () => 1000, id: () => 'tr_ws_fallback', authStatus: () => ({ configured: true, authorized: true }) } as any);
    await service.createUpload({ clientId: 'client-1', rootId: 'workspace', path: '.', filename: 'a.zip', size: 10, transfer: 'auto' });
    service.recordCliProgress('tr_ws_fallback', { uploadedBytes: 10, totalBytes: 10, currentPart: 1 });

    const job = await service.completeCliUpload('tr_ws_fallback');

    expect(requestClientHttpMock).toHaveBeenCalledWith('client-1', expect.objectContaining({
      method: 'POST',
      path: '/files/aliyundrive-download',
      body: { transferId: 'tr_ws_fallback' },
    }));
    expect(job?.status).toBe('waiting_client_download');
  });

  it('fails the transfer when websocket and client HTTP dispatch both fail', async () => {
    sendToClientMock.mockReturnValue(false);
    requestClientHttpMock.mockResolvedValue({ status: 502, body: { ok: false, error: { message: 'client http unreachable' } } });
    const service = new TransferService({ now: () => 1000, id: () => 'tr_dispatch_fail', authStatus: () => ({ configured: true, authorized: true }) } as any);
    await service.createUpload({ clientId: 'client-1', rootId: 'workspace', path: '.', filename: 'a.zip', size: 10, transfer: 'auto' });
    service.recordCliProgress('tr_dispatch_fail', { uploadedBytes: 10, totalBytes: 10, currentPart: 1 });

    await expect(service.completeCliUpload('tr_dispatch_fail')).rejects.toThrow('client http unreachable');
    expect(service.getTransfer('tr_dispatch_fail')?.status).toBe('failed');
  });
});
