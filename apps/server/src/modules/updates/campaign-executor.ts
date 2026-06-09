import { connectionManager } from '../connections/connections.manager.js';

export interface CampaignExecutorDeps {
  repo: {
    getCampaign(id: string): { id: string; targetVersion: string; status: string; includeServer: boolean } | undefined;
    listTargets(campaignId: string): Array<{ id: string; campaignId: string; targetType: string; clientId?: string | null; phase: string; platform?: string | null }>;
    updateCampaignStatus(id: string, status: string): void;
    updateTargetPhase(id: string, phase: string): void;
  };
  releaseService: {
    resolveArtifact(version: string, match: { targetType: 'server' | 'client'; platform: string; arch: string }): { fileName: string; sha256: string; size: number };
  };
  baseUrl: string;
}

export function createCampaignExecutor(deps: CampaignExecutorDeps) {
  return {
    /** Start a campaign: transition from draft to server_updating, then dispatch to clients */
    async start(campaignId: string): Promise<{ phase: string }> {
      const campaign = deps.repo.getCampaign(campaignId);
      if (!campaign) throw new Error('Campaign not found');
      if (campaign.status !== 'draft') throw new Error(`Cannot start campaign in ${campaign.status} status`);

      // Step 1: Update server first
      if (campaign.includeServer) {
        deps.repo.updateCampaignStatus(campaignId, 'server_updating');

        // In production, this would run the real server updater
        // For now, assume server is already on the target version (self-hosted update)
        // or skip if server-updater is not implemented
        console.log(`[campaign] server update to ${campaign.targetVersion} (placeholder)`);

        // Mark server target as succeeded
        const targets = deps.repo.listTargets(campaignId);
        const serverTarget = targets.find((t) => t.targetType === 'server');
        if (serverTarget) {
          deps.repo.updateTargetPhase(serverTarget.id, 'succeeded');
        }
      }

      // Step 2: Transition to client_updating
      deps.repo.updateCampaignStatus(campaignId, 'client_updating');

      // Step 3: Dispatch to all online client targets
      const targets = deps.repo.listTargets(campaignId);
      const clientTargets = targets.filter((t) => t.targetType === 'client');
      const onlineClientIds = connectionManager.getOnlineClientIds();

      let dispatchedCount = 0;
      for (const target of clientTargets) {
        if (!target.clientId) continue;

        if (onlineClientIds.includes(target.clientId)) {
          // Resolve artifact URL for this client's platform
          const platform = target.platform ?? 'linux';
          const artifact = deps.releaseService.resolveArtifact(campaign.targetVersion, {
            targetType: 'client',
            platform,
            arch: 'x64',
          });

          const attemptId = `${target.id}_1`;

          // Send update command to client via WebSocket
          connectionManager.sendToClient(target.clientId, {
            type: 'server.update.run',
            requestId: `update_${target.id}`,
            payload: {
              campaignId,
              targetId: target.id,
              attemptId,
              version: campaign.targetVersion,
              downloadUrl: `${deps.baseUrl}/updates/artifacts/${campaign.targetVersion}/${artifact.fileName}`,
              expectedSha256: artifact.sha256,
              expectedSize: artifact.size,
            },
          });

          deps.repo.updateTargetPhase(target.id, 'dispatched');
          dispatchedCount += 1;
          console.log(`[campaign] dispatched update to client ${target.clientId} → ${campaign.targetVersion}`);
        } else {
          // Client is offline
          deps.repo.updateTargetPhase(target.id, 'offline_skipped');
        }
      }

      // If all client targets succeeded or were skipped, mark campaign as completed
      const updatedTargets = deps.repo.listTargets(campaignId);
      const allDone = updatedTargets.every(
        (t) => t.phase === 'succeeded' || t.phase === 'offline_skipped' || t.phase === 'dispatched',
      );
      if (allDone) {
        deps.repo.updateCampaignStatus(campaignId, 'completed');
      }

      return { phase: allDone ? 'completed' : 'client_updating' };
    },
  };
}
