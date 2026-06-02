import type { FastifyInstance } from 'fastify';
import {
  AgentRunScriptPayloadSchema,
  AgentPushFilePayloadSchema,
  AgentOpenPortPayloadSchema,
  AgentClosePortPayloadSchema,
  AgentFileSessionPayloadSchema,
  AgentDeleteFileSessionPayloadSchema,
} from '@rag/shared';
import { authMiddleware } from '../auth/auth.middleware.js';
import { clientsService } from '../clients/clients.service.js';
import { tasksService } from '../tasks/tasks.service.js';
import { filesService } from '../files/files.service.js';
import { frpService, getFrpsConnectionInfo } from '../frp/frp.service.js';
import { auditService } from '../audit/audit.service.js';
import { connectionManager } from '../connections/connections.manager.js';
import { clientFileSessionsService } from '../client-files/client-file-sessions.service.js';
import { clientFileProxyService } from '../client-files/client-file-proxy.service.js';


export async function agentRoutes(app: FastifyInstance): Promise<void> {
  app.addHook('preHandler', authMiddleware);

  // List clients
  app.get('/api/agent/clients', async (_request) => {
    const clients = clientsService.listClients();
    return clients.map((c) => clientsService.toApi(c));
  });

  // Get client by ID
  app.get<{ Params: { clientId: string } }>('/api/agent/clients/:clientId', async (request, reply) => {
    const client = clientsService.getClient(request.params.clientId);
    if (!client) {
      return reply.code(404).send({ error: 'Client not found' });
    }
    return clientsService.toApi(client);
  });

  // Create or reuse file session — returns direct-connect info plus roots
  app.post('/api/agent/file-session', async (request, reply) => {
    const parseResult = AgentFileSessionPayloadSchema.safeParse(request.body);
    if (!parseResult.success) {
      return reply.code(400).send({ error: 'Invalid payload', details: parseResult.error.issues });
    }

    const { clientId } = parseResult.data;
    const client = clientsService.getClient(clientId);
    if (!client) {
      return reply.code(404).send({ error: 'Client not found' });
    }

    try {
      const session = await clientFileSessionsService.startSession(clientId);
      // Fetch roots from client file service for convenience
      let roots: Array<{ id: string; label: string; path: string }> = [];
      try {
        const rootsResult = await clientFileProxyService.roots(session) as { roots?: Array<{ id: string; label: string; path: string }> };
        roots = rootsResult.roots ?? [];
      } catch {
        // Roots fetch failure is non-fatal; caller can retry later
      }

      return {
        clientId: session.clientId,
        publicUrl: session.publicUrl,
        token: session.token,
        localPort: session.localPort,
        mappingId: session.mappingId,
        startedAt: session.startedAt,
        expiresAt: session.expiresAt,
        roots,
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return reply.code(500).send({ error: message });
    }
  });

  // Stop file session
  app.delete('/api/agent/file-session', async (request, reply) => {
    const parseResult = AgentDeleteFileSessionPayloadSchema.safeParse(request.body);
    if (!parseResult.success) {
      return reply.code(400).send({ error: 'Invalid payload', details: parseResult.error.issues });
    }

    const { clientId } = parseResult.data;
    try {
      const session = await clientFileSessionsService.stopSession(clientId);
      if (!session) {
        return reply.code(404).send({ error: 'No active session for this client' });
      }
      return { success: true };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return reply.code(500).send({ error: message });
    }
  });

  // Run script
  app.post('/api/agent/run-script', async (request, reply) => {
    const parseResult = AgentRunScriptPayloadSchema.safeParse(request.body);
    if (!parseResult.success) {
      return reply.code(400).send({ error: 'Invalid payload', details: parseResult.error.issues });
    }

    const { target, script, timeoutMs } = parseResult.data;
    const client = clientsService.getClient(target.clientId);
    if (!client) {
      return reply.code(404).send({ error: 'Client not found' });
    }

    const task = tasksService.createTask({
      clientId: target.clientId,
      type: 'exec_script',
      payload: { runtime: 'node', script, timeoutMs },
      createdBy: (request as unknown as { authRole: string }).authRole,
    });

    connectionManager.sendToClient(target.clientId, {
      type: 'task.dispatch',
      requestId: task.id,
      payload: {
        taskId: task.id,
        taskType: 'exec_script',
        payload: { runtime: 'node', script, timeoutMs },
      },
    });

    auditService.log({
      actor: (request as unknown as { authRole: string }).authRole,
      action: 'agent.run_script',
      targetType: 'task',
      targetId: task.id,
      detail: `Run script on ${target.clientId}`,
    });

    return reply.code(201).send(tasksService.toApi(task));
  });

  // Push file
  app.post('/api/agent/push-file', async (request, reply) => {
    const parseResult = AgentPushFilePayloadSchema.safeParse(request.body);
    if (!parseResult.success) {
      return reply.code(400).send({ error: 'Invalid payload', details: parseResult.error.issues });
    }

    const { clientId, fileId, targetPath } = parseResult.data;
    const client = clientsService.getClient(clientId);
    if (!client) {
      return reply.code(404).send({ error: 'Client not found' });
    }

    const file = filesService.getFile(fileId);
    if (!file) {
      return reply.code(404).send({ error: 'File not found' });
    }

    const task = tasksService.createTask({
      clientId,
      type: 'push_file',
      payload: { fileId, targetPath, fileName: file.original_name },
      createdBy: (request as unknown as { authRole: string }).authRole,
    });

    connectionManager.sendToClient(clientId, {
      type: 'task.dispatch',
      requestId: task.id,
      payload: {
        taskId: task.id,
        taskType: 'push_file',
        payload: { fileId, targetPath, fileName: file.original_name },
      },
    });

    auditService.log({
      actor: (request as unknown as { authRole: string }).authRole,
      action: 'agent.push_file',
      targetType: 'task',
      targetId: task.id,
      detail: `Push file ${file.original_name} to ${clientId}`,
    });

    return reply.code(201).send(tasksService.toApi(task));
  });

  // Open port
  app.post('/api/agent/open-port', async (request, reply) => {
    const parseResult = AgentOpenPortPayloadSchema.safeParse(request.body);
    if (!parseResult.success) {
      return reply.code(400).send({ error: 'Invalid payload', details: parseResult.error.issues });
    }

    const { clientId, name, localPort, remotePort, type } = parseResult.data;
    const client = clientsService.getClient(clientId);
    if (!client) {
      return reply.code(404).send({ error: 'Client not found' });
    }

    const frpsInfo = getFrpsConnectionInfo();

    const mapping = await frpService.createMapping({
      clientId,
      name,
      proxyType: type,
      localIp: '127.0.0.1',
      localPort,
      remotePort,
    });

    const dispatchPayload = {
      mappingId: mapping.id,
      name,
      proxyType: type,
      localIp: '127.0.0.1',
      localPort,
      remotePort: mapping.remote_port,
      serverAddr: frpsInfo.serverAddr,
      serverPort: frpsInfo.serverPort,
      authToken: frpsInfo.authToken,
    };

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

    auditService.log({
      actor: (request as unknown as { authRole: string }).authRole,
      action: 'agent.open_port',
      targetType: 'port_mapping',
      targetId: mapping.id,
    });

    return reply.code(201).send(frpService.toApi(mapping));
  });

  // Close port
  app.post('/api/agent/close-port', async (request, reply) => {
    const parseResult = AgentClosePortPayloadSchema.safeParse(request.body);
    if (!parseResult.success) {
      return reply.code(400).send({ error: 'Invalid payload', details: parseResult.error.issues });
    }

    const { mappingId } = parseResult.data;
    const mapping = frpService.getMapping(mappingId);
    if (!mapping) {
      return reply.code(404).send({ error: 'Port mapping not found' });
    }

    const task = tasksService.createTask({
      clientId: mapping.client_id,
      type: 'frp_remove_proxy',
      payload: { mappingId },
    });

    connectionManager.sendToClient(mapping.client_id, {
      type: 'task.dispatch',
      requestId: task.id,
      payload: {
        taskId: task.id,
        taskType: 'frp_remove_proxy',
        payload: { mappingId },
      },
    });

    frpService.deleteMapping(mappingId);

    auditService.log({
      actor: (request as unknown as { authRole: string }).authRole,
      action: 'agent.close_port',
      targetType: 'port_mapping',
      targetId: mappingId,
    });

    return reply.send({ success: true });
  });

  // Get agent task status
  app.get<{ Params: { taskId: string } }>('/api/agent/tasks/:taskId', async (request, reply) => {
    const task = tasksService.getTask(request.params.taskId);
    if (!task) {
      return reply.code(404).send({ error: 'Task not found' });
    }
    const logs = tasksService.getLogs(request.params.taskId);
    return reply.send({
      ...tasksService.toApi(task),
      logs: logs.map((l) => ({
        stream: l.stream,
        content: l.content,
        createdAt: l.created_at,
      })),
    });
  });
}
