// Task type enum
export const TASK_TYPES = [
  'health_check',
  'exec_script',
  'exec_command',
  'push_file',
  'frp_create_proxy',
  'frp_remove_proxy',
  'frpc_start',
  'frpc_stop',
  'file_service_start',
  'file_service_stop',
  'file_service_status',
] as const;
export type TaskType = (typeof TASK_TYPES)[number];

// Task status enum
export const TASK_STATUSES = [
  'pending',
  'dispatched',
  'running',
  'success',
  'failed',
  'cancelled',
] as const;
export type TaskStatus = (typeof TASK_STATUSES)[number];

// Client info
export interface ClientInfo {
  clientId: string;
  name: string;
  hostname?: string;
  os?: string;
  arch?: string;
  version?: string;
  tags?: string[];
}

// Client record (DB)
export interface ClientRecord extends ClientInfo {
  status: 'online' | 'offline';
  tokenHash?: string;
  lastSeenAt?: number;
  createdAt: number;
  updatedAt: number;
}

// Task payloads
export interface ExecScriptPayload {
  runtime?: 'node' | 'python' | 'bash';
  script: string;
  timeoutMs?: number;
}

export interface ExecCommandPayload {
  command: string;
  args?: string[];
  cwd?: string;
  timeoutMs?: number;
}

export interface PushFilePayload {
  fileId: string;
  targetPath: string;
  fileName: string;
}

export interface FrpCreateProxyPayload {
  mappingId: string;
  name: string;
  proxyType: 'tcp' | 'http' | 'https';
  localIp: string;
  localPort: number;
  remotePort: number;
  customDomain?: string;
  /** frps server address (IP or hostname) */
  serverAddr: string;
  /** frps bind port (default 7000) */
  serverPort: number;
  /** frps auth token */
  authToken: string;
}

export interface FrpRemoveProxyPayload {
  mappingId: string;
}

export interface FrpcStartPayload {
  // empty — just start the frpc daemon
}

export interface FrpcStopPayload {
  // empty — just stop the frpc daemon
}

export interface HealthCheckPayload {
  // empty
}

export interface FileServiceStartPayload {
  port?: number;
  token: string;
  ttlMs?: number;
}

export interface FileServiceStopPayload {
  // empty
}

export interface FileServiceStatusPayload {
  // empty
}

export interface FileServiceStartResult {
  running: true;
  host: '127.0.0.1';
  port: number;
  startedAt: number;
  expiresAt?: number;
}

export interface FileServiceStatusResult {
  running: boolean;
  host: '127.0.0.1';
  port?: number;
  startedAt?: number;
  uptimeMs?: number;
  expiresAt?: number;
}

export interface ClientFileEntry {
  name: string;
  path: string;
  type: 'file' | 'directory' | 'other';
  size: number;
  mtimeMs: number;
}

export interface ClientFileStat {
  path: string;
  type: 'file' | 'directory' | 'other';
  size: number;
  mtimeMs: number;
  ctimeMs: number;
}

export interface ClientFileRoot {
  id: string;
  label: string;
  path: string;
}

export interface ClientFileRootPayload {
  rootId: string;
}

export interface ClientFileRootPathPayload {
  rootId: string;
  path: string;
}

export interface ClientFileRootMkdirPayload extends ClientFileRootPathPayload {
  recursive?: boolean;
}

export interface ClientFileRootDeletePayload extends ClientFileRootPathPayload {
  recursive?: boolean;
}

export interface ClientFileRootMovePayload {
  rootId: string;
  from: string;
  to: string;
  overwrite?: boolean;
}

export interface ClientFileRootCopyPayload {
  rootId: string;
  from: string;
  to: string;
  overwrite?: boolean;
}

export type TaskPayloadMap = {
  health_check: HealthCheckPayload;
  exec_script: ExecScriptPayload;
  exec_command: ExecCommandPayload;
  push_file: PushFilePayload;
  frp_create_proxy: FrpCreateProxyPayload;
  frp_remove_proxy: FrpRemoveProxyPayload;
  frpc_start: FrpcStartPayload;
  frpc_stop: FrpcStopPayload;
  file_service_start: FileServiceStartPayload;
  file_service_stop: FileServiceStopPayload;
  file_service_status: FileServiceStatusPayload;
};

// Task record (DB)
export interface TaskRecord<T extends TaskType = TaskType> {
  id: string;
  clientId: string;
  type: T;
  status: TaskStatus;
  payload: TaskPayloadMap[T];
  result?: unknown;
  error?: string;
  createdBy?: string;
  createdAt: number;
  startedAt?: number;
  finishedAt?: number;
}

// Task log
export interface TaskLog {
  id?: number;
  taskId: string;
  stream: 'stdout' | 'stderr';
  content: string;
  createdAt: number;
}

// File record
export interface FileRecord {
  id: string;
  originalName: string;
  storedPath: string;
  size?: number;
  sha256?: string;
  mimeType?: string;
  createdAt: number;
}

// Port mapping
export interface PortMapping {
  id: string;
  clientId: string;
  name: string;
  proxyType: 'tcp' | 'http' | 'https';
  localIp: string;
  localPort: number;
  remotePort?: number;
  customDomain?: string;
  status: 'active' | 'inactive' | 'error';
  publicUrl?: string;
  createdAt: number;
  updatedAt: number;
}

// Audit log
export interface AuditLog {
  id?: number;
  actor?: string;
  action: string;
  targetType?: string;
  targetId?: string;
  detail?: string;
  createdAt: number;
}
