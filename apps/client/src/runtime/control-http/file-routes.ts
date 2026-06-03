import * as fs from 'node:fs';
import * as path from 'node:path';
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { ControlHttpRouter } from './router.js';
import { readBody, readJson, sendError, sendOk, setCorsHeaders } from './response.js';
import { requireBearerToken } from './auth.js';
import { resolveAllowedRoots, resolveRootPath } from '../file-roots.js';
import { toClientFileEntry, toClientFileStat } from '../file-paths.js';

function queryRootId(url: URL): string {
  const rootId = url.searchParams.get('rootId');
  if (!rootId) throw new Error('rootId is required');
  return rootId;
}

function queryPath(url: URL): string {
  return url.searchParams.get('path') ?? '.';
}

function mapError(err: unknown): { status: number; code: string; message: string } {
  const message = err instanceof Error ? err.message : String(err);
  if (message.includes('Path outside allowed root') || message.includes('Unknown rootId') || message.includes('rootId is required')) {
    return { status: 400, code: 'INVALID_PATH', message };
  }
  if (message.toLowerCase().includes('permission') || message.toLowerCase().includes('eacces') || message.toLowerCase().includes('eperm')) {
    return { status: 403, code: 'FORBIDDEN', message };
  }
  if (message.toLowerCase().includes('not found') || message.toLowerCase().includes('enoent')) {
    return { status: 404, code: 'NOT_FOUND', message };
  }
  return { status: 500, code: 'INTERNAL_ERROR', message };
}

function handleFailure(res: ServerResponse, err: unknown): void {
  const mapped = mapError(err);
  sendError(res, mapped.status, mapped.code, mapped.message);
}

/** Ensure a directory exists, skipping creation when it already exists.
 *  On Windows, mkdirSync on a drive root (e.g. D:\\) throws EPERM even with
 *  recursive:true, so we gate the call behind an existence check. */
function ensureDir(dir: string): void {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

export function registerFileRoutes(router: ControlHttpRouter, options: {
  token: string;
  workspaceDir: string;
  allowedRoots: string[];
}): void {
  const roots = resolveAllowedRoots(options.workspaceDir, options.allowedRoots);

  router.add('GET', /^\/files\/roots$/, (req, res) => {
    if (!requireBearerToken(req, res, options.token)) return;
    sendOk(res, { roots });
  });

  router.add('GET', /^\/files$/, (req, res, url) => {
    if (!requireBearerToken(req, res, options.token)) return;
    try {
      const rootId = queryRootId(url);
      const clientPath = queryPath(url);
      const fullPath = resolveRootPath(roots, rootId, clientPath);
      const entries = fs.readdirSync(fullPath).map((name) => {
        const childPath = clientPath === '.' ? name : path.posix.join(clientPath.replace(/\\/g, '/'), name);
        return toClientFileEntry(name, childPath, fs.statSync(path.join(fullPath, name)));
      });
      sendOk(res, { rootId, path: clientPath, entries });
    } catch (err) { handleFailure(res, err); }
  });

  router.add('GET', /^\/files\/stat$/, (req, res, url) => {
    if (!requireBearerToken(req, res, options.token)) return;
    try {
      const rootId = queryRootId(url);
      const clientPath = queryPath(url);
      const fullPath = resolveRootPath(roots, rootId, clientPath);
      if (!fs.existsSync(fullPath)) return sendError(res, 404, 'NOT_FOUND', 'Not found');
      sendOk(res, { rootId, ...toClientFileStat(clientPath, fs.statSync(fullPath)) });
    } catch (err) { handleFailure(res, err); }
  });

  const sendFile = (req: IncomingMessage, res: ServerResponse, url: URL, download: boolean) => {
    if (!requireBearerToken(req, res, options.token)) return;
    try {
      const rootId = queryRootId(url);
      const clientPath = queryPath(url);
      const fullPath = resolveRootPath(roots, rootId, clientPath);
      if (!fs.existsSync(fullPath) || !fs.statSync(fullPath).isFile()) return sendError(res, 404, 'NOT_FOUND', 'File not found');
      const content = fs.readFileSync(fullPath);
      const rawName = path.basename(fullPath);
      const encodedName = encodeURIComponent(rawName).replace(/'/g, '%27');
      setCorsHeaders(res);
      const headers: Record<string, string | number> = {
        'Content-Type': download ? 'application/octet-stream' : 'text/plain; charset=utf-8',
        'Content-Length': content.length,
      };
      if (download) headers['Content-Disposition'] = `attachment; filename="${rawName.replace(/[^\x00-\x7F]/g, '_')}"; filename*=UTF-8''${encodedName}`;
      res.writeHead(200, headers);
      res.end(content);
    } catch (err) { handleFailure(res, err); }
  };

  router.add('GET', /^\/files\/read$/, (req, res, url) => sendFile(req, res, url, false));
  router.add('GET', /^\/files\/download$/, (req, res, url) => sendFile(req, res, url, true));

  router.add('PUT', /^\/files\/write$/, async (req, res, url) => {
    if (!requireBearerToken(req, res, options.token)) return;
    try {
      const rootId = queryRootId(url);
      const clientPath = queryPath(url);
      const fullPath = resolveRootPath(roots, rootId, clientPath);
      ensureDir(path.dirname(fullPath));
      const body = await readBody(req);
      fs.writeFileSync(fullPath, body);
      sendOk(res, { rootId, path: clientPath, size: body.length });
    } catch (err) { handleFailure(res, err); }
  });

  router.add('POST', /^\/files\/upload$/, async (req, res, url) => {
    if (!requireBearerToken(req, res, options.token)) return;
    try {
      const rootId = queryRootId(url);
      const targetPath = queryPath(url);
      const filename = url.searchParams.get('filename');
      if (!filename || filename.includes('/') || filename.includes('\\')) return sendError(res, 400, 'INVALID_REQUEST', 'Invalid filename');
      const targetDir = resolveRootPath(roots, rootId, targetPath);
      ensureDir(targetDir);
      const body = await readBody(req);
      const fullPath = path.join(targetDir, filename);
      fs.writeFileSync(fullPath, body);
      sendOk(res, { rootId, path: path.posix.join(targetPath, filename), size: body.length });
    } catch (err) { handleFailure(res, err); }
  });

  router.add('POST', /^\/files\/mkdir$/, async (req, res) => {
    if (!requireBearerToken(req, res, options.token)) return;
    try {
      const payload = await readJson<{ rootId: string; path: string; recursive?: boolean }>(req);
      const fullPath = resolveRootPath(roots, payload.rootId, payload.path);
      fs.mkdirSync(fullPath, { recursive: payload.recursive !== false });
      sendOk(res, { rootId: payload.rootId, path: payload.path });
    } catch (err) { handleFailure(res, err); }
  });

  router.add('DELETE', /^\/files$/, (req, res, url) => {
    if (!requireBearerToken(req, res, options.token)) return;
    try {
      const rootId = queryRootId(url);
      const clientPath = queryPath(url);
      const recursive = url.searchParams.get('recursive') === 'true';
      const fullPath = resolveRootPath(roots, rootId, clientPath);
      if (!fs.existsSync(fullPath)) return sendError(res, 404, 'NOT_FOUND', 'Not found');
      fs.rmSync(fullPath, { recursive, force: false });
      sendOk(res, { rootId, path: clientPath, deleted: true });
    } catch (err) { handleFailure(res, err); }
  });

  router.add('POST', /^\/files\/move$/, async (req, res) => {
    if (!requireBearerToken(req, res, options.token)) return;
    try {
      const payload = await readJson<{ rootId: string; from: string; to: string; overwrite?: boolean }>(req);
      const from = resolveRootPath(roots, payload.rootId, payload.from);
      const to = resolveRootPath(roots, payload.rootId, payload.to);
      if (!fs.existsSync(from)) return sendError(res, 404, 'NOT_FOUND', 'Source not found');
      if (fs.existsSync(to) && !payload.overwrite) return sendError(res, 409, 'CONFLICT', 'Destination exists');
      ensureDir(path.dirname(to));
      if (fs.existsSync(to)) fs.rmSync(to, { recursive: true, force: true });
      fs.renameSync(from, to);
      sendOk(res, { rootId: payload.rootId, from: payload.from, to: payload.to });
    } catch (err) { handleFailure(res, err); }
  });

  router.add('POST', /^\/files\/copy$/, async (req, res) => {
    if (!requireBearerToken(req, res, options.token)) return;
    try {
      const payload = await readJson<{ rootId: string; from: string; to: string; overwrite?: boolean }>(req);
      const from = resolveRootPath(roots, payload.rootId, payload.from);
      const to = resolveRootPath(roots, payload.rootId, payload.to);
      if (!fs.existsSync(from)) return sendError(res, 404, 'NOT_FOUND', 'Source not found');
      if (fs.existsSync(to) && !payload.overwrite) return sendError(res, 409, 'CONFLICT', 'Destination exists');
      ensureDir(path.dirname(to));
      fs.cpSync(from, to, { recursive: true, force: payload.overwrite === true });
      sendOk(res, { rootId: payload.rootId, from: payload.from, to: payload.to });
    } catch (err) { handleFailure(res, err); }
  });
}
