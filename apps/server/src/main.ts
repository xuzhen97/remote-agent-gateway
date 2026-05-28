import Fastify from 'fastify';
import cors from '@fastify/cors';
import websocket from '@fastify/websocket';
import multipart from '@fastify/multipart';
import { env } from './config/env.js';
import { initDb, saveDb } from './db/index.js';
import { clientRoutes } from './modules/clients/clients.routes.js';
import { taskRoutes } from './modules/tasks/tasks.routes.js';
import { fileRoutes } from './modules/files/files.routes.js';
import { frpRoutes } from './modules/frp/frp.routes.js';
import { agentRoutes } from './modules/agent/agent.routes.js';
import { registerWsRoutes } from './ws/ws-server.js';
import { clientsService } from './modules/clients/clients.service.js';

async function main(): Promise<void> {
  // Initialize database
  await initDb();
  console.log('Database initialized');

  // Mark all clients as offline on startup
  const allClients = clientsService.listClients();
  for (const client of allClients) {
    clientsService.setOffline(client.id);
  }
  saveDb();

  // Create Fastify instance
  const app = Fastify({
    logger: {
      transport: {
        target: 'pino-pretty',
        options: { colorize: true },
      },
    },
  });

  // Register plugins
  await app.register(cors);
  await app.register(websocket);
  await app.register(multipart);

  // Register routes
  await app.register(clientRoutes);
  await app.register(taskRoutes);
  await app.register(fileRoutes);
  await app.register(frpRoutes);
  await app.register(agentRoutes);

  // Register WebSocket
  await registerWsRoutes(app);

  // Health check
  app.get('/api/health', async () => ({ status: 'ok', timestamp: Date.now() }));

  // Periodic DB save
  setInterval(() => {
    saveDb();
  }, 30_000);

  // Graceful shutdown
  const shutdown = async () => {
    console.log('Shutting down...');
    saveDb();
    await app.close();
    process.exit(0);
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);

  // Start
  try {
    await app.listen({ port: env.SERVER_PORT, host: env.SERVER_HOST });
    console.log(`Server running at http://${env.SERVER_HOST}:${env.SERVER_PORT}`);
    console.log(`WebSocket endpoint: ws://${env.SERVER_HOST}:${env.SERVER_PORT}/ws/client`);
  } catch (err) {
    app.log.error(err);
    process.exit(1);
  }
}

main();
