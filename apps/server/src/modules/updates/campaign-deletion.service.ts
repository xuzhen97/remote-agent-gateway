import { CampaignNotFoundError } from './update-delete-errors.js';
import { assertCampaignDeletable } from './update-delete-policy.js';

export function createCampaignDeletionService(deps: {
  repo: {
    getCampaign(id: string): { id: string; status: string } | undefined;
    listTargets(campaignId: string): Array<{ id: string }>;
    deleteAttemptsByTargetIds(targetIds: string[]): number;
    deleteTargetsByCampaignIds(campaignIds: string[]): number;
    deleteCampaignsByIds(campaignIds: string[]): number;
    withTransaction<T>(fn: () => T): T;
  };
}) {
  return {
    deleteCampaign(input: { campaignId: string; force: boolean }) {
      const campaign = deps.repo.getCampaign(input.campaignId);
      if (!campaign) throw new CampaignNotFoundError(input.campaignId);
      assertCampaignDeletable({ status: campaign.status });

      const targets = deps.repo.listTargets(input.campaignId);
      const targetIds = targets.map((target) => target.id);

      return deps.repo.withTransaction(() => {
        const deletedAttemptCount = deps.repo.deleteAttemptsByTargetIds(targetIds);
        const deletedTargetCount = deps.repo.deleteTargetsByCampaignIds([input.campaignId]);
        deps.repo.deleteCampaignsByIds([input.campaignId]);
        return {
          campaignId: input.campaignId,
          force: input.force,
          deletedTargetCount,
          deletedAttemptCount,
        };
      });
    },
  };
}
