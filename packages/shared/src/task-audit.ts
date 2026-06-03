import { z } from 'zod';

export const TaskResourceTypeSchema = z.enum(['job', 'file', 'frp_mapping']);
export const TaskActionTypeSchema = z.enum([
  'job.command',
  'job.script',
  'job.cancel',
  'file.write',
  'file.upload',
  'file.mkdir',
  'file.delete',
  'file.move',
  'file.copy',
  'frp_mapping.create',
  'frp_mapping.delete',
]);
export const TaskStatusSchema = z.enum(['success', 'failed', 'cancelled']);
export const TaskSourceTypeSchema = z.enum(['web-console', 'agent-api', 'server-proxy', 'direct-client-http', 'unknown']);
export const TaskActorTypeSchema = z.enum(['admin-token', 'agent-token', 'client-token', 'unknown-token']);
export const TaskSyncStatusSchema = z.enum(['pending', 'synced', 'sync_failed']);

export const TaskSummaryJsonSchema = z.record(z.string(), z.unknown());

export const ClientTaskAuditMirrorRecordSchema = z.object({
  recordId: z.string().min(1),
  clientId: z.string().min(1),
  clientNameSnapshot: z.string().optional(),
  requestId: z.string().min(1),
  jobId: z.string().optional().nullable(),
  resourceType: TaskResourceTypeSchema,
  actionType: TaskActionTypeSchema,
  method: z.string().min(1),
  path: z.string().min(1),
  targetId: z.string().min(1),
  sourceType: TaskSourceTypeSchema,
  actorType: TaskActorTypeSchema,
  actorLabel: z.string().min(1),
  querySummary: TaskSummaryJsonSchema.optional(),
  requestSummary: TaskSummaryJsonSchema,
  resultSummary: TaskSummaryJsonSchema,
  status: TaskStatusSchema,
  httpStatus: z.number().int(),
  startedAt: z.number().int(),
  finishedAt: z.number().int(),
  durationMs: z.number().int().min(0),
  errorCode: z.string().optional().nullable(),
  errorMessage: z.string().optional().nullable(),
  reportedAt: z.number().int(),
  receivedAt: z.number().int().optional(),
});

export const ClientTaskAuditLocalRecordSchema = ClientTaskAuditMirrorRecordSchema.extend({
  syncStatus: TaskSyncStatusSchema,
  syncedAt: z.number().int().optional().nullable(),
  syncError: z.string().optional().nullable(),
  metadata: TaskSummaryJsonSchema.optional(),
});

export const TaskHistoryQuerySchema = z.object({
  clientId: z.string().min(1).optional(),
  status: TaskStatusSchema.optional(),
  resourceType: TaskResourceTypeSchema.optional(),
  actionType: TaskActionTypeSchema.optional(),
  sourceType: TaskSourceTypeSchema.optional(),
  keyword: z.string().min(1).optional(),
  from: z.coerce.number().int().optional(),
  to: z.coerce.number().int().optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
});

export type ClientTaskAuditMirrorRecord = z.infer<typeof ClientTaskAuditMirrorRecordSchema>;
export type ClientTaskAuditLocalRecord = z.infer<typeof ClientTaskAuditLocalRecordSchema>;
export type TaskHistoryQuery = z.infer<typeof TaskHistoryQuerySchema>;
