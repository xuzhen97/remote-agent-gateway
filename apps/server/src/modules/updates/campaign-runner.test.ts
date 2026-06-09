import { describe, it, expect, vi } from 'vitest';
import { createCampaignRunner } from './campaign-runner.js';

describe('campaign runner', () => {
  it('recovers a server_updating campaign and resumes client rollout', async () => {
    const repo = {
      listRecoverableCampaigns: () => [{ id: 'camp_1', status: 'server_updating', targetVersion: 'v1.4.0' }],
      listTargets: () => [],
      updateCampaignStatus: vi.fn(),
    };

    const runner = createCampaignRunner({
      repo,
      runServerUpdate: vi.fn().mockResolvedValue(undefined),
      verifyServerVersion: () => 'v1.4.0',
    } as any);
    await runner.recoverPendingCampaigns();
    expect(repo.updateCampaignStatus).toHaveBeenCalledWith('camp_1', 'client_updating');
  });

  it('skips recovery when server version does not match', async () => {
    const repo = {
      listRecoverableCampaigns: () => [{ id: 'camp_1', status: 'server_updating', targetVersion: 'v1.4.0' }],
      listTargets: () => [],
      updateCampaignStatus: vi.fn(),
    };

    const runner = createCampaignRunner({
      repo,
      runServerUpdate: vi.fn(),
      verifyServerVersion: () => '0.1.0', // not the target version
    } as any);
    await runner.recoverPendingCampaigns();
    expect(repo.updateCampaignStatus).not.toHaveBeenCalledWith('camp_1', 'client_updating');
  });
});
