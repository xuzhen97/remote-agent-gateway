import { describe, expect, it, vi } from 'vitest';
import { createUpdateStatusHandler } from './update-status-handler.js';

describe('update status handler', () => {
  it('persists client update status and completes campaign when all targets are terminal', () => {
    const repo = {
      updateTargetPhase: vi.fn(),
      upsertAttemptPhase: vi.fn(),
      listTargets: vi.fn().mockReturnValue([
        { id: 'target_1', phase: 'failed' },
        { id: 'target_2', phase: 'succeeded' },
      ]),
      updateCampaignStatus: vi.fn(),
    };
    const saveDb = vi.fn();
    const handler = createUpdateStatusHandler({ repo, saveDb });

    handler.handle({
      campaignId: 'camp_1',
      targetId: 'target_1',
      attemptId: 'attempt_1',
      phase: 'failed',
      currentVersion: '1.0.0',
      targetVersion: '1.0.1',
      errorCode: 'INSTALL_FAILED',
      errorMessage: 'boom',
    });

    expect(repo.updateTargetPhase).toHaveBeenCalledWith('target_1', 'failed', 'INSTALL_FAILED', 'boom');
    expect(repo.upsertAttemptPhase).toHaveBeenCalledWith(expect.objectContaining({
      attemptId: 'attempt_1',
      targetId: 'target_1',
      phase: 'failed',
      terminal: true,
      errorCode: 'INSTALL_FAILED',
      errorMessage: 'boom',
    }));
    expect(repo.updateCampaignStatus).toHaveBeenCalledWith('camp_1', 'completed_with_errors');
    expect(saveDb).toHaveBeenCalledOnce();
  });

  it('does not complete campaign while any target is non-terminal', () => {
    const repo = {
      updateTargetPhase: vi.fn(),
      upsertAttemptPhase: vi.fn(),
      listTargets: vi.fn().mockReturnValue([
        { id: 'target_1', phase: 'downloading' },
        { id: 'target_2', phase: 'succeeded' },
      ]),
      updateCampaignStatus: vi.fn(),
    };
    const handler = createUpdateStatusHandler({ repo, saveDb: vi.fn() });

    handler.handle({
      campaignId: 'camp_1',
      targetId: 'target_1',
      attemptId: 'attempt_1',
      phase: 'downloading',
      currentVersion: '1.0.0',
      targetVersion: '1.0.1',
    });

    expect(repo.updateCampaignStatus).not.toHaveBeenCalled();
  });
});
