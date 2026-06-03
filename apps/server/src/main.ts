import Fastify from 'fastify';
import cors from '@fastify/cors';
import websocket from '@fastify/websocket';
import multipart from '@fastify/multipart';
import { env, envSource } from './config/env.js';
import { initDb, saveDb } from './db/index.js';
import { clientRoutes } from './modules/clients/clients.routes.js';
import { fileRoutes } from './modules/files/files.routes.js';
import { frpRoutes } from './modules/frp/frp.routes.js';
import { clientHttpAdminRoutes } from './modules/client-http/client-http-admin.routes.js';
import { registerWsRoutes } from './ws/ws-server.js';
import { clientsService } from './modules/clients/clients.service.js';
import { startFrps, stopFrps } from './modules/frp/frps-manager.js';
import * as fs from 'node:fs';
import * as path from 'node:path';

async function main(): Promise<void> {
  // Initialize database
  await initDb();
  console.log('Database initialized');
  console.log(`Server config: ${envSource.path} (${envSource.format})`);

  // FRP mode
  console.log(`FRP mode: ${env.FRP_MODE}`);
  if (env.FRP_MODE === 'builtin') {
    await startFrps();
  } else if (env.FRP_MODE === 'remote') {
    console.log(`  frps address: ${env.FRPS_HOST}:${env.FRPS_PORT}`);
  } else {
    console.log('  Using external frps (user-managed)');
  }

  // Mark all clients as offline on startup
  const allClients = clientsService.listClients();
  for (const client of allClients) {
    clientsService.setOffline(client.id);
  }
  saveDb();

  // Create Fastify instance
  // In bundled mode, pino worker threads can't resolve internal modules.
  // Detect bundled mode: running from a .cjs file that's not in node_modules.
  const isBundled = typeof __dirname !== 'undefined'
    && !__dirname.includes('node_modules')
    && (process.argv[1] ?? '').endsWith('.cjs');

  let loggerConfig: Record<string, unknown>;
  if (!isBundled) {
    try {
      require.resolve('pino-pretty');
      loggerConfig = {
        transport: { target: 'pino-pretty', options: { colorize: true } },
      };
    } catch {
      loggerConfig = { level: 'info' };
    }
  } else {
    loggerConfig = { level: 'info' };
  }

  const app = Fastify({ logger: loggerConfig });

  // Register plugins
  await app.register(cors);
  await app.register(websocket);
  await app.register(multipart);

  // Register routes
  await app.register(clientRoutes);
  await app.register(fileRoutes);
  await app.register(frpRoutes);
  await app.register(clientHttpAdminRoutes);

  // Register WebSocket
  await registerWsRoutes(app);

  // Web console — serve React SPA (or legacy index.html fallback)
  const webDir = path.resolve(
    typeof __dirname !== 'undefined' ? __dirname : import.meta.dirname,
    'web',
  );
  const webIndexPath = path.join(webDir, 'index.html');
  const hasWeb = fs.existsSync(webIndexPath);

  const contentTypeMap: Record<string, string> = {
    '.html': 'text/html; charset=utf-8',
    '.js': 'text/javascript; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.svg': 'image/svg+xml',
    '.png': 'image/png',
    '.ico': 'image/x-icon',
  };

  function sendWebAsset(reply: any, filePath: string) {
    const ext = path.extname(filePath);
    reply.header('Content-Type', contentTypeMap[ext] ?? 'application/octet-stream');
    return reply.send(fs.readFileSync(filePath));
  }

  app.get('/', async (_req, reply) => {
    if (hasWeb) return sendWebAsset(reply, webIndexPath);
    return reply.redirect('/api/health');
  });
  app.get('/admin', async (_req, reply) => reply.redirect('/'));

  // SPA asset and fallback routes
  app.get('/assets/*', async (request, reply) => {
    const wildcard = (request.params as { '*': string })['*'];
    if (!wildcard) return reply.callNotFound();
    const filePath = path.resolve(webDir, 'assets', wildcard);
    if (!filePath.startsWith(path.resolve(webDir, 'assets')) || !fs.existsSync(filePath)) {
      return reply.callNotFound();
    }
    return sendWebAsset(reply, filePath);
  });

  // SPA fallback — serve index.html for unknown paths if React is present
  app.setNotFoundHandler(async (request, reply) => {
    const url = (request as unknown as { raw: { url?: string } }).raw?.url ?? '/';
    if (hasWeb && !url.startsWith('/api') && !url.startsWith('/ws')) {
      return sendWebAsset(reply, webIndexPath);
    }
    return reply.code(404).send({ error: 'Not found' });
  });

  // Health check
  app.get('/api/health', async () => ({ status: 'ok', timestamp: Date.now() }));

  // Periodic DB save
  setInterval(() => {
    saveDb();
  }, 30_000);

  // Graceful shutdown
  const shutdown = async () => {
    console.log('Shutting down...');
    stopFrps();
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
