import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { authMiddleware } from '../auth/auth.middleware.js';
import { transferService } from './transfer.service.js';

const CreateUploadSchema = z.object({
  clientId: z.string().min(1).max(128),
  rootId: z.string().min(1).max(128),
  path: z.string().min(1).max(2048),
  filename: z.string().min(1).max(1024),
  size: z.number().int().min(0),
  transfer: z.enum(['auto', 'aliyundrive', 'direct']).default('auto'),
});

const CliProgressSchema = z.object({
  uploadedBytes: z.number().int().min(0),
  totalBytes: z.number().int().min(0),
  currentPart: z.number().int().min(1).optional(),
});

const ClientProgressSchema = z.object({
  downloadedBytes: z.number().int().min(0).optional(),
  writtenBytes: z.number().int().min(0).optional(),
  totalBytes: z.number().int().min(0),
});

const FailSchema = z.object({
  errorCode: z.string().min(1).max(128),
  errorMessage: z.string().min(1).max(2048),
});

const RefreshUrlSchema = z.object({
  partNumbers: z.array(z.number().int().min(1)).optional(),
});

export async function transferRoutes(app: FastifyInstance): Promise<void> {
  app.addHook('preHandler', authMiddleware);

  app.get('/api/transfers', async (request, reply) => {
    const limitRaw = Number((request.query as Record<string, unknown> | undefined)?.limit ?? 20);
    const limit = Number.isInteger(limitRaw) && limitRaw > 0 ? Math.min(limitRaw, 100) : 20;
    return reply.send({ items: transferService.listTransfers(limit) });
  });

  app.post('/api/transfers/uploads', async (request, reply) => {
    const parsed = CreateUploadSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.message });
    try {
      return reply.send(await transferService.createUpload(parsed.data));
    } catch (error) {
      return reply.code(400).send({ error: error instanceof Error ? error.message : String(error) });
    }
  });

  app.get<{ Params: { transferId: string } }>('/api/transfers/:transferId', async (request, reply) => {
    const job = transferService.getTransfer(request.params.transferId);
    if (!job) return reply.code(404).send({ error: 'Transfer not found' });
    return reply.send(job);
  });

  app.get<{ Params: { transferId: string } }>('/api/transfers/:transferId/events', async (request, reply) => {
    return reply.send(transferService.listEvents(request.params.transferId));
  });

  app.post<{ Params: { transferId: string } }>('/api/transfers/:transferId/cli-progress', async (request, reply) => {
    const parsed = CliProgressSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.message });
    const job = transferService.recordCliProgress(request.params.transferId, parsed.data);
    if (!job) return reply.code(404).send({ error: 'Transfer not found' });
    return reply.send(job);
  });

  app.post<{ Params: { transferId: string } }>('/api/transfers/:transferId/cli-upload-complete', async (request, reply) => {
    try {
      const job = await transferService.completeCliUpload(request.params.transferId);
      if (!job) return reply.code(404).send({ error: 'Transfer not found' });
      return reply.send(job);
    } catch (error) {
      return reply.code(400).send({ error: error instanceof Error ? error.message : String(error) });
    }
  });

  app.post<{ Params: { transferId: string } }>('/api/transfers/:transferId/web-upload-complete', async (request, reply) => {
    try {
      const job = await transferService.completeBrowserUpload(request.params.transferId);
      if (!job) return reply.code(404).send({ error: 'Transfer not found' });
      return reply.send(job);
    } catch (error) {
      return reply.code(400).send({ error: error instanceof Error ? error.message : String(error) });
    }
  });

  app.post<{ Params: { transferId: string } }>('/api/transfers/:transferId/client-progress', async (request, reply) => {
    const parsed = ClientProgressSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.message });
    const job = transferService.recordClientProgress(request.params.transferId, parsed.data);
    if (!job) return reply.code(404).send({ error: 'Transfer not found' });
    return reply.send(job);
  });

  app.post<{ Params: { transferId: string } }>('/api/transfers/:transferId/client-complete', async (request, reply) => {
    const job = transferService.completeClientDownload(request.params.transferId);
    if (!job) return reply.code(404).send({ error: 'Transfer not found' });
    return reply.send(job);
  });

  app.post<{ Params: { transferId: string } }>('/api/transfers/:transferId/fail', async (request, reply) => {
    const parsed = FailSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.message });
    const job = transferService.failTransfer(request.params.transferId, parsed.data);
    if (!job) return reply.code(404).send({ error: 'Transfer not found' });
    return reply.send(job);
  });

  app.post<{ Params: { transferId: string } }>('/api/transfers/:transferId/cancel', async (request, reply) => {
    const job = transferService.getTransfer(request.params.transferId);
    if (!job) return reply.code(404).send({ error: 'Transfer not found' });
    return reply.send(transferService.failTransfer(request.params.transferId, { errorCode: 'CANCELLED', errorMessage: 'Transfer cancelled' }));
  });

  app.post<{ Params: { transferId: string } }>('/api/transfers/:transferId/refresh-upload-url', async (request, reply) => {
    const parsed = RefreshUrlSchema.safeParse(request.body ?? {});
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.message });
    try {
      return reply.send(await transferService.refreshUploadUrl(request.params.transferId, parsed.data.partNumbers));
    } catch (error) {
      return reply.code(400).send({ error: error instanceof Error ? error.message : String(error) });
    }
  });

  app.post<{ Params: { transferId: string } }>('/api/transfers/:transferId/refresh-download-url', async (request, reply) => {
    try {
      return reply.send(await transferService.refreshDownloadUrl(request.params.transferId));
    } catch (error) {
      return reply.code(400).send({ error: error instanceof Error ? error.message : String(error) });
    }
  });
}
