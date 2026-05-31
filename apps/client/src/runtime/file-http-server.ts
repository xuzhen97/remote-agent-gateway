import * as http from 'node:http';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { once } from 'node:events';
import { resolveAllowedRoots, resolveRootPath } from './file-roots.js';
import { toClientFileEntry, toClientFileStat } from './file-paths.js';
import type { ClientFileRoot } from '@rag/shared';

interface StartOptions {
  workspaceDir: string;
  allowedRoots?: string[];
  port?: number;
  token: string;
  ttlMs?: number;
}

export interface FileHttpServerState {
  running: true;
  host: '127.0.0.1';
  port: number;
  startedAt: number;
  expiresAt?: number;
}

let activeServer: http.Server | null = null;
let activeState: FileHttpServerState | null = null;
let activeToken = '';
let activeRoots: ClientFileRoot[] = [];
let expiryTimer: ReturnType<typeof setTimeout> | null = null;

function sendJson(res: http.ServerResponse, status: number, body: unknown): void {
  const payload = Buffer.from(JSON.stringify(body));
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': payload.length,
  });
  res.end(payload);
}

function sendError(res: http.ServerResponse, status: number, message: string): void {
  sendJson(res, status, { error: message });
}

async function readBody(req: http.IncomingMessage): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return Buffer.concat(chunks);
}

async function readJson<T>(req: http.IncomingMessage): Promise<T> {
  const body = await readBody(req);
  return JSON.parse(body.toString('utf-8')) as T;
}

function ensureAuthorized(req: http.IncomingMessage): boolean {
  return req.headers.authorization === `Bearer ${activeToken}`;
}

function queryPath(url: URL): string {
  return url.searchParams.get('path') ?? '.';
}

function queryRootId(url: URL): string {
  const rootId = url.searchParams.get('rootId');
  if (!rootId) throw new Error('rootId is required');
  return rootId;
}

function resolveRequestPath(rootId: string, clientPath: string): string {
  return resolveRootPath(activeRoots, rootId, clientPath);
}

function mapError(message: string): number {
  if (message.includes('Path outside allowed root') || message.includes('Unknown rootId') || message.includes('rootId is required')) {
    return 400;
  }
  if (message.toLowerCase().includes('permission denied') || message.toLowerCase().includes('eperm') || message.toLowerCase().includes('eacces')) {
    return 403;
  }
  return 500;
}

async function handleRequest(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
  if (!ensureAuthorized(req)) {
    sendError(res, 401, 'Unauthorized');
    return;
  }

  const url = new URL(req.url ?? '/', 'http://127.0.0.1');

  try {
    if (req.method === 'GET' && url.pathname === '/v1/health') {
      sendJson(res, 200, { ok: true, ...activeState });
      return;
    }

    if (req.method === 'GET' && url.pathname === '/v1/roots') {
      sendJson(res, 200, { roots: activeRoots });
      return;
    }

    if (req.method === 'GET' && url.pathname === '/v1/list') {
      const rootId = queryRootId(url);
      const clientPath = queryPath(url);
      const fullPath = resolveRequestPath(rootId, clientPath);
      const names = fs.readdirSync(fullPath);
      const entries = names.map((name) => {
        const childClientPath = clientPath === '.' ? name : path.posix.join(clientPath.replace(/\\/g, '/'), name);
        return toClientFileEntry(name, childClientPath, fs.statSync(path.join(fullPath, name)));
      });
      sendJson(res, 200, { rootId, path: clientPath, entries });
      return;
    }

    if (req.method === 'GET' && url.pathname === '/v1/stat') {
      const rootId = queryRootId(url);
      const clientPath = queryPath(url);
      const fullPath = resolveRequestPath(rootId, clientPath);
      if (!fs.existsSync(fullPath)) {
        sendError(res, 404, 'Not found');
        return;
      }
      sendJson(res, 200, { rootId, ...toClientFileStat(clientPath, fs.statSync(fullPath)) });
      return;
    }

    if (req.method === 'GET' && (url.pathname === '/v1/read' || url.pathname === '/v1/download')) {
      const rootId = queryRootId(url);
      const clientPath = queryPath(url);
      const fullPath = resolveRequestPath(rootId, clientPath);
      if (!fs.existsSync(fullPath) || !fs.statSync(fullPath).isFile()) {
        sendError(res, 404, 'File not found');
        return;
      }
      const content = fs.readFileSync(fullPath);
      res.writeHead(200, {
        'Content-Type': 'application/octet-stream',
        'Content-Length': content.length,
        'Content-Disposition': `attachment; filename="${path.basename(fullPath)}"`,
      });
      res.end(content);
      return;
    }

    if (req.method === 'PUT' && url.pathname === '/v1/write') {
      const rootId = queryRootId(url);
      const clientPath = queryPath(url);
      const fullPath = resolveRequestPath(rootId, clientPath);
      fs.mkdirSync(path.dirname(fullPath), { recursive: true });
      const body = await readBody(req);
      fs.writeFileSync(fullPath, body);
      sendJson(res, 200, { rootId, path: clientPath, size: body.length });
      return;
    }

    if (req.method === 'POST' && url.pathname === '/v1/upload') {
      const rootId = queryRootId(url);
      const targetPath = queryPath(url);
      const targetDir = resolveRequestPath(rootId, targetPath);
      const filename = url.searchParams.get('filename');
      if (!filename || filename.includes('/') || filename.includes('\\')) {
        sendError(res, 400, 'Invalid filename');
        return;
      }
      fs.mkdirSync(targetDir, { recursive: true });
      const body = await readBody(req);
      const fullPath = path.join(targetDir, filename);
      fs.writeFileSync(fullPath, body);
      sendJson(res, 200, { rootId, path: path.posix.join(targetPath, filename), size: body.length });
      return;
    }

    if (req.method === 'POST' && url.pathname === '/v1/mkdir') {
      const payload = await readJson<{ rootId: string; path: string; recursive?: boolean }>(req);
      const fullPath = resolveRequestPath(payload.rootId, payload.path);
      fs.mkdirSync(fullPath, { recursive: payload.recursive !== false });
      sendJson(res, 200, { rootId: payload.rootId, path: payload.path });
      return;
    }

    if (req.method === 'DELETE' && url.pathname === '/v1/delete') {
      const rootId = queryRootId(url);
      const clientPath = queryPath(url);
      const recursive = url.searchParams.get('recursive') === 'true';
      const fullPath = resolveRequestPath(rootId, clientPath);
      if (!fs.existsSync(fullPath)) {
        sendError(res, 404, 'Not found');
        return;
      }
      fs.rmSync(fullPath, { recursive, force: false });
      sendJson(res, 200, { rootId, path: clientPath, deleted: true });
      return;
    }

    if (req.method === 'POST' && url.pathname === '/v1/move') {
      const payload = await readJson<{ rootId: string; from: string; to: string; overwrite?: boolean }>(req);
      const from = resolveRequestPath(payload.rootId, payload.from);
      const to = resolveRequestPath(payload.rootId, payload.to);
      if (!fs.existsSync(from)) {
        sendError(res, 404, 'Source not found');
        return;
      }
      if (fs.existsSync(to) && !payload.overwrite) {
        sendError(res, 409, 'Destination exists');
        return;
      }
      fs.mkdirSync(path.dirname(to), { recursive: true });
      if (fs.existsSync(to)) fs.rmSync(to, { recursive: true, force: true });
      fs.renameSync(from, to);
      sendJson(res, 200, { rootId: payload.rootId, from: payload.from, to: payload.to });
      return;
    }

    if (req.method === 'POST' && url.pathname === '/v1/copy') {
      const payload = await readJson<{ rootId: string; from: string; to: string; overwrite?: boolean }>(req);
      const from = resolveRequestPath(payload.rootId, payload.from);
      const to = resolveRequestPath(payload.rootId, payload.to);
      if (!fs.existsSync(from)) {
        sendError(res, 404, 'Source not found');
        return;
      }
      if (fs.existsSync(to) && !payload.overwrite) {
        sendError(res, 409, 'Destination exists');
        return;
      }
      fs.mkdirSync(path.dirname(to), { recursive: true });
      fs.cpSync(from, to, { recursive: true, force: payload.overwrite === true });
      sendJson(res, 200, { rootId: payload.rootId, from: payload.from, to: payload.to });
      return;
    }

    sendError(res, 404, 'Route not found');
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    sendError(res, mapError(message), message);
  }
}

export async function startFileHttpServer(options: StartOptions): Promise<FileHttpServerState> {
  await stopFileHttpServer();

  activeToken = options.token;
  activeRoots = resolveAllowedRoots(options.workspaceDir, options.allowedRoots);
  for (const root of activeRoots) {
    try {
      fs.mkdirSync(root.path, { recursive: true });
    } catch {
      if (!fs.existsSync(root.path)) throw new Error(`Root directory does not exist and cannot be created: ${root.path}`);
    }
  }

  activeServer = http.createServer((req, res) => {
    void handleRequest(req, res);
  });

  activeServer.listen(options.port ?? 0, '127.0.0.1');
  await once(activeServer, 'listening');

  const address = activeServer.address();
  if (!address || typeof address === 'string') throw new Error('Unable to determine file server port');

  activeState = {
    running: true,
    host: '127.0.0.1',
    port: address.port,
    startedAt: Date.now(),
    expiresAt: options.ttlMs ? Date.now() + options.ttlMs : undefined,
  };

  if (options.ttlMs) {
    expiryTimer = setTimeout(() => {
      void stopFileHttpServer();
    }, options.ttlMs);
  }

  return activeState;
}

export async function stopFileHttpServer(): Promise<void> {
  if (expiryTimer) {
    clearTimeout(expiryTimer);
    expiryTimer = null;
  }

  const server = activeServer;
  activeServer = null;
  activeState = null;
  activeToken = '';
  activeRoots = [];

  if (!server) return;
  await new Promise<void>((resolve, reject) => {
    server.close((err) => (err ? reject(err) : resolve()));
  });
}

export function getFileHttpServerStatus() {
  if (!activeState) return { running: false, host: '127.0.0.1' as const };
  return {
    ...activeState,
    uptimeMs: Date.now() - activeState.startedAt,
  };
}
