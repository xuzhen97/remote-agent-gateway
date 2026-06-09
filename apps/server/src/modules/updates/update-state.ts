export interface TargetSummary {
  succeeded: number;
  failed: number;
  offlineSkipped: number;
  total: number;
}

export function summarizeTargets(targets: Array<{ phase: string }>): TargetSummary {
  return targets.reduce(
    (acc, target) => {
      if (target.phase === 'succeeded') acc.succeeded += 1;
      else if (target.phase === 'failed' || target.phase === 'rolled_back') acc.failed += 1;
      else if (target.phase === 'offline_skipped') acc.offlineSkipped += 1;
      acc.total += 1;
      return acc;
    },
    { succeeded: 0, failed: 0, offlineSkipped: 0, total: 0 },
  );
}

export function transitionCampaignStatus(summary: TargetSummary): string {
  if (summary.failed > 0 || summary.offlineSkipped > 0) {
    return 'completed_with_errors';
  }
  return 'completed';
}
