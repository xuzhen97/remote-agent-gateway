import { z } from 'zod';
import type { FastifyInstance } from 'fastify';
import { tasksService } from './tasks.service.js';
import { CreateTaskPayloadSchema } from '@rag/shared';
import { authMiddleware } from '../auth/auth.middleware.js';
import { auditService } from '../audit/audit.service.js';
import { connectionManager } from '../connections/connections.manager.js';
import { clientsService } from '../clients/clients.service.js';

export async function taskRoutes(app: FastifyInstance): Promise<void> {
  app.addHook('preHandler', authMiddleware);

  // Create task
  app.post('/api/tasks', async (request, reply) => {
    const parseResult = CreateTaskPayloadSchema.safeParse(request.body);
    if (!parseResult.success) {
      return reply.code(400).send({ error: 'Invalid payload', details: parseResult.error.issues });
    }

    const { clientId, type, payload } = parseResult.data;

    // Check client exists
    const client = clientsService.getClient(clientId);
    if (!client) {
      return reply.code(404).send({ error: 'Client not found' });
    }

    const task = tasksService.createTask({
      clientId,
      type,
      payload,
      createdBy: (request as unknown as { authRole: string }).authRole,
    });

    auditService.log({
      actor: (request as unknown as { authRole: string }).authRole,
      action: 'task.create',
      targetType: 'task',
      targetId: task.id,
      detail: `Created ${type} task for client ${clientId}`,
    });

    // Dispatch to client if online
    const dispatched = connectionManager.sendToClient(clientId, {
      type: 'task.dispatch',
      requestId: task.id,
      payload: {
        taskId: task.id,
        taskType: type,
        payload,
      },
    });

    if (dispatched) {
      tasksService.updateTaskStatus(task.id, 'dispatched');
    }

    return reply.code(201).send(tasksService.toApi(task));
  });

  // List tasks
  app.get('/api/tasks', async (request, reply) => {
    const query = request.query as { clientId?: string; status?: string; limit?: string };
    const tasks = tasksService.listTasks({
      clientId: query.clientId,
      status: query.status as never,
      limit: query.limit ? parseInt(query.limit, 10) : undefined,
    });
    return reply.send(tasks.map((t) => tasksService.toApi(t)));
  });

  // Get task
  app.get<{ Params: { taskId: string } }>('/api/tasks/:taskId', async (request, reply) => {
    const task = tasksService.getTask(request.params.taskId);
    if (!task) {
      return reply.code(404).send({ error: 'Task not found' });
    }
    return reply.send(tasksService.toApi(task));
  });

  // Get task logs
  app.get<{ Params: { taskId: string } }>('/api/tasks/:taskId/logs', async (request, reply) => {
    const task = tasksService.getTask(request.params.taskId);
    if (!task) {
      return reply.code(404).send({ error: 'Task not found' });
    }
    const logs = tasksService.getLogs(request.params.taskId);
    return reply.send(logs.map((l) => ({
      id: l.id,
      taskId: l.task_id,
      stream: l.stream,
      content: l.content,
      createdAt: l.created_at,
    })));
  });

  // Delete task
  app.delete<{ Params: { taskId: string } }>('/api/tasks/:taskId', async (request, reply) => {
    const { taskId } = request.params;
    const result = tasksService.deleteTaskById(taskId);
    if (!result.deletedTask) {
      return reply.code(404).send({ error: 'Task not found' });
    }

    const actor = (request as unknown as { authRole: string }).authRole;
    auditService.log({
      actor,
      action: 'task.delete',
      targetType: 'task',
      targetId: taskId,
      detail: `Deleted task ${taskId} with ${result.deletedLogs} logs`,
    });

    return reply.send({
      taskId,
      deletedTask: result.deletedTask,
      deletedLogs: result.deletedLogs,
    });
  });

  // Bulk delete tasks
  const BulkDeleteTasksPayloadSchema = z.object({
    taskIds: z.array(z.string().min(1)).min(1),
  });

  app.post('/api/tasks/bulk-delete', async (request, reply) => {
    const parsed = BulkDeleteTasksPayloadSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: 'Invalid payload', details: 'taskIds must be a non-empty array' });
    }

    const taskIds = [...new Set(parsed.data.taskIds.map((id) => id.trim()).filter(Boolean))];
    if (!taskIds.length) {
      return reply.code(400).send({ error: 'Invalid payload', details: 'taskIds must be a non-empty array' });
    }

    const result = tasksService.deleteTasksByIds(taskIds);
    const actor = (request as unknown as { authRole: string }).authRole;
    auditService.log({
      actor,
      action: 'task.bulk_delete',
      targetType: 'task',
      targetId: 'bulk',
      detail: `Deleted ${result.deletedTasks} tasks (requested: ${taskIds.length}, logs: ${result.deletedLogs}): ${taskIds.join(', ')}`,
    });

    return reply.send({
      requested: taskIds.length,
      deletedTasks: result.deletedTasks,
      deletedLogs: result.deletedLogs,
    });
  });
}
