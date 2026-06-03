import type { FastifyInstance } from 'fastify';
import { ClientTaskAuditMirrorRecordSchema } from '@rag/shared';
import { authMiddleware } from '../auth/auth.middleware.js';
import { tasksService } from './tasks.service.js';
import { parseTaskHistoryQuery } from './tasks.schemas.js';

export async function taskRoutes(app: FastifyInstance): Promise<void> {
  app.addHook('preHandler', authMiddleware);

  app.post('/api/client-audit/records', async (request, reply) => {
    const payload = ClientTaskAuditMirrorRecordSchema.parse(request.body);
    const result = await tasksService.upsertMirrorRecord(payload);
    return reply.send({ ok: true, inserted: result.inserted });
  });

  app.get('/api/tasks', async (request, reply) => {
    const query = parseTaskHistoryQuery(request.query);
    return reply.send(tasksService.list(query));
  });

  app.get<{ Params: { recordId: string } }>('/api/tasks/:recordId', async (request, reply) => {
    const row = tasksService.getByRecordId(request.params.recordId);
    if (!row) return reply.code(404).send({ error: 'Task record not found' });
    return reply.send(row);
  });
}
