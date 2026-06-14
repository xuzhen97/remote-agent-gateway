import { describe, expect, it, vi } from 'vitest';
import { createCampaignExecutor } from './campaign-executor.js';

describe('campaign executor', () => {
  it('rejects server self-update until server updater is implemented', async () => {
    const executor = createCampaignExecutor({
      repo: {
        getCampaign: () => ({ id: 'camp_1', targetVersion: '1.0.1', status: 'draft', includeServer: true }),
        listTargets: () => [{ id: 'camp_1_server', campaignId: 'camp_1', targetType: 'server', phase: 'queued' }],
        updateCampaignStatus: vi.fn(),
        updateTargetPhase: vi.fn(),
      },
      releaseService: { resolveArtifact: vi.fn() },
      baseUrl: 'http://server:3000',
      allowServerSelfUpdate: false,
    } as any);

    await expect(executor.start('camp_1')).rejects.toThrow('Server self-update is not implemented');
  });
});
