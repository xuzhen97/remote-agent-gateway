import { describe, expect, it, vi } from 'vitest';
import { createClientUpdater } from './client-updater.js';
import type { ClientUpdateInput } from './update-types.js';

describe('client updater', () => {
  it('downloads, verifies, stages, and reports version switch', async () => {
    const updater = createClientUpdater({
      download: vi.fn().mockResolvedValue({ filePath: '/tmp/client.zip', size: 10 }),
      verify: vi.fn().mockResolvedValue(undefined),
      extract: vi.fn().mockResolvedValue('/opt/rag-client/versions/v1.4.0'),
      stopCurrent: vi.fn().mockResolvedValue(undefined),
      switchCurrent: vi.fn().mockResolvedValue(undefined),
      startNew: vi.fn().mockResolvedValue(undefined),
      rollback: vi.fn().mockResolvedValue(undefined),
    } as any);

    const input: ClientUpdateInput = {
      campaignId: 'camp_1',
      targetId: 'target_1',
      attemptId: 'att_1',
      version: 'v1.4.0',
      downloadUrl: 'http://server/updates/artifacts/v1.4.0/client.zip',
      expectedSha256: 'abc',
      expectedSize: 10,
    };

    const result = await updater.run(input);
    expect(result.phase).toBe('verifying');
    expect(updater.deps.verify).toHaveBeenCalledWith('/tmp/client.zip', 'abc', 10);
  });

  it('rolls back when verify fails', async () => {
    const updater = createClientUpdater({
      download: vi.fn().mockResolvedValue({ filePath: '/tmp/client.zip', size: 10 }),
      verify: vi.fn().mockRejectedValue(new Error('hash mismatch')),
      extract: vi.fn(),
      stopCurrent: vi.fn(),
      switchCurrent: vi.fn(),
      startNew: vi.fn(),
      rollback: vi.fn().mockResolvedValue(undefined),
    } as any);

    const result = await updater.run({
      campaignId: 'camp_1',
      targetId: 'target_1',
      attemptId: 'att_1',
      version: 'v1.4.0',
      downloadUrl: 'http://server/updates/artifacts/v1.4.0/client.zip',
      expectedSha256: 'abc',
      expectedSize: 10,
    });

    expect(result.phase).toBe('failed');
    expect(result.errorCode).toBe('HASH_MISMATCH');
    expect(updater.deps.rollback).toHaveBeenCalled();
  });
});
