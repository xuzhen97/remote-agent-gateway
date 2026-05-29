import type { FastifyInstance } from 'fastify';
import { frpService, getFrpsConnectionInfo } from './frp.service.js';
import { CreatePortMappingPayloadSchema } from '@rag/shared';
import { authMiddleware } from '../auth/auth.middleware.js';
import { auditService } from '../audit/audit.service.js';
import { connectionManager } from '../connections/connections.manager.js';
import { tasksService } from '../tasks/tasks.service.js';
import { clientsService } from '../clients/clients.service.js';

export async function frpRoutes(app: FastifyInstance): Promise<void> {
  app.addHook('preHandler', authMiddleware);

  // Create port mapping
  app.post('/api/port-mappings', async (request, reply) => {
    const parseResult = CreatePortMappingPayloadSchema.safeParse(request.body);
    if (!parseResult.success) {
      return reply.code(400).send({ error: 'Invalid payload', details: parseResult.error.issues });
    }

    const { clientId, name, proxyType, localIp, localPort, remotePort, customDomain } = parseResult.data;

    // Check client exists
    const client = clientsService.getClient(clientId);
    if (!client) {
      return reply.code(404).send({ error: 'Client not found' });
    }

    const frpsInfo = getFrpsConnectionInfo();

    const mapping = frpService.createMapping({
      clientId,
      name,
      proxyType,
      localIp,
      localPort,
      remotePort,
      customDomain,
    });

    auditService.log({
      actor: (request as unknown as { authRole: string }).authRole,
      action: 'frp.create',
      targetType: 'port_mapping',
      targetId: mapping.id,
      detail: `Created ${proxyType} mapping ${name}: ${localIp}:${localPort} -> ${mapping.remote_port}`,
    });

    // Build the dispatch payload with frps connection info
    const dispatchPayload = {
      mappingId: mapping.id,
      name,
      proxyType,
      localIp,
      localPort,
      remotePort: mapping.remote_port,
      customDomain,
      serverAddr: frpsInfo.serverAddr,
      serverPort: frpsInfo.serverPort,
      authToken: frpsInfo.authToken,
    };

    // Dispatch FRP create task to client
    const task = tasksService.createTask({
      clientId,
      type: 'frp_create_proxy',
      payload: dispatchPayload,
    });

    connectionManager.sendToClient(clientId, {
      type: 'task.dispatch',
      requestId: task.id,
      payload: {
        taskId: task.id,
        taskType: 'frp_create_proxy',
        payload: dispatchPayload,
      },
    });

    return reply.code(201).send(frpService.toApi(mapping));
  });

  // List port mappings
  app.get('/api/port-mappings', async (request, reply) => {
    const query = request.query as { clientId?: string };
    const mappings = frpService.listMappings(query.clientId);
    return reply.send(mappings.map((m) => frpService.toApi(m)));
  });

  // Delete port mapping
  app.delete<{ Params: { mappingId: string } }>('/api/port-mappings/:mappingId', async (request, reply) => {
    const mapping = frpService.getMapping(request.params.mappingId);
    if (!mapping) {
      return reply.code(404).send({ error: 'Port mapping not found' });
    }

    // Dispatch FRP remove task
    const task = tasksService.createTask({
      clientId: mapping.client_id,
      type: 'frp_remove_proxy',
      payload: { mappingId: mapping.id },
    });

    connectionManager.sendToClient(mapping.client_id, {
      type: 'task.dispatch',
      requestId: task.id,
      payload: {
        taskId: task.id,
        taskType: 'frp_remove_proxy',
        payload: { mappingId: mapping.id },
      },
    });

    frpService.deleteMapping(request.params.mappingId);

    auditService.log({
      actor: (request as unknown as { authRole: string }).authRole,
      action: 'frp.delete',
      targetType: 'port_mapping',
      targetId: mapping.id,
    });

    return reply.send({ success: true });
  });
}
