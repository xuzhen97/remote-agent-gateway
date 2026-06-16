import {
  CampaignActiveNotDeletableError,
  ReleaseInUseError,
  ReleaseReferencedByActiveCampaignError,
} from './update-delete-errors.js';

const ACTIVE_CAMPAIGN_STATUSES = new Set(['server_updating', 'client_updating']);

export function isActiveCampaignStatus(status: string): boolean {
  return ACTIVE_CAMPAIGN_STATUSES.has(status);
}

export function assertCampaignDeletable(input: { status: string }): void {
  if (isActiveCampaignStatus(input.status)) {
    throw new CampaignActiveNotDeletableError(input.status);
  }
}

export function assertReleaseDeletionAllowed(input: {
  activeReferences: number;
  inactiveReferences: number;
  force: boolean;
}): void {
  if (input.activeReferences > 0) {
    throw new ReleaseReferencedByActiveCampaignError(input.activeReferences);
  }
  if (!input.force && input.inactiveReferences > 0) {
    throw new ReleaseInUseError(input.inactiveReferences);
  }
}
