import type { FastifyInstance } from 'fastify';
import { authMiddleware } from '../auth/auth.middleware.js';
import { clientFileSessionsService } from './client-file-sessions.service.js';
import { clientFileProxyService } from './client-file-proxy.service.js';
import {
  ClientFileCopyPayloadSchema,
  ClientFileDeletePayloadSchema,
  ClientFileMkdirPayloadSchema,
  ClientFileMovePayloadSchema,
  ClientFilePathPayloadSchema,
  ClientFileWriteQuerySchema,
} from '@rag/shared';

async function getSession(clientId: string) {
  return clientFileSessionsService.startSession(clientId);
}

async function readRequestBuffer(body: unknown): Promise<Buffer> {
  if (Buffer.isBuffer(body)) return body;
  if (body instanceof ArrayBuffer) return Buffer.from(body);
  if (body instanceof Uint8Array) return Buffer.from(body);
  if (typeof body === 'string') return Buffer.from(body);
  if (body && typeof body === 'object' && Symbol.asyncIterator in body) {
    const chunks: Buffer[] = [];
    for await (const chunk of body as AsyncIterable<Buffer | string>) {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    }
    return Buffer.concat(chunks);
  }
  return Buffer.alloc(0);
}

export async function clientFilesRoutes(app: FastifyInstance): Promise<void> {
  app.addContentTypeParser('application/octet-stream', { parseAs: 'buffer' }, (_request, body, done) => {
    done(null, body);
  });
  app.addContentTypeParser('text/plain', { parseAs: 'buffer' }, (_request, body, done) => {
    done(null, body);
  });

  app.addHook('preHandler', authMiddleware);

  app.post<{ Params: { clientId: string } }>('/api/clients/:clientId/file-session/start', async (request) => {
    const session = await clientFileSessionsService.startSession(request.params.clientId);
    return { ...session, token: undefined };
  });

  app.get<{ Params: { clientId: string } }>('/api/clients/:clientId/file-session', async (request, reply) => {
    const session = clientFileSessionsService.getSession(request.params.clientId);
    if (!session) return reply.code(404).send({ error: 'File session not found' });
    return reply.send({ ...session, token: undefined });
  });

  app.post<{ Params: { clientId: string } }>('/api/clients/:clientId/file-session/stop', async (request) => {
    const session = clientFileSessionsService.stopSession(request.params.clientId);
    return { stopped: Boolean(session) };
  });

  app.get<{ Params: { clientId: string }; Querystring: { path?: string } }>('/api/clients/:clientId/files', async (request) => {
    const payload = ClientFilePathPayloadSchema.parse({ path: request.query.path ?? '.' });
    return clientFileProxyService.list(await getSession(request.params.clientId), payload.path);
  });

  app.get<{ Params: { clientId: string }; Querystring: { path?: string } }>('/api/clients/:clientId/files/stat', async (request) => {
    const payload = ClientFilePathPayloadSchema.parse({ path: request.query.path ?? '.' });
    return clientFileProxyService.stat(await getSession(request.params.clientId), payload.path);
  });

  app.get<{ Params: { clientId: string }; Querystring: { path: string } }>('/api/clients/:clientId/files/read', async (request, reply) => {
    const payload = ClientFilePathPayloadSchema.parse({ path: request.query.path });
    const response = await clientFileProxyService.read(await getSession(request.params.clientId), payload.path);
    reply.code(response.status);
    reply.header('Content-Type', response.headers.get('Content-Type') ?? 'application/octet-stream');
    return reply.send(Buffer.from(await response.arrayBuffer()));
  });

  app.get<{ Params: { clientId: string }; Querystring: { path: string } }>('/api/clients/:clientId/files/download', async (request, reply) => {
    const payload = ClientFilePathPayloadSchema.parse({ path: request.query.path });
    const response = await clientFileProxyService.download(await getSession(request.params.clientId), payload.path);
    reply.code(response.status);
    reply.header('Content-Type', response.headers.get('Content-Type') ?? 'application/octet-stream');
    const disposition = response.headers.get('Content-Disposition');
    if (disposition) reply.header('Content-Disposition', disposition);
    return reply.send(Buffer.from(await response.arrayBuffer()));
  });

  app.put<{ Params: { clientId: string }; Querystring: { path: string } }>('/api/clients/:clientId/files/write', async (request) => {
    const payload = ClientFileWriteQuerySchema.parse({ path: request.query.path });
    const buffer = await readRequestBuffer(request.body);
    return clientFileProxyService.write(await getSession(request.params.clientId), payload.path, buffer);
  });

  app.post<{ Params: { clientId: string }; Querystring: { path?: string; filename?: string } }>('/api/clients/:clientId/files/upload', async (request, reply) => {
    const payload = ClientFilePathPayloadSchema.parse({ path: request.query.path ?? '.' });
    const filename = request.query.filename;
    if (!filename) return reply.code(400).send({ error: 'filename is required' });
    const buffer = await readRequestBuffer(request.body);
    return clientFileProxyService.upload(await getSession(request.params.clientId), payload.path, filename, buffer);
  });

  app.post<{ Params: { clientId: string } }>('/api/clients/:clientId/files/mkdir', async (request) => {
    const payload = ClientFileMkdirPayloadSchema.parse(request.body);
    return clientFileProxyService.mkdir(await getSession(request.params.clientId), payload);
  });

  app.delete<{ Params: { clientId: string }; Querystring: { path: string; recursive?: string } }>('/api/clients/:clientId/files', async (request) => {
    const payload = ClientFileDeletePayloadSchema.parse({
      path: request.query.path,
      recursive: request.query.recursive === 'true',
    });
    return clientFileProxyService.delete(await getSession(request.params.clientId), payload.path, payload.recursive);
  });

  app.post<{ Params: { clientId: string } }>('/api/clients/:clientId/files/move', async (request) => {
    const payload = ClientFileMovePayloadSchema.parse(request.body);
    return clientFileProxyService.move(await getSession(request.params.clientId), payload);
  });

  app.post<{ Params: { clientId: string } }>('/api/clients/:clientId/files/copy', async (request) => {
    const payload = ClientFileCopyPayloadSchema.parse(request.body);
    return clientFileProxyService.copy(await getSession(request.params.clientId), payload);
  });
}
