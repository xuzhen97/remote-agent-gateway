import { z } from 'zod';

export const ClientHttpInfoSchema = z.object({
  localHost: z.string().min(1).default('127.0.0.1'),
  localPort: z.number().int().min(1).max(65535),
  protocol: z.literal('http').default('http'),
});

export const ClientHttpCapabilitiesSchema = z.object({
  httpControl: z.boolean(),
  jobs: z.boolean(),
  sse: z.boolean(),
  files: z.boolean(),
  frpMappings: z.boolean(),
});

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

export const ClientHeartbeatPayloadSchema = z.object({
  clientId: z.string().min(1),
  cpu: z.number().optional(),
  memory: z.number().optional(),
  uptime: z.number().optional(),
});

const RelativeClientPathSchema = z.string().min(1).max(2048).refine((value) => {
  const normalized = value.replace(/\\/g, '/');
  if (normalized.startsWith('/')) return false;
  if (/^[A-Za-z]:\//.test(normalized)) return false;
  return !normalized.split('/').some((part) => part === '..');
}, 'Path must be relative and stay inside client workspace');

const ClientFileRootIdSchema = z.string().min(1).max(128);

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

export const FrpConnectionInfoSchema = z.object({
  serverAddr: z.string().min(1),
  serverPort: z.number().int().min(1).max(65535),
  authToken: z.string().min(1),
});

export const ClientHttpControlSchema = z.object({
  localHost: z.string().min(1),
  localPort: z.number().int().min(1).max(65535),
  remotePort: z.number().int().min(1).max(65535),
  publicBaseUrl: z.string().url(),
  token: z.string().min(16),
});

export const ServerAckPayloadSchema = z.object({
  message: z.string().min(1),
  frp: FrpConnectionInfoSchema.optional(),
  httpControl: ClientHttpControlSchema.optional(),
});

export const ClientHttpReadyPayloadSchema = z.object({
  clientId: z.string().min(1),
  remotePort: z.number().int().min(1).max(65535),
  baseUrl: z.string().url(),
});

export const ClientHttpFailedPayloadSchema = z.object({
  clientId: z.string().min(1),
  remotePort: z.number().int().min(1).max(65535).optional(),
  reason: z.string().min(1),
});

export const ClientJobCommandPayloadSchema = z.object({
  command: z.string().min(1),
  args: z.array(z.string()).optional().default([]),
  cwd: z.string().optional(),
  timeoutMs: z.number().int().positive().max(1_800_000).optional(),
  env: z.record(z.string()).optional(),
});

export const ClientJobScriptPayloadSchema = z.object({
  runtime: z.enum(['node', 'python', 'bash', 'powershell']).optional().default('node'),
  script: z.string().min(1).max(1_000_000),
  cwd: z.string().optional(),
  timeoutMs: z.number().int().positive().max(1_800_000).optional(),
  env: z.record(z.string()).optional(),
});

export const ClientFrpMappingCreatePayloadSchema = z.object({
  name: z.string().min(1).max(128),
  type: z.enum(['tcp', 'http', 'https']),
  localHost: z.string().min(1).default('127.0.0.1'),
  localPort: z.number().int().min(1).max(65535),
  remotePort: z.number().int().min(1).max(65535).nullable().optional(),
  customDomain: z.string().optional(),
});
