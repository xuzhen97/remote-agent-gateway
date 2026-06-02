import type { WebSocket } from 'ws';
import { ClientRegisterPayloadSchema, ClientHeartbeatPayloadSchema, TaskLogPayloadSchema, TaskResultPayloadSchema } from '@rag/shared';
import { clientsService } from '../modules/clients/clients.service.js';
import { tasksService } from '../modules/tasks/tasks.service.js';
import { connectionManager } from '../modules/connections/connections.manager.js';
import { auditService } from '../modules/audit/audit.service.js';
import { frpService, getFrpsConnectionInfo } from '../modules/frp/frp.service.js';
import { autoMappingService } from '../modules/auto-mapping/auto-mapping.service.js';
import { saveDb } from '../db/index.js';

export async function handleWsMessage(ws: WebSocket, rawData: string): Promise<void> {
  let message: { type: string; requestId?: string; payload: unknown };
  try {
    message = JSON.parse(rawData);
  } catch {
    ws.send(JSON.stringify({ type: 'server.error', payload: { code: 'PARSE_ERROR', message: 'Invalid JSON' } }));
    return;
  }

  switch (message.type) {
    case 'client.register': {
      const parsed = ClientRegisterPayloadSchema.safeParse(message.payload);
      if (!parsed.success) {
        ws.send(JSON.stringify({ type: 'server.error', requestId: message.requestId, payload: { code: 'INVALID_PAYLOAD', message: parsed.error.message } }));
        return;
      }

      const info = parsed.data;
      clientsService.upsertClient(info);
      connectionManager.register(info.clientId, ws);

      auditService.log({
        actor: info.clientId,
        action: 'client.register',
        targetType: 'client',
        targetId: info.clientId,
        detail: `Client ${info.name} registered`,
      });

      const ackPayload: Record<string, unknown> = {
        message: `Registered as ${info.clientId}`,
      };

      try {
        const frpsInfo = getFrpsConnectionInfo();
        ackPayload.frp = {
          serverAddr: frpsInfo.serverAddr,
          serverPort: frpsInfo.serverPort,
          authToken: frpsInfo.authToken,
        };
      } catch (err) {
        console.warn('Skipping FRP registration payload:', err instanceof Error ? err.message : err);
      }

      try {
        await autoMappingService.onClientOnline(info.clientId);
      } catch (err) {
        console.warn(`[auto-mapping] failed for ${info.clientId}:`, err instanceof Error ? err.message : err);
      }

      ws.send(JSON.stringify({
        type: 'server.ack',
        requestId: message.requestId,
        payload: ackPayload,
      }));
      break;
    }

    case 'client.heartbeat': {
      const parsed = ClientHeartbeatPayloadSchema.safeParse(message.payload);
      if (!parsed.success) {
        ws.send(JSON.stringify({ type: 'server.error', requestId: message.requestId, payload: { code: 'INVALID_PAYLOAD', message: parsed.error.message } }));
        return;
      }

      const { clientId, cpu, memory, uptime } = parsed.data;
      clientsService.updateHeartbeat(clientId, { cpu, memory, uptime });

      ws.send(JSON.stringify({ type: 'server.ack', requestId: message.requestId, payload: { message: 'Heartbeat received' } }));
      break;
    }

    case 'task.log': {
      const parsed = TaskLogPayloadSchema.safeParse(message.payload);
      if (!parsed.success) {
        ws.send(JSON.stringify({ type: 'server.error', requestId: message.requestId, payload: { code: 'INVALID_PAYLOAD', message: parsed.error.message } }));
        return;
      }

      const { taskId, stream, content } = parsed.data;
      tasksService.addLog(taskId, stream, content);
      break;
    }

    case 'task.result': {
      const parsed = TaskResultPayloadSchema.safeParse(message.payload);
      if (!parsed.success) {
        ws.send(JSON.stringify({ type: 'server.error', requestId: message.requestId, payload: { code: 'INVALID_PAYLOAD', message: parsed.error.message } }));
        return;
      }

      const { taskId, status, result, error } = parsed.data;
      tasksService.updateTaskStatus(taskId, status as never, {
        result,
        error,
        finishedAt: Date.now(),
      });

      // If this was an FRP task result, update mapping status
      const task = tasksService.getTask(taskId);
      if (task && (task.type === 'frp_create_proxy' || task.type === 'frp_remove_proxy')) {
        const payload = JSON.parse(task.payload);
        if (payload.mappingId) {
          if (task.type === 'frp_create_proxy' && status === 'success') {
            const mapping = frpService.getMapping(payload.mappingId);
            if (mapping) {
              frpService.updateMappingStatus(payload.mappingId, 'active');
            }
          } else if (task.type === 'frp_remove_proxy') {
            frpService.deleteMapping(payload.mappingId);
          }
        }
      }

      ws.send(JSON.stringify({ type: 'server.ack', requestId: message.requestId, payload: { message: 'Result received' } }));

      // Save DB after important updates
      saveDb();
      break;
    }

    default: {
      ws.send(JSON.stringify({ type: 'server.error', requestId: message.requestId, payload: { code: 'UNKNOWN_TYPE', message: `Unknown message type: ${message.type}` } }));
    }
  }
}

export function handleWsClose(clientId: string): void {
  connectionManager.remove(clientId);
  clientsService.setOffline(clientId);

  void autoMappingService.onClientOffline(clientId).catch((err) => {
    console.warn(`[auto-mapping] cleanup-pending mark failed for ${clientId}:`, err instanceof Error ? err.message : err);
  });

  auditService.log({
    actor: clientId,
    action: 'client.disconnect',
    targetType: 'client',
    targetId: clientId,
  });

  saveDb();
}
