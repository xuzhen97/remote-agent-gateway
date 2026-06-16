export class UpdateDeleteDomainError extends Error {
  constructor(
    message: string,
    public readonly code:
      | 'CAMPAIGN_NOT_FOUND'
      | 'CAMPAIGN_ACTIVE_NOT_DELETABLE'
      | 'RELEASE_NOT_FOUND'
      | 'RELEASE_IN_USE'
      | 'RELEASE_REFERENCED_BY_ACTIVE_CAMPAIGN'
      | 'DELETE_CONSISTENCY_FAILED',
    public readonly statusCode: number,
    public readonly details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = new.target.name;
  }
}

export class CampaignNotFoundError extends UpdateDeleteDomainError {
  constructor(campaignId: string) {
    super(`Campaign ${campaignId} not found`, 'CAMPAIGN_NOT_FOUND', 404, { campaignId });
  }
}

export class CampaignActiveNotDeletableError extends UpdateDeleteDomainError {
  constructor(status: string) {
    super(`Campaign is active in status ${status}`, 'CAMPAIGN_ACTIVE_NOT_DELETABLE', 409, { status });
  }
}

export class ReleaseNotFoundError extends UpdateDeleteDomainError {
  constructor(version: string) {
    super(`Release ${version} not found`, 'RELEASE_NOT_FOUND', 404, { version });
  }
}

export class ReleaseInUseError extends UpdateDeleteDomainError {
  constructor(referenceCount: number) {
    super('Release is referenced by existing campaigns', 'RELEASE_IN_USE', 409, { referenceCount, canForce: true });
  }
}

export class ReleaseReferencedByActiveCampaignError extends UpdateDeleteDomainError {
  constructor(referenceCount: number) {
    super(
      'Release is referenced by active campaigns',
      'RELEASE_REFERENCED_BY_ACTIVE_CAMPAIGN',
      409,
      { referenceCount, canForce: false },
    );
  }
}

export class DeleteConsistencyFailedError extends UpdateDeleteDomainError {
  constructor(message: string, details?: Record<string, unknown>) {
    super(message, 'DELETE_CONSISTENCY_FAILED', 500, details);
  }
}
