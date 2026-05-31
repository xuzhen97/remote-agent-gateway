import { z } from 'zod';
import { TASK_TYPES, TASK_STATUSES } from './types.js';

// Enums
export const TaskTypeSchema = z.enum(TASK_TYPES);
export const TaskStatusSchema = z.enum(TASK_STATUSES);

// Client
export const ClientRegisterPayloadSchema = z.object({
  clientId: z.string().min(1).max(64),
  name: z.string().min(1).max(128),
  hostname: z.string().optional(),
  os: z.string().optional(),
  arch: z.string().optional(),
  version: z.string().optional(),
  tags: z.array(z.string()).optional(),
});

// Task payloads
export const ExecScriptPayloadSchema = z.object({
  runtime: z.enum(['node', 'python', 'bash']).optional().default('node'),
  script: z.string().min(1).max(1_000_000), // 1MB max
  timeoutMs: z.number().int().positive().max(300_000).optional().default(60_000),
});

export const ExecCommandPayloadSchema = z.object({
  command: z.string().min(1),
  args: z.array(z.string()).optional(),
  cwd: z.string().optional(),
  timeoutMs: z.number().int().positive().max(300_000).optional().default(60_000),
});

export const PushFilePayloadSchema = z.object({
  fileId: z.string().min(1),
  targetPath: z.string().min(1),
  fileName: z.string().min(1),
});

export const FrpCreateProxyPayloadSchema = z.object({
  mappingId: z.string().min(1),
  name: z.string().min(1).max(128),
  proxyType: z.enum(['tcp', 'http', 'https']),
  localIp: z.string().min(1),
  localPort: z.number().int().min(1).max(65535),
  remotePort: z.number().int().min(1).max(65535),
  customDomain: z.string().optional(),
});

export const FrpRemoveProxyPayloadSchema = z.object({
  mappingId: z.string().min(1),
});

export const HealthCheckPayloadSchema = z.object({});

const RelativeClientPathSchema = z.string().min(1).max(2048).refine((value) => {
  const normalized = value.replace(/\\/g, '/');
  if (normalized.startsWith('/')) return false;
  if (/^[A-Za-z]:\//.test(normalized)) return false;
  return !normalized.split('/').some((part) => part === '..');
}, 'Path must be relative and stay inside client workspace');

export const FileServiceStartPayloadSchema = z.object({
  port: z.number().int().min(0).max(65535).optional().default(0),
  token: z.string().min(16).max(256),
  ttlMs: z.number().int().positive().max(24 * 60 * 60 * 1000).optional(),
});

export const FileServiceStopPayloadSchema = z.object({});
export const FileServiceStatusPayloadSchema = z.object({});

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

// Create task request
export const CreateTaskPayloadSchema = z.object({
  clientId: z.string().min(1),
  type: TaskTypeSchema,
  payload: z.record(z.unknown()),
});

// WebSocket message schemas
export const ClientHeartbeatPayloadSchema = z.object({
  clientId: z.string().min(1),
  cpu: z.number().optional(),
  memory: z.number().optional(),
  uptime: z.number().optional(),
});

export const TaskLogPayloadSchema = z.object({
  taskId: z.string().min(1),
  stream: z.enum(['stdout', 'stderr']),
  content: z.string(),
});

export const TaskResultPayloadSchema = z.object({
  taskId: z.string().min(1),
  status: TaskStatusSchema,
  result: z.unknown().optional(),
  error: z.string().optional(),
});

// Port mapping
export const CreatePortMappingPayloadSchema = z.object({
  clientId: z.string().min(1),
  name: z.string().min(1).max(128),
  proxyType: z.enum(['tcp', 'http', 'https']),
  localIp: z.string().min(1),
  localPort: z.number().int().min(1).max(65535),
  remotePort: z.number().int().min(1).max(65535).optional(),
  customDomain: z.string().optional(),
});

// Agent API schemas
export const AgentRunScriptPayloadSchema = z.object({
  target: z.object({
    clientId: z.string().min(1),
  }),
  script: z.string().min(1).max(1_000_000),
  timeoutMs: z.number().int().positive().max(300_000).optional().default(60_000),
});

export const AgentPushFilePayloadSchema = z.object({
  clientId: z.string().min(1),
  fileId: z.string().min(1),
  targetPath: z.string().min(1),
});

export const AgentOpenPortPayloadSchema = z.object({
  clientId: z.string().min(1),
  name: z.string().min(1).max(128),
  localPort: z.number().int().min(1).max(65535),
  remotePort: z.number().int().min(1).max(65535).optional(),
  type: z.enum(['tcp', 'http', 'https']).default('tcp'),
});

export const AgentClosePortPayloadSchema = z.object({
  mappingId: z.string().min(1),
});
