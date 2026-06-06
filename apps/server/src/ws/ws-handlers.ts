import type { WebSocket } from 'ws';
import { ClientRegisterPayloadSchema, ClientHeartbeatPayloadSchema, ClientHttpReadyPayloadSchema, ClientHttpFailedPayloadSchema, ClientTransferProgressPayloadSchema, ClientTransferCompletePayloadSchema, ClientTransferFailedPayloadSchema } from '@rag/shared';
import { clientsService } from '../modules/clients/clients.service.js';
import { connectionManager } from '../modules/connections/connections.manager.js';
import { auditService } from '../modules/audit/audit.service.js';
import { getFrpsConnectionInfo } from '../modules/frp/frp.service.js';
import { clientHttpCoordinatorService } from '../modules/client-http/client-http-coordinator.service.js';
import { transferService } from '../modules/transfers/transfer.service.js';
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

      // Coordinate client HTTP control endpoint
      if (info.http && info.capabilities?.httpControl) {
        try {
          const httpControl = await clientHttpCoordinatorService.coordinate(info.clientId, info.http, info.capabilities);
          ackPayload.httpControl = {
            localHost: httpControl.localHost,
            localPort: httpControl.localPort,
            remotePort: httpControl.remotePort,
            publicBaseUrl: httpControl.publicBaseUrl,
            token: httpControl.token,
          };
        } catch (err) {
          console.warn('HTTP coordination failed:', err instanceof Error ? err.message : err);
        }
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

    case 'client.http_ready': {
      const parsed = ClientHttpReadyPayloadSchema.safeParse(message.payload);
      if (!parsed.success) {
        ws.send(JSON.stringify({ type: 'server.error', requestId: message.requestId, payload: { code: 'INVALID_PAYLOAD', message: parsed.error.message } }));
        return;
      }

      const { clientId, baseUrl, remotePort } = parsed.data;
      clientsService.markHttpReady(clientId, baseUrl, remotePort);
      ws.send(JSON.stringify({ type: 'server.ack', requestId: message.requestId, payload: { message: 'HTTP endpoint ready' } }));
      saveDb();
      break;
    }

    case 'client.http_failed': {
      const parsed = ClientHttpFailedPayloadSchema.safeParse(message.payload);
      if (!parsed.success) {
        ws.send(JSON.stringify({ type: 'server.error', requestId: message.requestId, payload: { code: 'INVALID_PAYLOAD', message: parsed.error.message } }));
        return;
      }

      const { clientId, reason } = parsed.data;
      clientsService.markHttpFailed(clientId);
      auditService.log({
        actor: clientId,
        action: 'client.http_failed',
        targetType: 'client',
        targetId: clientId,
        detail: reason,
      });
      ws.send(JSON.stringify({ type: 'server.ack', requestId: message.requestId, payload: { message: 'HTTP endpoint failure recorded' } }));
      saveDb();
      break;
    }

    case 'client.transfer.progress': {
      const parsed = ClientTransferProgressPayloadSchema.safeParse(message.payload);
      if (!parsed.success) {
        ws.send(JSON.stringify({ type: 'server.error', requestId: message.requestId, payload: { code: 'INVALID_PAYLOAD', message: parsed.error.message } }));
        return;
      }
      transferService.recordClientProgress(parsed.data.transferId, { downloadedBytes: parsed.data.downloadedBytes, writtenBytes: parsed.data.writtenBytes, totalBytes: parsed.data.totalBytes });
      ws.send(JSON.stringify({ type: 'server.ack', requestId: message.requestId, payload: { message: 'Progress recorded' } }));
      break;
    }

    case 'client.transfer.complete': {
      const parsed = ClientTransferCompletePayloadSchema.safeParse(message.payload);
      if (!parsed.success) {
        ws.send(JSON.stringify({ type: 'server.error', requestId: message.requestId, payload: { code: 'INVALID_PAYLOAD', message: parsed.error.message } }));
        return;
      }
      transferService.completeClientDownload(parsed.data.transferId);
      ws.send(JSON.stringify({ type: 'server.ack', requestId: message.requestId, payload: { message: 'Transfer complete recorded' } }));
      saveDb();
      break;
    }

    case 'client.transfer.failed': {
      const parsed = ClientTransferFailedPayloadSchema.safeParse(message.payload);
      if (!parsed.success) {
        ws.send(JSON.stringify({ type: 'server.error', requestId: message.requestId, payload: { code: 'INVALID_PAYLOAD', message: parsed.error.message } }));
        return;
      }
      transferService.failTransfer(parsed.data.transferId, parsed.data);
      ws.send(JSON.stringify({ type: 'server.ack', requestId: message.requestId, payload: { message: 'Transfer failure recorded' } }));
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

  auditService.log({
    actor: clientId,
    action: 'client.disconnect',
    targetType: 'client',
    targetId: clientId,
  });

  saveDb();
}
