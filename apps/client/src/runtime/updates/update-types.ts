export type ClientUpdatePhase =
  | 'queued'
  | 'dispatched'
  | 'downloading'
  | 'downloaded'
  | 'installing'
  | 'installed'
  | 'restarting'
  | 'verifying'
  | 'succeeded'
  | 'failed'
  | 'rolled_back'
  | 'offline_skipped'
  | 'cancelled';

export interface ClientUpdateInput {
  campaignId: string;
  targetId: string;
  attemptId: string;
  version: string;
  downloadUrl: string;
  expectedSha256: string;
  expectedSize: number;
}

export interface ClientUpdateResult {
  phase: ClientUpdatePhase;
  errorCode?: string;
  errorMessage?: string;
}
