/**
 * 客户端 HTTP 服务的基础连接信息
 * @description 客户端本地启动的控制 HTTP 服务的地址和端口
 */
export interface ClientHttpInfo {
  /** 本地监听地址，默认 127.0.0.1 */
  localHost: string;
  /** 本地监听端口 */
  localPort: number;
  /** 协议类型，仅支持 HTTP */
  protocol: 'http';
}

/**
 * 客户端 HTTP 能力声明
 * @description 客户端向服务端注册时声明自身支持的功能
 */
export interface ClientHttpCapabilities {
  /** 是否支持 HTTP 控制面 */
  httpControl: boolean;
  /** 是否支持任务（命令/脚本）执行 */
  jobs: boolean;
  /** 是否支持 SSE 事件流 */
  sse: boolean;
  /** 是否支持文件管理 */
  files: boolean;
  /** 是否支持 FRP 端口映射 */
  frpMappings: boolean;
}

/**
 * 客户端 HTTP 控制面服务端协调结果
 * @description 服务端为客户端分配的 HTTP 控制通道信息
 */
export interface ClientHttpControl {
  /** 本地监听地址 */
  localHost: string;
  /** 本地监听端口 */
  localPort: number;
  /** 通过 FRP 暴露到公网的远程端口 */
  remotePort: number;
  /** 公网可访问的基础 URL */
  publicBaseUrl: string;
  /** 客户端 HTTP 鉴权 Token */
  token: string;
}

/**
 * 客户端 HTTP 就绪通知负载
 * @description 客户端 FRP 控制隧道建立成功后发送给服务端
 */
export interface ClientHttpReadyPayload {
  /** 客户端 ID */
  clientId: string;
  /** FRP 远程端口 */
  remotePort: number;
  /** 公网基础 URL */
  baseUrl: string;
}

/**
 * 客户端 HTTP 启动失败通知负载
 */
export interface ClientHttpFailedPayload {
  /** 客户端 ID */
  clientId: string;
  /** FRP 远程端口（可选，可能尚未分配） */
  remotePort?: number;
  /** 失败原因描述 */
  reason: string;
}

/** 任务状态枚举 */
export type ClientJobStatus = 'queued' | 'running' | 'success' | 'failed' | 'cancelled';
/** 任务类型枚举 */
export type ClientJobType = 'command' | 'script';

/**
 * 命令执行任务请求负载
 */
export interface ClientJobCommandPayload {
  /** 要执行的命令 */
  command: string;
  /** 命令参数列表 */
  args?: string[];
  /** 工作目录，默认使用客户端 workspace */
  cwd?: string;
  /** 超时时间（毫秒） */
  timeoutMs?: number;
  /** 额外环境变量 */
  env?: Record<string, string>;
}

/**
 * 脚本执行任务请求负载
 */
export interface ClientJobScriptPayload {
  /** 脚本运行时环境，默认 node */
  runtime?: 'node' | 'python' | 'bash' | 'powershell';
  /** 脚本正文内容 */
  script: string;
  /** 工作目录 */
  cwd?: string;
  /** 超时时间（毫秒） */
  timeoutMs?: number;
  /** 额外环境变量 */
  env?: Record<string, string>;
}

/**
 * 任务日志条目
 */
export interface ClientJobLogEntry {
  /** 日志序号，用于 SSE 的 last-event-id */
  seq: number;
  /** 输出流类型：标准输出或标准错误 */
  stream: 'stdout' | 'stderr';
  /** 日志内容 */
  content: string;
  /** 时间戳 */
  timestamp: number;
}

/**
 * FRP 映射创建请求负载
 */
export interface ClientFrpMappingCreatePayload {
  /** 映射名称 */
  name: string;
  /** 代理类型：TCP / HTTP / HTTPS */
  type: 'tcp' | 'http' | 'https';
  /** 本地服务地址 */
  localHost: string;
  /** 本地服务端口 */
  localPort: number;
  /** 远程端口（仅 TCP 类型需要，不指定则由服务端分配） */
  remotePort?: number | null;
  /** 自定义域名（HTTP/HTTPS 类型需要） */
  customDomain?: string;
}

/**
 * 客户端注册信息
 * @description 客户端通过 WebSocket 向服务端注册时携带的元信息
 */
export interface ClientInfo {
  /** 客户端唯一标识 */
  clientId: string;
  /** 客户端显示名称 */
  name: string;
  /** 主机名 */
  hostname?: string;
  /** 操作系统类型 */
  os?: string;
  /** CPU 架构 */
  arch?: string;
  /** 客户端版本号 */
  version?: string;
  /** 自定义标签列表 */
  tags?: string[];
  /** HTTP 服务连接信息 */
  http?: ClientHttpInfo;
  /** 客户端能力声明 */
  capabilities?: ClientHttpCapabilities;
}

/**
 * 客户端数据库记录
 * @description 服务端 SQLite 中存储的完整客户端信息
 */
export interface ClientRecord extends ClientInfo {
  /** 在线状态 */
  status: 'online' | 'offline';
  /** Token 哈希（安全存储） */
  tokenHash?: string;
  /** 最后通信时间 */
  lastSeenAt?: number;
  /** 创建时间 */
  createdAt: number;
  /** 更新时间 */
  updatedAt: number;
}

/**
 * 客户端文件系统条目
 * @description 客户端列出目录时返回的文件/目录信息
 */
export interface ClientFileEntry {
  /** 文件名 */
  name: string;
  /** 相对路径 */
  path: string;
  /** 类型 */
  type: 'file' | 'directory' | 'other';
  /** 文件大小（字节） */
  size: number;
  /** 最后修改时间（毫秒时间戳） */
  mtimeMs: number;
}

/**
 * 客户端文件状态信息
 */
export interface ClientFileStat {
  /** 相对路径 */
  path: string;
  /** 类型 */
  type: 'file' | 'directory' | 'other';
  /** 文件大小 */
  size: number;
  /** 最后修改时间 */
  mtimeMs: number;
  /** 创建时间 */
  ctimeMs: number;
}

/**
 * 客户端文件根目录
 * @description 安全限制的文件操作允许访问的根目录列表
 */
export interface ClientFileRoot {
  /** 根目录标识 */
  id: string;
  /** 显示标签 */
  label: string;
  /** 绝对路径 */
  path: string;
}

/** 仅包含 rootId 的请求负载 */
export interface ClientFileRootPayload {
  rootId: string;
}

/** 包含 rootId + 路径的请求负载 */
export interface ClientFileRootPathPayload {
  rootId: string;
  path: string;
}

/** 创建目录请求负载 */
export interface ClientFileRootMkdirPayload extends ClientFileRootPathPayload {
  recursive?: boolean;
}

/** 删除文件/目录请求负载 */
export interface ClientFileRootDeletePayload extends ClientFileRootPathPayload {
  recursive?: boolean;
}

/** 移动/重命名请求负载 */
export interface ClientFileRootMovePayload {
  rootId: string;
  from: string;
  to: string;
  overwrite?: boolean;
}

/** 复制请求负载 */
export interface ClientFileRootCopyPayload {
  rootId: string;
  from: string;
  to: string;
  overwrite?: boolean;
}

/**
 * 分片上传初始化请求负载
 */
export interface ClientFileUploadInitPayload {
  /** 根目录 ID */
  rootId: string;
  /** 目标路径（目录） */
  path: string;
  /** 文件名 */
  filename: string;
  /** 文件总大小（字节） */
  size: number;
  /** 分片大小，默认 8MB */
  chunkSize?: number;
  /** 文件最后修改时间 */
  lastModifiedMs?: number;
  /** 文件指纹，用于续传检测 */
  fingerprint?: string;
}

/**
 * 分片上传初始化结果
 */
export interface ClientFileUploadInitResult {
  /** 上传会话 ID */
  uploadId: string;
  /** 根目录 ID */
  rootId: string;
  /** 目标路径 */
  path: string;
  /** 文件名 */
  filename: string;
  /** 文件总大小 */
  size: number;
  /** 分片大小 */
  chunkSize: number;
  /** 总分片数 */
  partCount: number;
  /** 已上传的分片序号列表 */
  uploadedParts: number[];
  /** 已上传的字节数 */
  uploadedBytes: number;
  /** 是否为续传 */
  resumed: boolean;
}

/**
 * 分片上传状态查询结果
 */
export interface ClientFileUploadStatusResult extends ClientFileUploadInitResult {
  /** 会话过期时间 */
  expiresAt: number;
}

/**
 * 单个分片上传结果
 */
export interface ClientFileUploadPartResult {
  /** 上传会话 ID */
  uploadId: string;
  /** 分片序号 */
  partNumber: number;
  /** 分片大小 */
  size: number;
  /** 累计已上传字节数 */
  uploadedBytes: number;
}

/**
 * 分片上传完成结果
 */
export interface ClientFileUploadCompleteResult {
  /** 上传会话 ID */
  uploadId: string;
  /** 根目录 ID */
  rootId: string;
  /** 最终文件路径 */
  path: string;
  /** 最终文件大小 */
  size: number;
}

/**
 * 中止上传结果
 */
export interface ClientFileUploadAbortResult {
  /** 上传会话 ID */
  uploadId: string;
  /** 确认已删除 */
  deleted: true;
}

/**
 * 服务端文件仓库记录
 * @description 上传到服务端本地文件仓库的元信息
 */
export interface FileRecord {
  /** 记录 ID */
  id: string;
  /** 原始文件名 */
  originalName: string;
  /** 存储路径 */
  storedPath: string;
  /** 文件大小 */
  size?: number;
  /** SHA256 哈希 */
  sha256?: string;
  /** MIME 类型 */
  mimeType?: string;
  /** 创建时间 */
  createdAt: number;
}

/**
 * 端口映射记录
 * @description 服务端数据库中存储的 FRP 端口映射信息
 */
export interface PortMapping {
  /** 映射记录 ID */
  id: string;
  /** 所属客户端 ID */
  clientId: string;
  /** 映射名称 */
  name: string;
  /** 代理类型 */
  proxyType: 'tcp' | 'http' | 'https';
  /** 本地 IP 地址 */
  localIp: string;
  /** 本地端口 */
  localPort: number;
  /** FRP 远程端口 */
  remotePort?: number;
  /** 自定义域名 */
  customDomain?: string;
  /** 映射状态 */
  status: 'active' | 'inactive' | 'error';
  /** 公网访问 URL */
  publicUrl?: string;
  /** 创建时间 */
  createdAt: number;
  /** 更新时间 */
  updatedAt: number;
}

/**
 * 服务端审计日志条目
 */
export interface AuditLog {
  /** 记录 ID */
  id?: number;
  /** 操作者 */
  actor?: string;
  /** 操作类型 */
  action: string;
  /** 操作目标类型 */
  targetType?: string;
  /** 操作目标 ID */
  targetId?: string;
  /** 操作详情 */
  detail?: string;
  /** 创建时间 */
  createdAt: number;
}

/**
 * 客户端任务审计历史条目
 * @description 记录所有会改变状态的客户端操作（命令执行、文件操作、映射管理等）
 */
export interface ClientTaskHistoryItem {
  /** 记录唯一 ID */
  recordId: string;
  /** 所属客户端 ID */
  clientId: string;
  /** 客户端名称快照（客户端可能改名） */
  clientNameSnapshot?: string;
  /** 请求 ID */
  requestId: string;
  /** 关联的任务 ID（仅 job 类型操作） */
  jobId?: string | null;
  /** 资源类型 */
  resourceType: 'job' | 'file' | 'frp_mapping';
  /** 操作类型 */
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
  /** HTTP 请求方法 */
  method: string;
  /** 请求路径 */
  path: string;
  /** 操作目标 ID */
  targetId: string;
  /** 请求来源类型 */
  sourceType: 'web-console' | 'agent-api' | 'server-proxy' | 'direct-client-http' | 'unknown';
  /** 操作者 Token 类型 */
  actorType: 'admin-token' | 'agent-token' | 'client-token' | 'unknown-token';
  /** 操作者标识标签 */
  actorLabel: string;
  /** 查询参数摘要（脱敏后） */
  querySummary?: Record<string, unknown>;
  /** 请求摘要（脱敏后，不含敏感字段如 token、脚本正文） */
  requestSummary: Record<string, unknown>;
  /** 结果摘要 */
  resultSummary: Record<string, unknown>;
  /** 操作状态 */
  status: 'success' | 'failed' | 'cancelled';
  /** HTTP 响应状态码 */
  httpStatus: number;
  /** 开始时间 */
  startedAt: number;
  /** 结束时间 */
  finishedAt: number;
  /** 耗时（毫秒） */
  durationMs: number;
  /** 错误码 */
  errorCode?: string | null;
  /** 错误信息 */
  errorMessage?: string | null;
  /** 上报时间 */
  reportedAt: number;
  /** 服务端接收时间 */
  receivedAt?: number;
}

/** 文件传输模式：阿里云盘 / FRPS 分块传输 */
export type TransferMode = 'aliyundrive' | 'frps_chunked';

/** 文件传输状态机 */
export type TransferStatus =
  | 'created'              // 已创建
  | 'waiting_cli_upload'   // 等待 CLI 上传
  | 'cli_uploading'        // CLI 正在上传
  | 'aliyun_uploaded'      // 已上传到阿里云盘
  | 'waiting_client_download'  // 等待客户端下载
  | 'client_downloading'   // 客户端正在下载
  | 'completed'            // 传输完成
  | 'failed'               // 传输失败
  | 'cancelled';           // 已取消

/** 传输清理状态 */
export type TransferCleanupStatus = 'none' | 'cleanup_pending' | 'cleanup_done' | 'cleanup_failed';

/**
 * 服务端通知客户端开始下载的负载
 */
export interface ServerTransferDownloadStartPayload {
  /** 传输任务 ID */
  transferId: string;
  /** 目标客户端 ID */
  clientId: string;
}

/**
 * 客户端上报传输进度负载
 */
export interface ClientTransferProgressPayload {
  /** 传输任务 ID */
  transferId: string;
  /** 客户端 ID */
  clientId: string;
  /** 当前阶段 */
  phase: TransferStatus;
  /** 已下载字节数 */
  downloadedBytes?: number;
  /** 已写入字节数 */
  writtenBytes?: number;
  /** 总字节数 */
  totalBytes: number;
  /** 附加消息 */
  message?: string;
}

/**
 * 客户端传输完成负载
 */
export interface ClientTransferCompletePayload {
  /** 传输任务 ID */
  transferId: string;
  /** 客户端 ID */
  clientId: string;
  /** 根目录 ID */
  rootId: string;
  /** 文件路径 */
  path: string;
  /** 文件大小 */
  size: number;
}

/**
 * 客户端传输失败负载
 */
export interface ClientTransferFailedPayload {
  /** 传输任务 ID */
  transferId: string;
  /** 客户端 ID */
  clientId: string;
  /** 错误码 */
  errorCode: string;
  /** 错误描述 */
  errorMessage: string;
}

/**
 * 阿里云盘服务公开状态
 */
export interface AliyunDrivePublicStatus {
  /** 是否已配置 */
  configured: boolean;
  /** 是否已授权 */
  authorized: boolean;
  /** OAuth 客户端 ID */
  clientId?: string;
  /** 授权范围 */
  scope?: string;
  /** OpenAPI 基础地址 */
  openapiBase?: string;
  /** 回调地址 */
  redirectUri?: string;
  /** 传输文件夹 */
  transferFolder?: string;
  /** 清理 TTL（毫秒） */
  cleanupTtlMs?: number;
  /** Token 过期时间 */
  expiresAt?: number;
  /** 云盘 ID */
  driveId?: string;
  /** 授权账号名称 */
  authorizedAccountName?: string;
}

/**
 * 传输任务视图
 * @description 前端展示用的传输任务综合信息
 */
export interface TransferJobView {
  /** 传输任务 ID */
  id: string;
  /** 目标客户端 ID */
  clientId: string;
  /** 根目录 ID */
  rootId: string;
  /** 目标目录 */
  targetDir: string;
  /** 文件名 */
  filename: string;
  /** 文件总大小 */
  size: number;
  /** 传输模式 */
  mode: TransferMode;
  /** 当前状态 */
  status: TransferStatus;
  /** 清理状态 */
  cleanupStatus: TransferCleanupStatus;
  /** 已上传字节数 */
  uploadedBytes: number;
  /** 已下载字节数 */
  downloadedBytes: number;
  /** 已写入字节数 */
  writtenBytes: number;
  /** 总字节数 */
  totalBytes: number;
  /** 错误码 */
  errorCode?: string | null;
  /** 错误描述 */
  errorMessage?: string | null;
  /** 创建时间 */
  createdAt: number;
  /** 更新时间 */
  updatedAt: number;
  /** 完成时间 */
  completedAt?: number | null;
  /** 清理触发时间 */
  cleanupAfterAt?: number | null;
}

// ==================== 更新协议类型 ====================

export type UpdateTargetType = 'server' | 'client';
export type UpdatePlatform = 'linux' | 'windows';
export type UpdateChannel = 'stable' | 'beta';
export type UpdateInstallerType = 'archive' | 'binary';

export type ClientUpdatePhase =
  | 'queued'
  | 'dispatched'
  | 'downloading'
  | 'downloaded'
  | 'installing'
  | 'installed'
  | 'restarting'
  | 'verifying'
  | 'succeeded'
  | 'failed'
  | 'rolled_back'
  | 'offline_skipped'
  | 'cancelled';

export interface ReleaseArtifact {
  targetType: UpdateTargetType;
  platform: UpdatePlatform;
  arch: string;
  fileName: string;
  downloadPath: string;
  sha256: string;
  size: number;
  entrypoint: string;
  installerType: UpdateInstallerType;
  mandatory?: boolean;
  enabled: boolean;
}

export interface ReleaseManifest {
  version: string;
  releaseTime: string;
  notes: string;
  minUpdaterVersion: string;
  channel: UpdateChannel;
  compatibleFrom: string[];
  artifacts: ReleaseArtifact[];
}

export interface ClientUpdateCommandPayload {
  campaignId: string;
  targetId: string;
  attemptId: string;
  version: string;
  artifact: ReleaseArtifact;
  downloadUrl: string;
  expectedSha256: string;
  expectedSize: number;
}

export interface ClientUpdateStatusPayload {
  campaignId: string;
  targetId: string;
  attemptId: string;
  phase: ClientUpdatePhase;
  currentVersion: string;
  targetVersion: string;
  errorCode?: string;
  errorMessage?: string;
}
