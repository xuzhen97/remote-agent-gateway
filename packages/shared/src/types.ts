export interface ClientHttpInfo {
  localHost: string;
  localPort: number;
  protocol: 'http';
}

export interface ClientHttpCapabilities {
  httpControl: boolean;
  jobs: boolean;
  sse: boolean;
  files: boolean;
  frpMappings: boolean;
}

export interface ClientHttpControl {
  localHost: string;
  localPort: number;
  remotePort: number;
  publicBaseUrl: string;
  token: string;
}

export interface ClientHttpReadyPayload {
  clientId: string;
  remotePort: number;
  baseUrl: string;
}

export interface ClientHttpFailedPayload {
  clientId: string;
  remotePort?: number;
  reason: string;
}

export type ClientJobStatus = 'queued' | 'running' | 'success' | 'failed' | 'cancelled';
export type ClientJobType = 'command' | 'script';

export interface ClientJobCommandPayload {
  command: string;
  args?: string[];
  cwd?: string;
  timeoutMs?: number;
  env?: Record<string, string>;
}

export interface ClientJobScriptPayload {
  runtime?: 'node' | 'python' | 'bash' | 'powershell';
  script: string;
  cwd?: string;
  timeoutMs?: number;
  env?: Record<string, string>;
}

export interface ClientJobLogEntry {
  seq: number;
  stream: 'stdout' | 'stderr';
  content: string;
  timestamp: number;
}

export interface ClientFrpMappingCreatePayload {
  name: string;
  type: 'tcp' | 'http' | 'https';
  localHost: string;
  localPort: number;
  remotePort?: number | null;
  customDomain?: string;
}

export interface ClientInfo {
  clientId: string;
  name: string;
  hostname?: string;
  os?: string;
  arch?: string;
  version?: string;
  tags?: string[];
  http?: ClientHttpInfo;
  capabilities?: ClientHttpCapabilities;
}

export interface ClientRecord extends ClientInfo {
  status: 'online' | 'offline';
  tokenHash?: string;
  lastSeenAt?: number;
  createdAt: number;
  updatedAt: number;
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

export interface FileRecord {
  id: string;
  originalName: string;
  storedPath: string;
  size?: number;
  sha256?: string;
  mimeType?: string;
  createdAt: number;
}

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

export interface AuditLog {
  id?: number;
  actor?: string;
  action: string;
  targetType?: string;
  targetId?: string;
  detail?: string;
  createdAt: number;
}

export interface ClientTaskHistoryItem {
  recordId: string;
  clientId: string;
  clientNameSnapshot?: string;
  requestId: string;
  jobId?: string | null;
  resourceType: 'job' | 'file' | 'frp_mapping';
  actionType:
    | 'job.command'
    | 'job.script'
    | 'job.cancel'
    | 'file.write'
    | 'file.upload'
    | 'file.mkdir'
    | 'file.delete'
    | 'file.move'
    | 'file.copy'
    | 'frp_mapping.create'
    | 'frp_mapping.delete';
  method: string;
  path: string;
  targetId: string;
  sourceType: 'web-console' | 'agent-api' | 'server-proxy' | 'direct-client-http' | 'unknown';
  actorType: 'admin-token' | 'agent-token' | 'client-token' | 'unknown-token';
  actorLabel: string;
  querySummary?: Record<string, unknown>;
  requestSummary: Record<string, unknown>;
  resultSummary: Record<string, unknown>;
  status: 'success' | 'failed' | 'cancelled';
  httpStatus: number;
  startedAt: number;
  finishedAt: number;
  durationMs: number;
  errorCode?: string | null;
  errorMessage?: string | null;
  reportedAt: number;
  receivedAt?: number;
}
