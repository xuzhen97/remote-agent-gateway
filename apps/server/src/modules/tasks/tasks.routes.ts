import { z } from 'zod';
import type { FastifyInstance } from 'fastify';
import { ClientTaskAuditMirrorRecordSchema } from '@rag/shared';
import { authMiddleware } from '../auth/auth.middleware.js';
import { auditService } from '../audit/audit.service.js';
import { tasksService } from './tasks.service.js';
import { parseTaskHistoryQuery } from './tasks.schemas.js';

const BulkDeleteTaskHistorySchema = z.object({
  recordIds: z.array(z.string().min(1)).min(1),
});

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

  app.delete<{ Params: { recordId: string } }>('/api/tasks/:recordId', async (request, reply) => {
    const result = tasksService.deleteByRecordId(request.params.recordId);
    if (!result.deleted) return reply.code(404).send({ error: 'Task record not found' });

    auditService.log({
      actor: (request as unknown as { authRole: string }).authRole,
      action: 'task_history.delete',
      targetType: 'task_history',
      targetId: request.params.recordId,
      detail: `Deleted task history record ${request.params.recordId}`,
    });

    return reply.send({ deleted: true, recordId: request.params.recordId });
  });

  app.post('/api/tasks/bulk-delete', async (request, reply) => {
    const parsed = BulkDeleteTaskHistorySchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: 'Invalid payload', details: parsed.error.flatten() });

    const recordIds = [...new Set(parsed.data.recordIds.map((id) => id.trim()).filter(Boolean))];
    const result = tasksService.deleteByRecordIds(recordIds);

    auditService.log({
      actor: (request as unknown as { authRole: string }).authRole,
      action: 'task_history.bulk_delete',
      targetType: 'task_history',
      targetId: 'bulk',
      detail: `Deleted ${result.deleted}/${result.requested} task history records: ${recordIds.join(', ')}`,
    });

    return reply.send({ requested: result.requested, deleted: result.deleted, recordIds });
  });
}
