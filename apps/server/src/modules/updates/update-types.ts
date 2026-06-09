export interface UpdateReleaseRecord {
  version: string;
  manifestJson: string;
  enabled: boolean;
  createdAt: number;
  updatedAt: number;
}

export interface UpdateCampaignRecord {
  id: string;
  targetVersion: string;
  scopeJson: string;
  includeServer: boolean;
  batchSize: number;
  maxConcurrency: number;
  status: string;
  createdBy: string;
  createdAt: number;
  updatedAt: number;
}

export interface UpdateTargetRecord {
  id: string;
  campaignId: string;
  targetType: string;
  clientId?: string | null;
  platform?: string | null;
  currentVersion?: string | null;
  targetVersion: string;
  phase: string;
  attemptCount: number;
  lastErrorCode?: string | null;
  lastErrorMessage?: string | null;
  createdAt: number;
  updatedAt: number;
  finishedAt?: number | null;
}

export interface UpdateAttemptRecord {
  id: string;
  targetId: string;
  attemptNo: number;
  phaseTimelineJson: string;
  result: string;
  errorCode?: string | null;
  errorMessage?: string | null;
  createdAt: number;
  updatedAt: number;
  finishedAt?: number | null;
}
