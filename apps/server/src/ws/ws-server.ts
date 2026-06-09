/** @file WebSocket 服务路由注册
 *
 * 在 Fastify 上注册 WebSocket 端点 `/ws/client`。
 * 客户端通过 `ws://server:port/ws/client?clientId=xxx&token=xxx` 建立连接。
 */
import type { FastifyInstance } from 'fastify';
import { handleWsMessage, handleWsClose } from './ws-handlers.js';

/** WebSocket 连接 → 客户端 ID 映射表，用于关闭时查找对应 client */
const wsClientMap = new Map<object, string>();

/**
 * 注册 WebSocket 路由到 Fastify 实例
 * @param app - Fastify 实例
 */
export async function registerWsRoutes(app: FastifyInstance): Promise<void> {
  app.get('/ws/client', { websocket: true }, (socket, request) => {
    // 从查询参数中解析客户端 ID 和 Token
    const url = new URL(request.url, `http://${request.headers.host}`);
    const clientId = url.searchParams.get('clientId') || 'unknown';
    const token = url.searchParams.get('token') || '';

    // 保存映射关系，以便关闭时能获取到 clientId
    wsClientMap.set(socket, clientId);

    // 处理收到的消息
    socket.on('message', (data: Buffer) => {
      handleWsMessage(socket, data.toString());
    });

    // 处理连接关闭
    socket.on('close', () => {
      const cid = wsClientMap.get(socket) || 'unknown';
      handleWsClose(cid, socket as any);
      wsClientMap.delete(socket);
    });

    // 处理 WebSocket 错误（仅日志）
    socket.on('error', (err: Error) => {
      console.error(`客户端 ${clientId} 的 WebSocket 错误:`, err.message);
    });
  });
}
