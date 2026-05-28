import type { FastifyInstance } from 'fastify';
import { handleWsMessage, handleWsClose } from './ws-handlers.js';

// Track ws -> clientId mapping for close handling
const wsClientMap = new Map<object, string>();

export async function registerWsRoutes(app: FastifyInstance): Promise<void> {
  app.get('/ws/client', { websocket: true }, (socket, request) => {
    const url = new URL(request.url, `http://${request.headers.host}`);
    const clientId = url.searchParams.get('clientId') || 'unknown';
    const token = url.searchParams.get('token') || '';

    // Store mapping for close handler
    wsClientMap.set(socket, clientId);

    socket.on('message', (data: Buffer) => {
      handleWsMessage(socket, data.toString());
    });

    socket.on('close', () => {
      const cid = wsClientMap.get(socket) || 'unknown';
      handleWsClose(cid);
      wsClientMap.delete(socket);
    });

    socket.on('error', (err: Error) => {
      console.error(`WebSocket error for client ${clientId}:`, err.message);
    });
  });
}
