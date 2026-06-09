import type { ServerUpdater } from './server-updater.js';

export function createCampaignRunner(deps: {
  repo: {
    listRecoverableCampaigns(): Array<{ id: string; status: string; targetVersion: string }>;
    listTargets(campaignId: string): Array<{ id: string; phase: string; targetType: string }>;
    updateCampaignStatus(id: string, status: string): void;
  };
  runServerUpdate: ServerUpdater['run'];
  verifyServerVersion(): string;
}): {
  recoverPendingCampaigns(): Promise<void>;
} {
  return {
    async recoverPendingCampaigns() {
      const recoverable = deps.repo.listRecoverableCampaigns();
      for (const campaign of recoverable) {
        if (campaign.status === 'server_updating') {
          const currentVersion = deps.verifyServerVersion();
          if (currentVersion === campaign.targetVersion) {
            deps.repo.updateCampaignStatus(campaign.id, 'client_updating');
          }
        }
      }
    },
  };
}
