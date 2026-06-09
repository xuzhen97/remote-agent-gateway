import { describe, expect, it, vi } from 'vitest';
import { handleUpdateWsMessage } from './update-ws-handler.js';

describe('update ws handler', () => {
  it('handles server.update.run and emits client.update.status', async () => {
    const send = vi.fn();
    const handled = await handleUpdateWsMessage({
      message: {
        type: 'server.update.run',
        payload: {
          campaignId: 'camp_1',
          targetId: 'target_1',
          attemptId: 'att_1',
          version: 'v1.4.0',
        },
      },
      updater: { run: vi.fn().mockResolvedValue({ phase: 'verifying' }) },
      send,
      currentVersion: '0.1.0',
    } as any);

    expect(handled).toBe(true);
    expect(send).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'client.update.status',
        payload: expect.objectContaining({
          campaignId: 'camp_1',
          phase: 'downloading',
          currentVersion: '0.1.0',
          targetVersion: 'v1.4.0',
        }),
      }),
    );
  });

  it('ignores non-update messages', async () => {
    const send = vi.fn();
    const handled = await handleUpdateWsMessage({
      message: { type: 'server.job.run', payload: {} },
      send,
    } as any);

    expect(handled).toBe(false);
    expect(send).not.toHaveBeenCalled();
  });
});
