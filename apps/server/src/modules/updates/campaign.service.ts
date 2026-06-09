import type { UpdateCampaignRecord, UpdateTargetRecord, UpdateAttemptRecord } from './update-types.js';

function normalizePlatform(os: string | null | undefined): 'windows' | 'linux' {
  if (!os) return 'linux';
  const lower = os.toLowerCase();
  if (lower.startsWith('win')) return 'windows';
  return 'linux';
}

export interface CreateCampaignInput {
  targetVersion: string;
  includeServer: boolean;
  batchSize: number;
  maxConcurrency: number;
  createdBy: string;
  scope: Record<string, unknown>;
}

export interface CampaignService {
  createCampaign(input: CreateCampaignInput): { campaignId: string; targets: UpdateTargetRecord[] };
  retryTargets(campaignId: string, mode: 'failed' | 'offline_skipped' | 'all'): UpdateTargetRecord[];
  getCampaign(campaignId: string): UpdateCampaignRecord | undefined;
  listTargets(campaignId: string): UpdateTargetRecord[];
}

export function createCampaignService(deps: {
  releaseService: {
    resolveArtifact(version: string, match: { targetType: 'server' | 'client'; platform: 'windows' | 'linux'; arch: string }): unknown;
  };
  clientsService: {
    listClients(): Array<{ id: string; os?: string | null; arch?: string | null; status: string }>;
  };
  repo: {
    saveCampaign(record: UpdateCampaignRecord): void;
    saveTarget(record: UpdateTargetRecord): void;
    saveAttempt(record: UpdateAttemptRecord): void;
    getCampaign(id: string): UpdateCampaignRecord | undefined;
    listTargets(campaignId: string): UpdateTargetRecord[];
    getTarget(id: string): UpdateTargetRecord | undefined;
  };
  now: () => number;
  id: () => string;
}): CampaignService {
  return {
    createCampaign(input: CreateCampaignInput) {
      const now = deps.now();
      const campaignId = deps.id();
      const targets: UpdateTargetRecord[] = [];

      // Precheck: server artifact (linux/x64)
      if (input.includeServer) {
        deps.releaseService.resolveArtifact(input.targetVersion, {
          targetType: 'server',
          platform: 'linux',
          arch: 'x64',
        });
      }

      // Precheck: one artifact per unique client platform/arch
      const clients = deps.clientsService.listClients();
      const seen = new Set<string>();
      for (const client of clients) {
        const platform = normalizePlatform(client.os);
        const arch = client.arch ?? 'x64';
        const key = `${platform}/${arch}`;
        if (!seen.has(key)) {
          deps.releaseService.resolveArtifact(input.targetVersion, {
            targetType: 'client',
            platform,
            arch,
          });
          seen.add(key);
        }
      }

      // Persist campaign
      const campaign: UpdateCampaignRecord = {
        id: campaignId,
        targetVersion: input.targetVersion,
        scopeJson: JSON.stringify(input.scope),
        includeServer: input.includeServer,
        batchSize: input.batchSize,
        maxConcurrency: input.maxConcurrency,
        status: 'draft',
        createdBy: input.createdBy,
        createdAt: now,
        updatedAt: now,
      };
      deps.repo.saveCampaign(campaign);

      // Persist server target
      if (input.includeServer) {
        const serverTarget: UpdateTargetRecord = {
          id: `${campaignId}_server`,
          campaignId,
          targetType: 'server',
          platform: 'linux',
          currentVersion: null,
          targetVersion: input.targetVersion,
          phase: 'queued',
          attemptCount: 0,
          createdAt: now,
          updatedAt: now,
        };
        deps.repo.saveTarget(serverTarget);
        targets.push(serverTarget);
      }

      // Persist client targets
      for (const client of clients) {
        const platform = normalizePlatform(client.os);
        const clientTarget: UpdateTargetRecord = {
          id: `${campaignId}_${client.id}`,
          campaignId,
          targetType: 'client',
          clientId: client.id,
          platform,
          currentVersion: null,
          targetVersion: input.targetVersion,
          phase: client.status === 'online' ? 'queued' : 'offline_skipped',
          attemptCount: 0,
          createdAt: now,
          updatedAt: now,
        };
        deps.repo.saveTarget(clientTarget);
        targets.push(clientTarget);
      }

      return { campaignId, targets };
    },

    retryTargets(campaignId: string, mode: 'failed' | 'offline_skipped' | 'all') {
      const allTargets = deps.repo.listTargets(campaignId);
      const match = mode === 'all'
        ? (t: UpdateTargetRecord) => t.phase === 'failed' || t.phase === 'offline_skipped' || t.phase === 'rolled_back'
        : (t: UpdateTargetRecord) => t.phase === (mode === 'failed' ? 'failed' || t.phase === 'rolled_back' : 'offline_skipped');
      const toRetry = allTargets.filter(match);
      for (const t of toRetry) {
        deps.repo.saveTarget({
          ...t,
          phase: 'queued',
          attemptCount: t.attemptCount,
          updatedAt: deps.now(),
        });
      }
      return toRetry;
    },

    getCampaign(campaignId: string) {
      return deps.repo.getCampaign(campaignId);
    },

    listTargets(campaignId: string) {
      return deps.repo.listTargets(campaignId);
    },
  };
}
