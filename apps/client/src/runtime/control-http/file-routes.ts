import * as fs from 'node:fs';
import * as path from 'node:path';
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { ControlHttpRouter } from './router.js';
import { readBody, readJson, sendError, sendOk, setCorsHeaders } from './response.js';
import { createUploadSessionManager } from './upload-session.js';
import { requireBearerToken } from './auth.js';
import { resolveAllowedRoots, resolveRootPath } from '../file-roots.js';
import { toClientFileEntry, toClientFileStat } from '../file-paths.js';
import type { TaskAuditExecutor } from './task-audit.js';

function queryRootId(url: URL): string {
  const rootId = url.searchParams.get('rootId');
  if (!rootId) throw new Error('rootId is required');
  return rootId;
}

function queryPath(url: URL): string {
  return url.searchParams.get('path') ?? '.';
}

function queryInteger(url: URL, key: string): number {
  const raw = url.searchParams.get(key);
  if (!raw) throw new Error(`${key} is required`);
  const value = Number(raw);
  if (!Number.isInteger(value) || value < 0) throw new Error(`${key} must be a non-negative integer`);
  return value;
}

function parseUploadRoute(url: URL): { uploadId: string; partNumber?: number } {
  const match = url.pathname.match(/^\/files\/uploads\/([^/]+)(?:\/parts\/(\d+)|\/(status|complete))?$/);
  if (!match) throw new Error('Invalid upload route');
  return {
    uploadId: decodeURIComponent(match[1]),
    partNumber: match[2] === undefined ? undefined : Number(match[2]),
  };
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

export function registerFileRoutes(
  router: ControlHttpRouter,
  options: {
    token: string;
    workspaceDir: string;
    allowedRoots: string[];
    clientId: string;
  },
  audit: TaskAuditExecutor,
): void {
  const roots = resolveAllowedRoots(options.workspaceDir, options.allowedRoots);
  const uploadSessions = createUploadSessionManager({
    workspaceDir: options.workspaceDir,
    ttlMs: 24 * 60 * 60 * 1000,
  });

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
      const responseBody = await audit.execute({
        req, actionType: 'file.write', resourceType: 'file',
        method: 'PUT', path: '/files/write',
        payload: { rootId, path: clientPath, size: body.length },
        run: async () => {
          fs.writeFileSync(fullPath, body);
          return { httpStatus: 200, resultSummary: { size: body.length }, targetId: `${rootId}:${clientPath}`, status: 'success', body: { rootId, path: clientPath, size: body.length } };
        },
      });
      sendOk(res, responseBody);
    } catch (err) { handleFailure(res, err); }
  });

  router.add('POST', /^\/files\/uploads\/init$/, async (req, res) => {
    if (!requireBearerToken(req, res, options.token)) return;
    try {
      const payload = await readJson<{ rootId: string; path: string; filename: string; size: number; chunkSize?: number; fingerprint?: string }>(req);
      if (!payload.filename || payload.filename.includes('/') || payload.filename.includes('\\')) {
        return sendError(res, 400, 'INVALID_REQUEST', 'Invalid filename');
      }
      const targetDir = resolveRootPath(roots, payload.rootId, payload.path);
      ensureDir(targetDir);
      const responseBody = await uploadSessions.init({
        rootId: payload.rootId,
        targetPath: payload.path,
        filename: payload.filename,
        size: payload.size,
        chunkSize: payload.chunkSize ?? 8 * 1024 * 1024,
        fingerprint: payload.fingerprint ?? `${payload.filename}:${payload.size}`,
        resolvedTargetDir: targetDir,
      });
      sendOk(res, responseBody);
    } catch (err) {
      handleFailure(res, err);
    }
  });

  router.add('GET', /^\/files\/uploads\/[^/]+\/status$/, (req, res, url) => {
    if (!requireBearerToken(req, res, options.token)) return;
    try {
      const { uploadId } = parseUploadRoute(url);
      sendOk(res, uploadSessions.getStatus(uploadId));
    } catch (err) {
      handleFailure(res, err);
    }
  });

  router.add('PUT', /^\/files\/uploads\/[^/]+\/parts\/\d+$/, async (req, res, url) => {
    if (!requireBearerToken(req, res, options.token)) return;
    try {
      const { uploadId, partNumber } = parseUploadRoute(url);
      const offset = queryInteger(url, 'offset');
      const size = queryInteger(url, 'size');
      const responseBody = await uploadSessions.writePart(uploadId, partNumber!, req as AsyncIterable<Buffer>, { expectedOffset: offset, expectedSize: size });
      sendOk(res, responseBody);
    } catch (err) {
      handleFailure(res, err);
    }
  });

  router.add('POST', /^\/files\/uploads\/[^/]+\/complete$/, async (req, res, url) => {
    if (!requireBearerToken(req, res, options.token)) return;
    try {
      const { uploadId } = parseUploadRoute(url);
      const status = uploadSessions.getStatus(uploadId);
      const responseBody = await audit.execute({
        req,
        actionType: 'file.upload',
        resourceType: 'file',
        method: 'POST',
        path: '/files/uploads/:uploadId/complete',
        payload: { rootId: status.rootId, path: status.path, filename: status.filename, size: status.size },
        run: async () => {
          const completed = await uploadSessions.complete(uploadId);
          return {
            httpStatus: 200,
            resultSummary: { size: completed.size },
            targetId: `${completed.rootId}:${completed.path}`,
            status: 'success',
            body: completed,
          };
        },
      });
      sendOk(res, responseBody);
    } catch (err) {
      handleFailure(res, err);
    }
  });

  router.add('DELETE', /^\/files\/uploads\/[^/]+$/, (req, res, url) => {
    if (!requireBearerToken(req, res, options.token)) return;
    try {
      const { uploadId } = parseUploadRoute(url);
      sendOk(res, uploadSessions.abort(uploadId));
    } catch (err) {
      handleFailure(res, err);
    }
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
      const responseBody = await audit.execute({
        req, actionType: 'file.upload', resourceType: 'file',
        method: 'POST', path: '/files/upload',
        payload: { rootId, path: targetPath, filename, size: body.length },
        run: async () => {
          const fullPath = path.join(targetDir, filename);
          fs.writeFileSync(fullPath, body);
          const resultPath = path.posix.join(targetPath, filename);
          return { httpStatus: 200, resultSummary: { size: body.length }, targetId: `${rootId}:${resultPath}`, status: 'success', body: { rootId, path: resultPath, size: body.length } };
        },
      });
      sendOk(res, responseBody);
    } catch (err) { handleFailure(res, err); }
  });

  router.add('POST', /^\/files\/mkdir$/, async (req, res) => {
    if (!requireBearerToken(req, res, options.token)) return;
    try {
      const payload = await readJson<{ rootId: string; path: string; recursive?: boolean }>(req);
      const responseBody = await audit.execute({
        req, actionType: 'file.mkdir', resourceType: 'file',
        method: 'POST', path: '/files/mkdir', payload,
        run: async () => {
          const fullPath = resolveRootPath(roots, payload.rootId, payload.path);
          fs.mkdirSync(fullPath, { recursive: payload.recursive !== false });
          return { httpStatus: 200, resultSummary: {}, targetId: `${payload.rootId}:${payload.path}`, status: 'success', body: { rootId: payload.rootId, path: payload.path } };
        },
      });
      sendOk(res, responseBody);
    } catch (err) { handleFailure(res, err); }
  });

  router.add('DELETE', /^\/files$/, async (req, res, url) => {
    if (!requireBearerToken(req, res, options.token)) return;
    try {
      const rootId = queryRootId(url);
      const clientPath = queryPath(url);
      const recursive = url.searchParams.get('recursive') === 'true';
      const fullPath = resolveRootPath(roots, rootId, clientPath);
      const responseBody = await audit.execute({
        req, actionType: 'file.delete', resourceType: 'file',
        method: 'DELETE', path: '/files',
        payload: { rootId, path: clientPath, recursive },
        run: async () => {
          if (!fs.existsSync(fullPath)) throw Object.assign(new Error('Not found'), { code: 'NOT_FOUND' });
          fs.rmSync(fullPath, { recursive, force: false });
          return { httpStatus: 200, resultSummary: { deleted: true }, targetId: `${rootId}:${clientPath}`, status: 'success', body: { rootId, path: clientPath, deleted: true } };
        },
      });
      sendOk(res, responseBody);
    } catch (err) { handleFailure(res, err); }
  });

  router.add('POST', /^\/files\/move$/, async (req, res) => {
    if (!requireBearerToken(req, res, options.token)) return;
    try {
      const payload = await readJson<{ rootId: string; from: string; to: string; overwrite?: boolean }>(req);
      const responseBody = await audit.execute({
        req, actionType: 'file.move', resourceType: 'file',
        method: 'POST', path: '/files/move', payload,
        run: async () => {
          const from = resolveRootPath(roots, payload.rootId, payload.from);
          const to = resolveRootPath(roots, payload.rootId, payload.to);
          if (!fs.existsSync(from)) throw Object.assign(new Error('Source not found'), { code: 'NOT_FOUND' });
          if (fs.existsSync(to) && !payload.overwrite) throw Object.assign(new Error('Destination exists'), { code: 'CONFLICT' });
          ensureDir(path.dirname(to));
          if (fs.existsSync(to)) fs.rmSync(to, { recursive: true, force: true });
          fs.renameSync(from, to);
          return { httpStatus: 200, resultSummary: {}, targetId: `${payload.rootId}:${payload.to}`, status: 'success', body: { rootId: payload.rootId, from: payload.from, to: payload.to } };
        },
      });
      sendOk(res, responseBody);
    } catch (err) { handleFailure(res, err); }
  });

  router.add('POST', /^\/files\/copy$/, async (req, res) => {
    if (!requireBearerToken(req, res, options.token)) return;
    try {
      const payload = await readJson<{ rootId: string; from: string; to: string; overwrite?: boolean }>(req);
      const responseBody = await audit.execute({
        req, actionType: 'file.copy', resourceType: 'file',
        method: 'POST', path: '/files/copy', payload,
        run: async () => {
          const from = resolveRootPath(roots, payload.rootId, payload.from);
          const to = resolveRootPath(roots, payload.rootId, payload.to);
          if (!fs.existsSync(from)) throw Object.assign(new Error('Source not found'), { code: 'NOT_FOUND' });
          if (fs.existsSync(to) && !payload.overwrite) throw Object.assign(new Error('Destination exists'), { code: 'CONFLICT' });
          ensureDir(path.dirname(to));
          fs.cpSync(from, to, { recursive: true, force: payload.overwrite === true });
          return { httpStatus: 200, resultSummary: {}, targetId: `${payload.rootId}:${payload.to}`, status: 'success', body: { rootId: payload.rootId, from: payload.from, to: payload.to } };
        },
      });
      sendOk(res, responseBody);
    } catch (err) { handleFailure(res, err); }
  });
}
