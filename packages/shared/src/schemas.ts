/** @file 运行时校验规则（Zod Schema） */
import { z } from 'zod';

/** 客户端 HTTP 服务连接信息校验 */
export const ClientHttpInfoSchema = z.object({
  localHost: z.string().min(1).default('127.0.0.1'),
  localPort: z.number().int().min(1).max(65535),
  protocol: z.literal('http').default('http'),
});

/** 客户端能力声明校验 */
export const ClientHttpCapabilitiesSchema = z.object({
  httpControl: z.boolean(),
  jobs: z.boolean(),
  sse: z.boolean(),
  files: z.boolean(),
  frpMappings: z.boolean(),
});

/** 客户端注册消息校验 */
export const ClientRegisterPayloadSchema = z.object({
  clientId: z.string().min(1).max(64),
  name: z.string().min(1).max(128),
  hostname: z.string().optional(),
  os: z.string().optional(),
  arch: z.string().optional(),
  version: z.string().optional(),
  tags: z.array(z.string()).optional(),
  http: ClientHttpInfoSchema.optional(),
  capabilities: ClientHttpCapabilitiesSchema.optional(),
});

/** 客户端心跳消息校验 */
export const ClientHeartbeatPayloadSchema = z.object({
  clientId: z.string().min(1),
  cpu: z.number().optional(),
  memory: z.number().optional(),
  uptime: z.number().optional(),
});

/**
 * 相对路径校验
 * @description 禁止绝对路径、Windows 盘符路径和父目录回溯（..）
 */
const RelativeClientPathSchema = z.string().min(1).max(2048).refine((value) => {
  const normalized = value.replace(/\\/g, '/');
  if (normalized.startsWith('/')) return false;          // 禁止绝对路径
  if (/^[A-Za-z]:\//.test(normalized)) return false;    // 禁止 Windows 盘符路径
  return !normalized.split('/').some((part) => part === '..'); // 禁止父目录回溯
}, '路径必须是相对路径且在客户端工作区内');

/** 文件根目录 ID 校验 */
const ClientFileRootIdSchema = z.string().min(1).max(128);

// ====== 旧版文件操作负载校验（不使用 rootId 的版本）======

export const ClientFilePathPayloadSchema = z.object({
  path: RelativeClientPathSchema,
});

export const ClientFileMkdirPayloadSchema = z.object({
  path: RelativeClientPathSchema,
  recursive: z.boolean().optional().default(true),
});

export const ClientFileDeletePayloadSchema = z.object({
  path: RelativeClientPathSchema,
  recursive: z.boolean().optional().default(false),
});

export const ClientFileMovePayloadSchema = z.object({
  from: RelativeClientPathSchema,
  to: RelativeClientPathSchema,
  overwrite: z.boolean().optional().default(false),
});

export const ClientFileCopyPayloadSchema = z.object({
  from: RelativeClientPathSchema,
  to: RelativeClientPathSchema,
  overwrite: z.boolean().optional().default(false),
});

export const ClientFileWriteQuerySchema = z.object({
  path: RelativeClientPathSchema,
});

// ====== 新版文件操作负载校验（带 rootId 的版本）======

export const ClientFileRootPayloadSchema = z.object({
  rootId: ClientFileRootIdSchema,
});

export const ClientFileRootPathPayloadSchema = z.object({
  rootId: ClientFileRootIdSchema,
  path: RelativeClientPathSchema,
});

export const ClientFileRootMkdirPayloadSchema = z.object({
  rootId: ClientFileRootIdSchema,
  path: RelativeClientPathSchema,
  recursive: z.boolean().optional().default(true),
});

export const ClientFileRootDeletePayloadSchema = z.object({
  rootId: ClientFileRootIdSchema,
  path: RelativeClientPathSchema,
  recursive: z.boolean().optional().default(false),
});

export const ClientFileRootMovePayloadSchema = z.object({
  rootId: ClientFileRootIdSchema,
  from: RelativeClientPathSchema,
  to: RelativeClientPathSchema,
  overwrite: z.boolean().optional().default(false),
});

export const ClientFileRootCopyPayloadSchema = z.object({
  rootId: ClientFileRootIdSchema,
  from: RelativeClientPathSchema,
  to: RelativeClientPathSchema,
  overwrite: z.boolean().optional().default(false),
});

/** FRP 连接信息校验 */
export const FrpConnectionInfoSchema = z.object({
  serverAddr: z.string().min(1),
  serverPort: z.number().int().min(1).max(65535),
  authToken: z.string().min(1),
});

/** 服务端下发给客户端的 HTTP 控制面协调结果校验 */
export const ClientHttpControlSchema = z.object({
  localHost: z.string().min(1),
  localPort: z.number().int().min(1).max(65535),
  remotePort: z.number().int().min(1).max(65535),
  publicBaseUrl: z.string().url(),
  token: z.string().min(16),
});

/** 服务端 ACK 消息校验 */
export const ServerAckPayloadSchema = z.object({
  message: z.string().min(1),
  frp: FrpConnectionInfoSchema.optional(),          // FRP 连接配置
  httpControl: ClientHttpControlSchema.optional(),  // HTTP 控制面协调信息
});

/** 客户端 HTTP 就绪通知校验 */
export const ClientHttpReadyPayloadSchema = z.object({
  clientId: z.string().min(1),
  remotePort: z.number().int().min(1).max(65535),
  baseUrl: z.string().url(),
});

/** 客户端 HTTP 启动失败通知校验 */
export const ClientHttpFailedPayloadSchema = z.object({
  clientId: z.string().min(1),
  remotePort: z.number().int().min(1).max(65535).optional(),
  reason: z.string().min(1),
});

/** 命令执行任务请求校验（超时上限 30 分钟） */
export const ClientJobCommandPayloadSchema = z.object({
  command: z.string().min(1),
  args: z.array(z.string()).optional().default([]),
  cwd: z.string().optional(),
  timeoutMs: z.number().int().positive().max(1_800_000).optional(),  // 最多 30 分钟
  env: z.record(z.string()).optional(),
});

/** 脚本执行任务请求校验（脚本正文最多 1MB，超时上限 30 分钟） */
export const ClientJobScriptPayloadSchema = z.object({
  runtime: z.enum(['node', 'python', 'bash', 'powershell']).optional().default('node'),
  script: z.string().min(1).max(1_000_000),
  cwd: z.string().optional(),
  timeoutMs: z.number().int().positive().max(1_800_000).optional(),  // 最多 30 分钟
  env: z.record(z.string()).optional(),
});

/** FRP 映射创建请求校验 */
export const ClientFrpMappingCreatePayloadSchema = z.object({
  name: z.string().min(1).max(128),
  type: z.enum(['tcp', 'http', 'https']),
  localHost: z.string().min(1).default('127.0.0.1'),
  localPort: z.number().int().min(1).max(65535),
  remotePort: z.number().int().min(1).max(65535).nullable().optional(),
  customDomain: z.string().optional(),
});

/** 传输状态枚举校验 */
export const TransferStatusSchema = z.enum([
  'created',               // 已创建
  'waiting_cli_upload',    // 等待 CLI 上传
  'cli_uploading',         // CLI 正在上传
  'aliyun_uploaded',       // 已上传到阿里云盘
  'waiting_client_download', // 等待客户端下载
  'client_downloading',    // 客户端正在下载
  'completed',              // 传输完成
  'failed',                 // 传输失败
  'cancelled',              // 已取消
]);

/** 服务端通知客户端下载启动校验 */
export const ServerTransferDownloadStartPayloadSchema = z.object({
  transferId: z.string().min(1).max(128),
  clientId: z.string().min(1).max(128),
});

/** 客户端传输进度上报校验 */
export const ClientTransferProgressPayloadSchema = z.object({
  transferId: z.string().min(1).max(128),
  clientId: z.string().min(1).max(128),
  phase: TransferStatusSchema,
  downloadedBytes: z.number().int().min(0).optional(),
  writtenBytes: z.number().int().min(0).optional(),
  totalBytes: z.number().int().min(0),
  message: z.string().max(512).optional(),
});

/** 客户端传输完成上报校验 */
export const ClientTransferCompletePayloadSchema = z.object({
  transferId: z.string().min(1).max(128),
  clientId: z.string().min(1).max(128),
  rootId: ClientFileRootIdSchema,
  path: RelativeClientPathSchema,
  size: z.number().int().min(0),
});

/** 客户端传输失败上报校验 */
export const ClientTransferFailedPayloadSchema = z.object({
  transferId: z.string().min(1).max(128),
  clientId: z.string().min(1).max(128),
  errorCode: z.string().min(1).max(128),
  errorMessage: z.string().min(1).max(2048),
});

export {
  TaskResourceTypeSchema,
  TaskActionTypeSchema,
  TaskStatusSchema,
  TaskSourceTypeSchema,
  TaskActorTypeSchema,
  TaskSyncStatusSchema,
  TaskSummaryJsonSchema,
  ClientTaskAuditMirrorRecordSchema,
  ClientTaskAuditLocalRecordSchema,
  TaskHistoryQuerySchema,
} from './task-audit.js';
