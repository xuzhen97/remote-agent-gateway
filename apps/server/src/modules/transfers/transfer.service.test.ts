import { describe, expect, it, vi } from 'vitest';

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

import { TransferService } from './transfer.service.js';

describe('TransferService', () => {
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
});
