import { connectionManager } from '../connections/connections.manager.js';

export interface CampaignExecutorDeps {
  repo: {
    getCampaign(id: string): { id: string; targetVersion: string; status: string; includeServer: boolean } | undefined;
    listTargets(campaignId: string): Array<{ id: string; campaignId: string; targetType: string; clientId?: string | null; phase: string; platform?: string | null }>;
    updateCampaignStatus(id: string, status: string): void;
    updateTargetPhase(id: string, phase: string): void;
  };
  connectionManager?: {
    getOnlineClientIds(): string[];
    sendToClient(clientId: string, message: unknown): boolean;
  };
  releaseService: {
    resolveArtifact(version: string, match: { targetType: 'server' | 'client'; platform: string; arch: string }): { fileName: string; sha256: string; size: number };
  };
  serverUpdater?: {
    run(input: { campaignId: string; targetId: string; attemptId: string; version: string; downloadUrl: string; expectedSha256: string; expectedSize: number }): Promise<void>;
  };
  baseUrl: string;
  allowServerSelfUpdate?: boolean;
}

const terminalPhases = new Set(['succeeded', 'failed', 'rolled_back', 'offline_skipped', 'cancelled']);

function currentServerPlatform(): 'windows' | 'linux' {
  return process.platform === 'win32' ? 'windows' : 'linux';
}

function currentServerArch(): string {
  return process.arch === 'x64' || process.arch === 'arm64' ? process.arch : 'x64';
}

export function createCampaignExecutor(deps: CampaignExecutorDeps) {
  async function dispatchClients(campaignId: string): Promise<{ phase: string }> {
    const campaign = deps.repo.getCampaign(campaignId);
    if (!campaign) throw new Error('Campaign not found');

    deps.repo.updateCampaignStatus(campaignId, 'client_updating');
    const targets = deps.repo.listTargets(campaignId);
    const clientTargets = targets.filter((t) => t.targetType === 'client');
    const connections = deps.connectionManager ?? connectionManager;
    const onlineClientIds = connections.getOnlineClientIds();

    for (const target of clientTargets) {
      if (!target.clientId) continue;
      if (!onlineClientIds.includes(target.clientId)) {
        deps.repo.updateTargetPhase(target.id, 'offline_skipped');
        continue;
      }

      const platform = target.platform ?? 'linux';
      const artifact = deps.releaseService.resolveArtifact(campaign.targetVersion, {
        targetType: 'client',
        platform,
        arch: 'x64',
      });
      const attemptId = `${target.id}_${target.phase === 'queued' ? 1 : Date.now()}`;
      const sent = connections.sendToClient(target.clientId, {
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

      if (sent) {
        deps.repo.updateTargetPhase(target.id, 'dispatched');
        console.log(`[campaign] dispatched update to client ${target.clientId} → ${campaign.targetVersion}`);
      } else {
        deps.repo.updateTargetPhase(target.id, 'offline_skipped');
      }
    }

    const updatedTargets = deps.repo.listTargets(campaignId);
    const allDone = updatedTargets.length > 0 && updatedTargets.every((t) => terminalPhases.has(t.phase));
    if (allDone) deps.repo.updateCampaignStatus(campaignId, 'completed');
    return { phase: allDone ? 'completed' : 'client_updating' };
  }

  return {
    dispatchClients,

    /** Start a campaign: transition from draft to server_updating, then dispatch to clients */
    async start(campaignId: string): Promise<{ phase: string }> {
      const campaign = deps.repo.getCampaign(campaignId);
      if (!campaign) throw new Error('Campaign not found');
      if (campaign.status !== 'draft') throw new Error(`Cannot start campaign in ${campaign.status} status`);

      if (!campaign.includeServer) return dispatchClients(campaignId);

      if (!deps.allowServerSelfUpdate || !deps.serverUpdater) {
        throw new Error('Server self-update is not implemented yet. Start a client-only campaign or deploy the server manually.');
      }

      deps.repo.updateCampaignStatus(campaignId, 'server_updating');
      const targets = deps.repo.listTargets(campaignId);
      const serverTarget = targets.find((t) => t.targetType === 'server');
      if (!serverTarget) throw new Error('Server update target not found');
      const artifact = deps.releaseService.resolveArtifact(campaign.targetVersion, {
        targetType: 'server',
        platform: currentServerPlatform(),
        arch: currentServerArch(),
      });
      const attemptId = `${serverTarget.id}_1`;
      await deps.serverUpdater.run({
        campaignId,
        targetId: serverTarget.id,
        attemptId,
        version: campaign.targetVersion,
        downloadUrl: `${deps.baseUrl}/updates/artifacts/${campaign.targetVersion}/${artifact.fileName}`,
        expectedSha256: artifact.sha256,
        expectedSize: artifact.size,
      });
      return { phase: 'server_updating' };
    },
  };
}
