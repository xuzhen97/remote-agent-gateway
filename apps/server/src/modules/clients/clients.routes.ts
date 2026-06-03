import type { FastifyInstance } from 'fastify';
import { clientsService } from './clients.service.js';
import { authMiddleware } from '../auth/auth.middleware.js';
import { tasksService } from '../tasks/tasks.service.js';
import { connectionManager } from '../connections/connections.manager.js';
import { auditService } from '../audit/audit.service.js';
import { getFrpsConnectionInfo } from '../frp/frp.service.js';

export async function clientRoutes(app: FastifyInstance): Promise<void> {
  // All client routes require auth
  app.addHook('preHandler', authMiddleware);

  app.get('/api/clients', async (_request, reply) => {
    const clients = clientsService.listClients();
    return reply.send(clients.map((c) => clientsService.toApi(c)));
  });

  app.get<{ Params: { clientId: string } }>('/api/clients/:clientId', async (request, reply) => {
    const client = clientsService.getClient(request.params.clientId);
    if (!client) {
      return reply.code(404).send({ error: 'Client not found' });
    }
    return reply.send(clientsService.toApi(client, { includeHttpToken: true }));
  });

  // FRP daemon control
  app.post<{ Params: { clientId: string } }>('/api/clients/:clientId/frpc/start', async (request, reply) => {
    const client = clientsService.getClient(request.params.clientId);
    if (!client) return reply.code(404).send({ error: 'Client not found' });
    if (!connectionManager.isOnline(request.params.clientId)) {
      return reply.code(400).send({ error: 'Client is offline' });
    }

    const frpsInfo = getFrpsConnectionInfo();
    const payload = {
      serverAddr: frpsInfo.serverAddr,
      serverPort: frpsInfo.serverPort,
      authToken: frpsInfo.authToken,
    };

    const task = tasksService.createTask({
      clientId: request.params.clientId,
      type: 'frpc_start',
      payload,
    });

    connectionManager.sendToClient(request.params.clientId, {
      type: 'task.dispatch',
      requestId: task.id,
      payload: { taskId: task.id, taskType: 'frpc_start', payload },
    });

    return reply.send({ status: 'dispatched', taskId: task.id });
  });

  app.post<{ Params: { clientId: string } }>('/api/clients/:clientId/frpc/stop', async (request, reply) => {
    const client = clientsService.getClient(request.params.clientId);
    if (!client) return reply.code(404).send({ error: 'Client not found' });
    if (!connectionManager.isOnline(request.params.clientId)) {
      return reply.code(400).send({ error: 'Client is offline' });
    }

    const task = tasksService.createTask({
      clientId: request.params.clientId,
      type: 'frpc_stop',
      payload: {},
    });

    connectionManager.sendToClient(request.params.clientId, {
      type: 'task.dispatch',
      requestId: task.id,
      payload: { taskId: task.id, taskType: 'frpc_stop', payload: {} },
    });

    return reply.send({ status: 'dispatched', taskId: task.id });
  });

  // Delete offline client
  app.delete<{ Params: { clientId: string } }>('/api/clients/:clientId', async (request, reply) => {
    const client = clientsService.getClient(request.params.clientId);
    if (!client) {
      return reply.code(404).send({ error: 'Client not found' });
    }

    if (connectionManager.isOnline(request.params.clientId)) {
      return reply.code(400).send({ error: 'Only offline clients can be deleted' });
    }

    clientsService.deleteClientCascade(request.params.clientId);

    auditService.log({
      actor: (request as unknown as { authRole: string }).authRole,
      action: 'client.delete',
      targetType: 'client',
      targetId: request.params.clientId,
      detail: `Deleted offline client ${request.params.clientId}`,
    });

    return reply.send({ success: true });
  });
}
