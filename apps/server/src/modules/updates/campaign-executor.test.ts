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

  it('does not mark campaign completed while client targets are only dispatched', async () => {
    const updateCampaignStatus = vi.fn();
    const updateTargetPhase = vi.fn();
    let targetPhase = 'queued';
    const executor = createCampaignExecutor({
      repo: {
        getCampaign: () => ({ id: 'camp_1', targetVersion: '1.0.1', status: 'draft', includeServer: false }),
        listTargets: () => [{ id: 'target_1', campaignId: 'camp_1', targetType: 'client', clientId: 'client-1', phase: targetPhase, platform: 'windows' }],
        updateCampaignStatus,
        updateTargetPhase: (id: string, phase: string) => {
          updateTargetPhase(id, phase);
          targetPhase = phase;
        },
      },
      releaseService: { resolveArtifact: () => ({ fileName: 'rag-client-v1.0.1-windows-x64.zip', sha256: 'abc', size: 10 }) },
      baseUrl: 'http://server:3000',
      connectionManager: {
        getOnlineClientIds: () => ['client-1'],
        sendToClient: () => true,
      },
    } as any);

    const result = await executor.start('camp_1');

    expect(result.phase).toBe('client_updating');
    expect(updateCampaignStatus).toHaveBeenCalledWith('camp_1', 'client_updating');
    expect(updateCampaignStatus).not.toHaveBeenCalledWith('camp_1', 'completed');
    expect(updateTargetPhase).toHaveBeenCalledWith('target_1', 'dispatched');
  });
});
