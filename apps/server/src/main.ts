/** @file 服务端入口
 *
 * 启动 Fastify HTTP/WebSocket 服务，初始化数据库、FRP、路由和中间件。
 *
 * 架构说明：
 * - 控制面（WebSocket）：客户端注册、心跳、配置协调
 * - 数据面（client HTTP）：任务执行、文件管理、FRP 映射
 * - 管理面（HTTP API）：客户端发现、审计查询、AliyunDrive 管理
 */
import Fastify from 'fastify';
import cors from '@fastify/cors';
import websocket from '@fastify/websocket';
import multipart from '@fastify/multipart';
import { env, envSource } from './config/env.js';
import { initDb, saveDb, getDb } from './db/index.js';
import { clientRoutes } from './modules/clients/clients.routes.js';
import { fileRoutes } from './modules/files/files.routes.js';
import { clientHttpAdminRoutes } from './modules/client-http/client-http-admin.routes.js';
import { clientHttpPortRoutes } from './modules/client-http/client-http-port.routes.js';
import { taskRoutes } from './modules/tasks/tasks.routes.js';
import { aliyunDriveRoutes } from './modules/aliyundrive/aliyundrive.routes.js';
import { transferRoutes } from './modules/transfers/transfer.routes.js';
import { jobsProxyRoutes } from './modules/jobs/jobs-proxy.routes.js';
import { releaseRoutes } from './modules/updates/release.routes.js';
import { createCampaignRunner } from './modules/updates/campaign-runner.js';
import { createUpdateRepository } from './modules/updates/update-repository.js';
import { registerWsRoutes } from './ws/ws-server.js';
import { clientsService } from './modules/clients/clients.service.js';
import { startFrps, stopFrps } from './modules/frp/frps-manager.js';
import { cleanupStaleFrpsProxies } from './modules/frp/frps-cleanup.js';
import { transferCleanupService } from './modules/transfers/transfer-cleanup.service.js';
import * as fs from 'node:fs';
import * as path from 'node:path';

async function main(): Promise<void> {
  // ==================== 初始化数据库 ====================
  await initDb();
  console.log('数据库已初始化');
  console.log(`服务端配置: ${envSource.path} (${envSource.format})`);

  // ==================== 恢复未完成的更新 Campaign ====================
  const updateRepo = createUpdateRepository(getDb());
  const campaignRunner = createCampaignRunner({
    repo: updateRepo,
    runServerUpdate: async () => {},
    verifyServerVersion: () => '0.1.0',
  });
  await campaignRunner.recoverPendingCampaigns();

  // ==================== FRP 模式初始化 ====================
  console.log(`FRP 模式: ${env.FRP_MODE}`);
  if (env.FRP_MODE === 'builtin') {
    // 内置 frps：服务端自动下载并管理 frps 进程
    await startFrps();
  } else if (env.FRP_MODE === 'remote') {
    console.log(`  frps 地址: ${env.FRPS_HOST}:${env.FRPS_PORT}`);
  } else {
    console.log('  使用外部 frps（用户自行管理）');
  }

  // 启动时将所有客户端标记为离线（确保状态一致）
  const allClients = clientsService.listClients();
  for (const client of allClients) {
    clientsService.setOffline(client.id);
  }
  saveDb();

  // 清理因非正常关闭遗留的 FRPS 残留代理
  if (env.FRP_MODE === 'remote') {
    cleanupStaleFrpsProxies().catch((err: unknown) => {
      console.warn('[frps-cleanup] 后台清理失败:', err instanceof Error ? err.message : err);
    });
  }

  // ==================== 创建 Fastify 实例 ====================
  // 在打包模式下，pino worker 线程无法解析内部模块
  // 检测是否在打包模式：从 .cjs 文件且不在 node_modules 中运行
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

  // ==================== 注册插件 ====================
  await app.register(cors);
  await app.register(websocket);
  await app.register(multipart);

  // ==================== 注册 HTTP 路由 ====================
  await app.register(clientRoutes);           // 客户端发现 API
  await app.register(fileRoutes);             // 服务端文件仓库 API
  await app.register(clientHttpAdminRoutes);  // 客户端轻量管理编排 API
  await app.register(clientHttpPortRoutes);   // 业务映射端口分配 API
  await app.register(taskRoutes);             // 任务审计历史 API
  await app.register(aliyunDriveRoutes);      // 阿里云盘管理 API
  await app.register(transferRoutes);         // 文件传输 API
  await app.register(jobsProxyRoutes);        // 任务代理路由
  await app.register(releaseRoutes, {
    service: { listReleases: () => [], getRelease: () => { throw new Error('not implemented'); }, getArtifactDownload: () => { throw new Error('not implemented'); } },
  }); // 更新发布路由
  transferCleanupService.start();             // 传输清理定时任务

  // ==================== 注册 WebSocket 路由 ====================
  await registerWsRoutes(app);

  // ==================== Web 控制台（React SPA） ====================
  const webDir = path.resolve(
    typeof __dirname !== 'undefined' ? __dirname : import.meta.dirname,
    'web',
  );
  const webIndexPath = path.join(webDir, 'index.html');
  const hasWeb = fs.existsSync(webIndexPath);  // 检测 web 构建产物是否存在

  const contentTypeMap: Record<string, string> = {
    '.html': 'text/html; charset=utf-8',
    '.js': 'text/javascript; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.svg': 'image/svg+xml',
    '.png': 'image/png',
    '.ico': 'image/x-icon',
  };

  /** 发送 web 静态资源 */
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

  // SPA 静态资源路由
  app.get('/assets/*', async (request, reply) => {
    const wildcard = (request.params as { '*': string })['*'];
    if (!wildcard) return reply.callNotFound();
    const filePath = path.resolve(webDir, 'assets', wildcard);
    // 安全限制：只能访问 web/assets/ 目录下的文件
    if (!filePath.startsWith(path.resolve(webDir, 'assets')) || !fs.existsSync(filePath)) {
      return reply.callNotFound();
    }
    return sendWebAsset(reply, filePath);
  });

  // SPA fallback — 非 API/WS 路径返回 index.html（前端路由）
  app.setNotFoundHandler(async (request, reply) => {
    const url = (request as unknown as { raw: { url?: string } }).raw?.url ?? '/';
    if (hasWeb && !url.startsWith('/api') && !url.startsWith('/ws')) {
      return sendWebAsset(reply, webIndexPath);
    }
    return reply.code(404).send({ error: 'Not found' });
  });

  // ==================== 健康检查 ====================
  app.get('/api/health', async () => ({ status: 'ok', timestamp: Date.now() }));

  // 定期保存数据库（每 30 秒）
  setInterval(() => {
    saveDb();
  }, 30_000);

  // ==================== 优雅关闭 ====================
  const shutdown = async () => {
    console.log('正在关闭服务...');
    transferCleanupService.stop();
    stopFrps();
    saveDb();                     // 关闭前保存数据库
    await app.close();
    process.exit(0);
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);

  // ==================== 启动服务 ====================
  try {
    await app.listen({ port: env.SERVER_PORT, host: env.SERVER_HOST });
    console.log(`服务端运行于 http://${env.SERVER_HOST}:${env.SERVER_PORT}`);
    console.log(`WebSocket 端点: ws://${env.SERVER_HOST}:${env.SERVER_PORT}/ws/client`);
  } catch (err) {
    app.log.error(err);
    process.exit(1);
  }
}

main();
