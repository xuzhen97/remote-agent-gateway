import * as http from 'node:http';
import { once } from 'node:events';
import { ControlHttpRouter } from './router.js';
import { requireBearerToken } from './auth.js';
import { sendJson, sendOk, sendError, setCorsHeaders } from './response.js';
import { registerJobRoutes } from './job-routes.js';
import { JobManager } from './job-manager.js';
import { registerFileRoutes } from './file-routes.js';
import { registerFrpRoutes } from './frp-routes.js';

interface StartOptions {
  clientId: string;
  host: string;
  port: number;
  token: string;
  workspaceDir: string;
  allowedRoots: string[];
  apiBaseUrl?: string;
  serverToken?: string;
  frpcPath?: string;
  frpcWorkDir?: string;
  job: { maxConcurrent: number; defaultTimeoutMs: number; maxTimeoutMs: number; logBufferLines: number };
}

export interface ControlHttpServerState {
  running: true;
  host: string;
  port: number;
  startedAt: number;
}

let activeServer: http.Server | null = null;
let activeState: ControlHttpServerState | null = null;

export async function startControlHttpServer(options: StartOptions): Promise<ControlHttpServerState> {
  await stopControlHttpServer();
  const router = new ControlHttpRouter();
  const jobManager = new JobManager({
    maxConcurrent: options.job.maxConcurrent,
    defaultTimeoutMs: options.job.defaultTimeoutMs,
    maxTimeoutMs: options.job.maxTimeoutMs,
    logBufferLines: options.job.logBufferLines,
    workspaceDir: options.workspaceDir,
  });

  router.add('GET', /^\/ping$/, (_req, res) => sendJson(res, 200, { ok: true }));
  router.add('GET', /^\/health$/, (req, res) => {
    if (!requireBearerToken(req, res, options.token)) return;
    sendOk(res, { clientId: options.clientId, status: 'ready', version: '0.1.0', httpReady: true, frpcRunning: false });
  });

  registerJobRoutes(router, jobManager, options.token);
  registerFileRoutes(router, { token: options.token, workspaceDir: options.workspaceDir, allowedRoots: options.allowedRoots });
  registerFrpRoutes(router, {
    token: options.token,
    clientId: options.clientId,
    apiBaseUrl: options.apiBaseUrl,
    serverToken: options.serverToken,
    frpcPath: options.frpcPath,
    frpcWorkDir: options.frpcWorkDir,
    workspaceDir: options.workspaceDir,
  });

  activeServer = http.createServer(async (req, res) => {
    try {
      if (req.method === 'OPTIONS') { setCorsHeaders(res); res.writeHead(204); res.end(); return; }
      if (await router.handle(req, res)) return;
      sendError(res, 404, 'NOT_FOUND', 'Route not found');
    } catch (err) {
      sendError(res, 500, 'INTERNAL_ERROR', err instanceof Error ? err.message : String(err));
    }
  });

  activeServer.listen(options.port, options.host);
  await once(activeServer, 'listening');
  const address = activeServer.address();
  const port = typeof address === 'object' && address ? address.port : options.port;
  activeState = { running: true, host: options.host, port, startedAt: Date.now() };
  return activeState;
}

export async function stopControlHttpServer(): Promise<void> {
  if (!activeServer) return;
  const server = activeServer;
  activeServer = null;
  activeState = null;
  server.close();
  await once(server, 'close');
}

export function getControlHttpServerState(): ControlHttpServerState | null {
  return activeState;
}
