import { ClientUpdateStatusPayloadSchema } from '@rag/shared';
import { summarizeTargets, transitionCampaignStatus } from './update-state.js';

const TERMINAL_PHASES = new Set(['succeeded', 'failed', 'rolled_back', 'offline_skipped', 'cancelled']);

export interface UpdateStatusRepository {
  updateTargetPhase(id: string, phase: string, errorCode?: string | null, errorMessage?: string | null): void;
  upsertAttemptPhase(input: {
    attemptId: string;
    targetId: string;
    phase: string;
    payload: unknown;
    terminal: boolean;
    errorCode?: string | null;
    errorMessage?: string | null;
  }): void;
  listTargets(campaignId: string): Array<{ phase: string }>;
  updateCampaignStatus(id: string, status: string): void;
}

export function createUpdateStatusHandler(deps: { repo: UpdateStatusRepository; saveDb: () => void }) {
  return {
    handle(payload: unknown): void {
      const parsed = ClientUpdateStatusPayloadSchema.parse(payload);
      const isTerminal = TERMINAL_PHASES.has(parsed.phase);

      deps.repo.updateTargetPhase(
        parsed.targetId,
        parsed.phase,
        parsed.errorCode ?? null,
        parsed.errorMessage ?? null,
      );
      deps.repo.upsertAttemptPhase({
        attemptId: parsed.attemptId,
        targetId: parsed.targetId,
        phase: parsed.phase,
        payload: parsed,
        terminal: isTerminal,
        errorCode: parsed.errorCode ?? null,
        errorMessage: parsed.errorMessage ?? null,
      });

      const targets = deps.repo.listTargets(parsed.campaignId);
      if (targets.length > 0 && targets.every((target) => TERMINAL_PHASES.has(target.phase))) {
        deps.repo.updateCampaignStatus(parsed.campaignId, transitionCampaignStatus(summarizeTargets(targets)));
      }

      deps.saveDb();
    },
  };
}
