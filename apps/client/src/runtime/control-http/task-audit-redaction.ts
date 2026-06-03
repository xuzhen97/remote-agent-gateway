import type { TaskActionType, ClientTaskAuditMirrorRecord } from '@rag/shared';
import { buildTaskAuditActionSummary } from './task-audit-actions.js';

export function summarizeTaskAudit(input: {
  actionType: TaskActionType;
  method: string;
  path: string;
  payload?: Record<string, unknown>;
  result?: Record<string, unknown>;
}): Pick<ClientTaskAuditMirrorRecord, 'requestSummary' | 'resultSummary' | 'targetId'> {
  return buildTaskAuditActionSummary(input);
}
