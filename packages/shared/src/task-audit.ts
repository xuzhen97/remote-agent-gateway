/** @file 任务审计相关的 Zod 校验规则和 TypeScript 类型 */
import { z } from 'zod';

/** 受审计的资源类型：任务、文件、FRP 映射 */
export const TaskResourceTypeSchema = z.enum(['job', 'file', 'frp_mapping']);

/** 受审计的操作类型 */
export const TaskActionTypeSchema = z.enum([
  'job.command',      // 执行命令
  'job.script',       // 执行脚本
  'job.cancel',       // 取消任务
  'file.write',       // 写入文件
  'file.upload',      // 分片上传完成
  'file.mkdir',       // 创建目录
  'file.delete',      // 删除文件/目录
  'file.move',        // 移动/重命名
  'file.copy',        // 复制
  'frp_mapping.create',  // 创建 FRP 映射
  'frp_mapping.delete',  // 删除 FRP 映射
]);

/** 操作状态 */
export const TaskStatusSchema = z.enum(['success', 'failed', 'cancelled']);

/** 请求来源类型 */
export const TaskSourceTypeSchema = z.enum(['web-console', 'agent-api', 'server-proxy', 'direct-client-http', 'unknown']);

/** 操作者身份类型 */
export const TaskActorTypeSchema = z.enum(['admin-token', 'agent-token', 'client-token', 'unknown-token']);

/** 审计记录同步状态 */
export const TaskSyncStatusSchema = z.enum(['pending', 'synced', 'sync_failed']);

/** JSON 摘要字段 Schema */
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

export type TaskActionType = z.infer<typeof TaskActionTypeSchema>;
export type TaskStatus = z.infer<typeof TaskStatusSchema>;
export type TaskResourceType = z.infer<typeof TaskResourceTypeSchema>;
export type TaskSourceType = z.infer<typeof TaskSourceTypeSchema>;
export type TaskActorType = z.infer<typeof TaskActorTypeSchema>;
export type TaskSyncStatus = z.infer<typeof TaskSyncStatusSchema>;
export type ClientTaskAuditMirrorRecord = z.infer<typeof ClientTaskAuditMirrorRecordSchema>;
export type ClientTaskAuditLocalRecord = z.infer<typeof ClientTaskAuditLocalRecordSchema>;
export type TaskHistoryQuery = z.infer<typeof TaskHistoryQuerySchema>;
