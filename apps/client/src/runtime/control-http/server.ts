/** @file 客户端 HTTP 控制服务
 *
 * 创建并管理客户端的本地 HTTP 控制服务。
 * 该服务提供 Job API（命令/脚本执行）、File API（文件管理）、
 * FRP Mapping API（端口映射管理）和 Transfer API（文件传输）。
 *
 * 生命周期：
 * 1. 客户端启动时使用 bootstrap-token 启动
 * 2. 收到服务端 ACK 后，使用协调后的正式 token 重启
 * 3. 任务审计系统自动记录所有会改变状态的操作
 */
import * as http from 'node:http';
import { once } from 'node:events';
import { ControlHttpRouter } from './router.js';
import { requireBearerToken } from './auth.js';
import { sendJson, sendOk, sendError, setCorsHeaders } from './response.js';
import { registerJobRoutes } from './job-routes.js';
import { JobManager } from './job-manager.js';
import { registerFileRoutes } from './file-routes.js';
import { registerFrpRoutes } from './frp-routes.js';
import { registerTransferRoutes } from './transfer-routes.js';
import { createTaskAuditStore } from './task-audit-store.js';
import { createTaskAuditReporter } from './task-audit-reporter.js';
import { createTaskAuditExecutor } from './task-audit.js';

/** 启动选项 */
interface StartOptions {
  clientId: string;
  host: string;
  port: number;
  token: string;               // 鉴权 Token（引导期使用 bootstrap-token）
  workspaceDir: string;        // 工作目录
  allowedRoots: string[];      // 文件操作允许的根目录
  apiBaseUrl?: string;         // 服务端 API 地址（用于审计上报）
  serverToken?: string;        // 服务端 Token（用于审计上报鉴权）
  frpcPath?: string;
  frpcWorkDir?: string;
  job: { maxConcurrent: number; defaultTimeoutMs: number; maxTimeoutMs: number; logBufferLines: number };
  taskAuditStorePath?: string;
}

/** 控制 HTTP 服务状态 */
export interface ControlHttpServerState {
  running: true;
  host: string;
  port: number;
  startedAt: number;
}

let activeServer: http.Server | null = null;
let activeState: ControlHttpServerState | null = null;
let activeJobManager: JobManager | null = null;

/**
 * 启动 HTTP 控制服务
 * 会先停止已有服务（幂等）
 */
export async function startControlHttpServer(options: StartOptions): Promise<ControlHttpServerState> {
  await stopControlHttpServer();

  // 创建路由器和任务管理器
  const router = new ControlHttpRouter();
  const jobManager = new JobManager({
    maxConcurrent: options.job.maxConcurrent,
    defaultTimeoutMs: options.job.defaultTimeoutMs,
    maxTimeoutMs: options.job.maxTimeoutMs,
    logBufferLines: options.job.logBufferLines,
    workspaceDir: options.workspaceDir,
  });
  activeJobManager = jobManager;

  // 注册基础路由
  router.add('GET', /^\/ping$/, (_req, res) => sendJson(res, 200, { ok: true }));
  router.add('GET', /^\/health$/, (req, res) => {
    if (!requireBearerToken(req, res, options.token)) return;
    sendOk(res, { clientId: options.clientId, status: 'ready', version: '0.1.0', httpReady: true, frpcRunning: false });
  });

  // 初始化任务审计系统
  const store = createTaskAuditStore(options.taskAuditStorePath ?? '.rag/task-audit.jsonl');
  const reporter = createTaskAuditReporter({
    apiBaseUrl: options.apiBaseUrl,
    serverToken: options.serverToken,
    clientName: options.clientId,
    store,
  });
  const audit = createTaskAuditExecutor({ clientId: options.clientId, store, reporter, jobManager });

  // 注册业务路由（都带有审计包装）
  registerJobRoutes(router, jobManager, options.token, audit, { clientId: options.clientId });
  registerFileRoutes(router, { token: options.token, workspaceDir: options.workspaceDir, allowedRoots: options.allowedRoots, clientId: options.clientId }, audit);
  registerFrpRoutes(router, {
    token: options.token,
    clientId: options.clientId,
    apiBaseUrl: options.apiBaseUrl,
    serverToken: options.serverToken,
    frpcPath: options.frpcPath,
    frpcWorkDir: options.frpcWorkDir,
    workspaceDir: options.workspaceDir,
  }, audit);
  registerTransferRoutes(router, {
    token: options.token,
    clientId: options.clientId,
    apiBaseUrl: options.apiBaseUrl ?? '',
    serverToken: options.serverToken ?? '',
    workspaceDir: options.workspaceDir,
    allowedRoots: options.allowedRoots,
  });

  // 创建 HTTP 服务
  activeServer = http.createServer(async (req, res) => {
    try {
      if (req.method === 'OPTIONS') { setCorsHeaders(res); res.writeHead(204); res.end(); return; }
      if (await router.handle(req, res)) return;
      sendError(res, 404, 'NOT_FOUND', '路由未找到');
    } catch (err) {
      sendError(res, 500, 'INTERNAL_ERROR', err instanceof Error ? err.message : String(err));
    }
  });

  // 开始监听
  activeServer.listen(options.port, options.host);
  await once(activeServer, 'listening');
  const address = activeServer.address();
  const port = typeof address === 'object' && address ? address.port : options.port;
  activeState = { running: true, host: options.host, port, startedAt: Date.now() };
  return activeState;
}

/** 停止 HTTP 控制服务 */
export async function stopControlHttpServer(): Promise<void> {
  if (!activeServer) return;
  const server = activeServer;
  activeServer = null;
  activeState = null;
  activeJobManager = null;
  server.close();
  await once(server, 'close');
}

/** 获取当前控制 HTTP 服务状态 */
export function getControlHttpServerState(): ControlHttpServerState | null {
  return activeState;
}

/** 获取当前任务管理器实例 */
export function getJobManager(): JobManager | null {
  return activeJobManager;
}
