import { randomUUID } from 'node:crypto';
import type { IncomingMessage } from 'node:http';
import type { ClientTaskAuditLocalRecord, TaskActionType, TaskStatus } from '@rag/shared';
import { resolveTaskAuditRequestContext } from './request-context.js';
import { summarizeTaskAudit } from './task-audit-redaction.js';
import type { TaskAuditStore } from './task-audit-store.js';
import type { JobAuditLifecycleManager } from './job-audit-lifecycle.js';
import { attachJobAuditLifecycle } from './job-audit-lifecycle.js';

export interface TaskAuditExecuteInput<T = unknown> {
  req: IncomingMessage;
  actionType: TaskActionType;
  resourceType: 'job' | 'file' | 'frp_mapping';
  method: string;
  path: string;
  payload?: Record<string, unknown>;
  run: () => Promise<{ httpStatus: number; resultSummary?: Record<string, unknown>; targetId?: string; status?: TaskStatus; body?: T }>;
}

export interface TaskAuditExecutor {
  execute<T>(input: TaskAuditExecuteInput<T>): Promise<T>;
}

export function createTaskAuditExecutor(options: {
  clientId: string;
  store: TaskAuditStore;
  reporter: { report(record: ClientTaskAuditLocalRecord): Promise<void> };
  jobManager?: JobAuditLifecycleManager;
}): TaskAuditExecutor {
  return {
    async execute<T>(input: TaskAuditExecuteInput<T>) {
      const context = resolveTaskAuditRequestContext(input.req);
      const startedAt = Date.now();
      let record: ClientTaskAuditLocalRecord | null = null;
      try {
        const result = await input.run();
        const summary = summarizeTaskAudit({
          actionType: input.actionType, method: input.method, path: input.path,
          payload: input.payload, result: result.resultSummary,
        });
        record = {
          recordId: `rec_${randomUUID().slice(0, 12)}`,
          clientId: options.clientId, requestId: context.requestId,
          resourceType: input.resourceType, actionType: input.actionType,
          method: input.method, path: input.path,
          targetId: result.targetId ?? summary.targetId,
          sourceType: context.sourceType, actorType: context.actorType,
          actorLabel: context.actorLabel, querySummary: {},
          requestSummary: summary.requestSummary,
          resultSummary: result.resultSummary ?? summary.resultSummary,
          status: result.status ?? 'success',
          httpStatus: result.httpStatus, startedAt,
          finishedAt: Date.now(), durationMs: Date.now() - startedAt,
          reportedAt: Date.now(), syncStatus: 'pending',
        };
        await options.store.append(record);
        void options.reporter.report(record);
        const jobId = typeof result.resultSummary?.jobId === 'string' ? result.resultSummary.jobId : undefined;
        if (options.jobManager && jobId && (input.actionType === 'job.command' || input.actionType === 'job.script')) {
          attachJobAuditLifecycle({
            recordId: record.recordId,
            jobId,
            manager: options.jobManager,
            store: options.store,
            reporter: options.reporter,
          });
        }
        return result.body as T;
      } catch (error) {
        const finishedAt = Date.now();
        const summary = summarizeTaskAudit({
          actionType: input.actionType, method: input.method, path: input.path,
          payload: input.payload, result: {},
        });
        record = {
          recordId: `rec_${randomUUID().slice(0, 12)}`,
          clientId: options.clientId, requestId: context.requestId,
          resourceType: input.resourceType, actionType: input.actionType,
          method: input.method, path: input.path,
          targetId: summary.targetId,
          sourceType: context.sourceType, actorType: context.actorType,
          actorLabel: context.actorLabel, querySummary: {},
          requestSummary: summary.requestSummary, resultSummary: {},
          status: 'failed', httpStatus: 500, startedAt, finishedAt,
          durationMs: finishedAt - startedAt,
          errorMessage: error instanceof Error ? error.message : String(error),
          reportedAt: finishedAt, syncStatus: 'pending',
        };
        await options.store.append(record);
        void options.reporter.report(record);
        throw error;
      }
    },
  };
}
