/** @file WebSocket 消息处理器
 *
 * 处理客户端通过 WebSocket 发送的所有消息类型。
 * 这是控制面（control plane）的核心消息分发逻辑。
 */
import type { WebSocket } from 'ws';
import { ClientRegisterPayloadSchema, ClientHeartbeatPayloadSchema, ClientHttpReadyPayloadSchema, ClientHttpFailedPayloadSchema, ClientTransferProgressPayloadSchema, ClientTransferCompletePayloadSchema, ClientTransferFailedPayloadSchema } from '@rag/shared';
import { clientsService } from '../modules/clients/clients.service.js';
import { connectionManager } from '../modules/connections/connections.manager.js';
import { auditService } from '../modules/audit/audit.service.js';
import { getFrpsConnectionInfo } from '../modules/frp/frp.service.js';
import { clientHttpCoordinatorService } from '../modules/client-http/client-http-coordinator.service.js';
import { transferService } from '../modules/transfers/transfer.service.js';
import { resolveJobEvent } from '../modules/jobs/jobs-proxy.routes.js';
import { saveDb } from '../db/index.js';

/**
 * 处理 WebSocket 收到的消息
 * @param ws - WebSocket 连接实例
 * @param rawData - 原始 JSON 字符串
 */
export async function handleWsMessage(ws: WebSocket, rawData: string): Promise<void> {
  // 解析 JSON 消息
  let message: { type: string; requestId?: string; payload: unknown };
  try {
    message = JSON.parse(rawData);
  } catch {
    ws.send(JSON.stringify({ type: 'server.error', payload: { code: 'PARSE_ERROR', message: '无效 JSON 格式' } }));
    return;
  }

  switch (message.type) {
    // ==================== 客户端注册 ====================
    case 'client.register': {
      const parsed = ClientRegisterPayloadSchema.safeParse(message.payload);
      if (!parsed.success) {
        ws.send(JSON.stringify({ type: 'server.error', requestId: message.requestId, payload: { code: 'INVALID_PAYLOAD', message: parsed.error.message } }));
        return;
      }

      const info = parsed.data;
      clientsService.upsertClient(info);           // 写入/更新数据库
      connectionManager.register(info.clientId, ws); // 注册 WebSocket 连接

      // 记录审计日志
      auditService.log({
        actor: info.clientId,
        action: 'client.register',
        targetType: 'client',
        targetId: info.clientId,
        detail: `客户端 ${info.name} 注册成功`,
      });

      // 准备 ACK 响应
      const ackPayload: Record<string, unknown> = {
        message: `注册成功: ${info.clientId}`,
      };

      // 下发 FRPS 连接信息，让客户端知道如何连接 frps
      try {
        const frpsInfo = getFrpsConnectionInfo();
        ackPayload.frp = {
          serverAddr: frpsInfo.serverAddr,
          serverPort: frpsInfo.serverPort,
          authToken: frpsInfo.authToken,
        };
      } catch (err) {
        console.warn('跳过 FRP 注册信息下发:', err instanceof Error ? err.message : err);
      }

      // 协调客户端 HTTP 控制端点（分配端口、Token 等）
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
          console.warn('HTTP 控制面协调失败:', err instanceof Error ? err.message : err);
        }
      }

      ws.send(JSON.stringify({
        type: 'server.ack',
        requestId: message.requestId,
        payload: ackPayload,
      }));

      break;
    }

    // ==================== 客户端心跳 ====================
    case 'client.heartbeat': {
      const parsed = ClientHeartbeatPayloadSchema.safeParse(message.payload);
      if (!parsed.success) {
        ws.send(JSON.stringify({ type: 'server.error', requestId: message.requestId, payload: { code: 'INVALID_PAYLOAD', message: parsed.error.message } }));
        return;
      }

      const { clientId, cpu, memory, uptime } = parsed.data;
      clientsService.updateHeartbeat(clientId, { cpu, memory, uptime });

      ws.send(JSON.stringify({ type: 'server.ack', requestId: message.requestId, payload: { message: '心跳已收到' } }));
      break;
    }

    // ==================== HTTP 控制面就绪通知 ====================
    case 'client.http_ready': {
      const parsed = ClientHttpReadyPayloadSchema.safeParse(message.payload);
      if (!parsed.success) {
        ws.send(JSON.stringify({ type: 'server.error', requestId: message.requestId, payload: { code: 'INVALID_PAYLOAD', message: parsed.error.message } }));
        return;
      }

      const { clientId, baseUrl, remotePort } = parsed.data;
      clientsService.markHttpReady(clientId, baseUrl, remotePort);
      ws.send(JSON.stringify({ type: 'server.ack', requestId: message.requestId, payload: { message: 'HTTP 端点就绪' } }));
      saveDb();
      break;
    }

    // ==================== HTTP 控制面启动失败通知 ====================
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
      ws.send(JSON.stringify({ type: 'server.ack', requestId: message.requestId, payload: { message: 'HTTP 端点失败已记录' } }));
      saveDb();
      break;
    }

    // ==================== 传输进度上报 ====================
    case 'client.transfer.progress': {
      const parsed = ClientTransferProgressPayloadSchema.safeParse(message.payload);
      if (!parsed.success) {
        ws.send(JSON.stringify({ type: 'server.error', requestId: message.requestId, payload: { code: 'INVALID_PAYLOAD', message: parsed.error.message } }));
        return;
      }
      transferService.recordClientProgress(parsed.data.transferId, { downloadedBytes: parsed.data.downloadedBytes, writtenBytes: parsed.data.writtenBytes, totalBytes: parsed.data.totalBytes });
      ws.send(JSON.stringify({ type: 'server.ack', requestId: message.requestId, payload: { message: '进度已记录' } }));
      break;
    }

    // ==================== 传输完成上报 ====================
    case 'client.transfer.complete': {
      const parsed = ClientTransferCompletePayloadSchema.safeParse(message.payload);
      if (!parsed.success) {
        ws.send(JSON.stringify({ type: 'server.error', requestId: message.requestId, payload: { code: 'INVALID_PAYLOAD', message: parsed.error.message } }));
        return;
      }
      transferService.completeClientDownload(parsed.data.transferId);
      ws.send(JSON.stringify({ type: 'server.ack', requestId: message.requestId, payload: { message: '传输完成已记录' } }));
      saveDb();
      break;
    }

    // ==================== 传输失败上报 ====================
    case 'client.transfer.failed': {
      const parsed = ClientTransferFailedPayloadSchema.safeParse(message.payload);
      if (!parsed.success) {
        ws.send(JSON.stringify({ type: 'server.error', requestId: message.requestId, payload: { code: 'INVALID_PAYLOAD', message: parsed.error.message } }));
        return;
      }
      transferService.failTransfer(parsed.data.transferId, parsed.data);
      ws.send(JSON.stringify({ type: 'server.ack', requestId: message.requestId, payload: { message: '传输失败已记录' } }));
      saveDb();
      break;
    }

    // ==================== 客户端任务事件 ====================
    case 'client.job.event': {
      const eventPayload = message.payload as { jobId?: string; event?: string; data?: Record<string, unknown> };
      if (eventPayload.event && eventPayload.data) {
      resolveJobEvent(message.requestId ?? '', eventPayload.event, eventPayload.data);
      }
      break;
    }

    // ==================== 未知消息类型 ====================
    default: {
      ws.send(JSON.stringify({ type: 'server.error', requestId: message.requestId, payload: { code: 'UNKNOWN_TYPE', message: `未知消息类型: ${message.type}` } }));
    }
  }
}

/**
 * 处理 WebSocket 连接关闭
 * @param clientId - 断开的客户端 ID
 */
export function handleWsClose(clientId: string): void {
  connectionManager.remove(clientId);          // 移除连接记录
  clientsService.setOffline(clientId);          // 标记为离线

  // 记录断线审计日志
  auditService.log({
    actor: clientId,
    action: 'client.disconnect',
    targetType: 'client',
    targetId: clientId,
  });

  saveDb();
}
