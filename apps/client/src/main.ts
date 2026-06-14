/** @file 客户端入口
 *
 * 启动流程：
 * 1. 加载配置 → 启动本地 HTTP 控制服务
 * 2. 连接服务端 WebSocket → 发送注册消息
 * 3. 服务端返回 ACK（含 FRP 配置和 HTTP 控制面协调信息）
 * 4. 重启 HTTP 服务（使用协调后的 Token）→ 启动 frpc 控制隧道
 * 5. 发送 http_ready 通知服务端 → 开始心跳
 */
import { loadConfig } from './config/client.config.js';
import { ConnectionManager } from './core/connection.js';
import { sendRegister } from './core/register.js';
import { startHeartbeat } from './core/heartbeat.js';
import { startFrpcDaemon, stopFrpcDaemon, setFrpsInfo } from './runtime/frpc-daemon.js';
import { startControlHttpServer, stopControlHttpServer, getJobManager } from './runtime/control-http/server.js';
import { handleTransferWsMessage } from './runtime/transfers/transfer-ws-handler.js';
import { forwardServerJobRun } from './server-job-runner.js';
import { handleUpdateWsMessage } from './runtime/updates/update-ws-handler.js';
import { createClientUpdater } from './runtime/updates/client-updater.js';
import { createUpdateDeps } from './runtime/updates/update-deps.js';
import { CLIENT_VERSION } from './version.js';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import type { ServerAckPayload } from '@rag/shared';

function writeClientReadyMarker(): void {
  const deployRoot = process.env.RAG_DEPLOY_ROOT;
  if (!deployRoot) return;
  const stateDir = join(resolve(deployRoot), 'state');
  mkdirSync(stateDir, { recursive: true });
  writeFileSync(join(stateDir, 'client-ready.json'), `${JSON.stringify({ version: CLIENT_VERSION, readyAt: Date.now() }, null, 2)}\n`);
}

const CLIENT_EXIT_UPDATE_RESTART = 20;

async function main(): Promise<void> {
  console.log(`Remote Agent Gateway - 客户端 Agent v${CLIENT_VERSION}`);

  // ==================== 加载配置 ====================
  let config;
  try {
    config = loadConfig();
  } catch (err) {
    console.error('加载配置失败:', err instanceof Error ? err.message : err);
    process.exit(1);
  }

  console.log(`客户端配置: ${config.source?.path ?? '未知'} (${config.source?.format ?? '未知'})`);
  console.log(`客户端 ID: ${config.clientId}`);
  console.log(`服务端: ${config.serverUrl}`);

  // ==================== 启动本地 HTTP 控制服务 ====================
  // 首次启动时使用 bootstrap token，服务端协调后会获得正式 token 并重启
  try {
    const httpState = await startControlHttpServer({
      clientId: config.clientId,
      host: config.httpHost,
      port: config.httpPort,
      token: 'bootstrap-token',  // 初始引导 Token
      workspaceDir: config.workspaceDir,
      allowedRoots: config.allowedRoots,
      apiBaseUrl: config.apiBaseUrl,
      serverToken: config.token,
      frpcPath: config.frpcPath,
      frpcWorkDir: config.frpcWorkDir,
      job: {
        maxConcurrent: config.jobMaxConcurrent,
        defaultTimeoutMs: config.jobDefaultTimeoutMs,
        maxTimeoutMs: config.jobMaxTimeoutMs,
        logBufferLines: config.jobLogBufferLines,
      },
      taskAuditStorePath: config.taskAuditStorePath,
    });
    console.log(`HTTP 控制服务已启动: ${httpState.host}:${httpState.port}`);
  } catch (err) {
    console.warn('HTTP 控制服务启动失败:', err instanceof Error ? err.message : err);
  }

  // ==================== 创建 WebSocket 连接管理器 ====================
  const conn = new ConnectionManager(config);

  // ==================== 处理服务端下发的消息 ====================
  conn.onMessage(async (rawData: string) => {
    let message: { type: string; payload: unknown };
    try {
      message = JSON.parse(rawData);
    } catch {
      return;
    }

    // 先检查是否是更新消息
    if (await handleUpdateWsMessage({
      message,
      createUpdater: (onPhase) => createClientUpdater({
        ...createUpdateDeps(config),
        onPhase,
        startNew: async () => {
          setTimeout(() => process.exit(CLIENT_EXIT_UPDATE_RESTART), 100);
        },
      }),
      send: (out) => conn.send(out),
      currentVersion: CLIENT_VERSION,
    })) {
      return;
    }

    // 先检查是否是传输 WebSocket 消息（阿里云盘传输等）
    if (handleTransferWsMessage({ message, config, send: (out) => conn.send(out) })) {
      return;
    }

    switch (message.type) {
      // ==================== 服务端 ACK（注册确认） ====================
      case 'server.ack': {
        const ackPayload = message.payload as ServerAckPayload;

        if (ackPayload.httpControl) {
          // 服务端协调了 HTTP 控制面信息（端口、Token、Base URL）
          const control = ackPayload.httpControl;
          console.log(`收到 HTTP 控制面信息: ${control.publicBaseUrl}`);

          // 使用正式 Token 重启 HTTP 服务
          try {
            await stopControlHttpServer();
            await startControlHttpServer({
              clientId: config.clientId,
              host: control.localHost,
              port: control.localPort,
              token: control.token,  // 替换为服务端协调后的正式 Token
              workspaceDir: config.workspaceDir,
              allowedRoots: config.allowedRoots,
              apiBaseUrl: config.apiBaseUrl,
              serverToken: config.token,
              frpcPath: config.frpcPath,
              frpcWorkDir: config.frpcWorkDir,
              job: {
                maxConcurrent: config.jobMaxConcurrent,
                defaultTimeoutMs: config.jobDefaultTimeoutMs,
                maxTimeoutMs: config.jobMaxTimeoutMs,
                logBufferLines: config.jobLogBufferLines,
              },
              taskAuditStorePath: config.taskAuditStorePath,
            });
          } catch (err) {
            console.warn('使用协调 Token 重启 HTTP 服务失败:', err instanceof Error ? err.message : err);
          }

          // 启动 FRP 守护进程，建立控制隧道（protected 映射不会被用户删除）
          if (config.frpcPath) {
            if (ackPayload.frp) {
              setFrpsInfo({
                serverAddr: ackPayload.frp.serverAddr,
                serverPort: ackPayload.frp.serverPort,
                authToken: ackPayload.frp.authToken,
              });
            }
            try {
              startFrpcDaemon(config, {
                name: `rag-${config.clientId}-http-control`,
                type: 'tcp',
                localIP: control.localHost,
                localPort: control.localPort,
                remotePort: control.remotePort,
                protected: true,  // 保护映射：用户不能通过 API 删除
              });
              // 通知服务端 HTTP 端点已就绪
              conn.send({
                type: 'client.http_ready',
                requestId: `http_ready_${config.clientId}`,
                payload: { clientId: config.clientId, remotePort: control.remotePort, baseUrl: control.publicBaseUrl },
              });
              console.log(`客户端 HTTP 端点就绪: ${control.publicBaseUrl}`);
            } catch (err) {
              conn.send({
                type: 'client.http_failed',
                requestId: `http_failed_${config.clientId}`,
                payload: { clientId: config.clientId, remotePort: control.remotePort, reason: err instanceof Error ? err.message : String(err) },
              });
              console.error('启动控制隧道失败:', err instanceof Error ? err.message : err);
            }
          }
        } else if (ackPayload.frp && config.frpcPath) {
          // 只有 FRP 配置（没有 HTTP 控制面信息）
          const frp = ackPayload.frp;
          console.log(`收到 FRP 配置: ${frp.serverAddr}:${frp.serverPort}`);
          setFrpsInfo({ serverAddr: frp.serverAddr, serverPort: frp.serverPort, authToken: frp.authToken });
        }
        break;
      }

      // ==================== 服务端错误 ====================
      case 'server.error':
        console.error('服务端错误:', (message.payload as Record<string, unknown>)?.message);
        break;

      // ==================== 服务端下发任务执行 ====================
      case 'server.job.run': {
        const mgr = getJobManager();
        if (!mgr) {
          conn.send({
            type: 'client.job.event',
            requestId: (message as { requestId?: string }).requestId,
            payload: { event: 'job.failed', data: { error: '任务管理器不可用' } },
          });
          break;
        }
        const runPayload = message.payload as { command: string; args?: string[]; timeoutMs?: number; cwd?: string; env?: Record<string, string> };
        await forwardServerJobRun({
          requestId: (message as { requestId?: string }).requestId,
          payload: {
            command: runPayload.command,
            args: runPayload.args,
            timeoutMs: runPayload.timeoutMs,
            cwd: runPayload.cwd,
            env: runPayload.env,
          },
          manager: mgr,
          send: (out) => conn.send(out),
        });
        break;
      }

      // ==================== 服务端取消任务 ====================
      case 'server.job.cancel': {
        const mgr = getJobManager();
        if (!mgr) break;
        const cancelPayload = message.payload as { jobId: string };
        try {
          mgr.cancel(cancelPayload.jobId);
        } catch (err) {
          console.error('取消任务失败:', err instanceof Error ? err.message : err);
        }
        break;
      }

      default:
        console.log('未知消息类型:', message.type);
    }
  });

  // 处理连接断开
  conn.onClose(() => {
    console.log('与服务端断开连接');
  });

  // 处理重连 — 每次重连后重新注册
  conn.onConnect(async (isReconnect: boolean) => {
    if (isReconnect) {
      console.log('已重连，正在重新注册...');
      try {
        await sendRegister(conn, config);
        writeClientReadyMarker();
        // 重新启动心跳（避免重复定时器）
        startHeartbeat(conn, config);
        console.log('重新注册完成');
      } catch (err) {
        console.error('重新注册失败:', err instanceof Error ? err.message : err);
      }
    }
  });

  // ==================== 连接服务端 ====================
  conn.connect();

  // 等待连接建立
  await new Promise<void>((resolve) => {
    const check = setInterval(() => {
      if (conn.isConnected()) {
        clearInterval(check);
        resolve();
      }
    }, 100);
  });

  console.log('已连接，正在注册...');
  await sendRegister(conn, config);
  writeClientReadyMarker();

  // 启动心跳
  startHeartbeat(conn, config);

  console.log('客户端就绪，等待任务...');

  // frpc 守护进程通过 Web 控制台或 API 按需启动
  // 客户端在注册时声明 frpc 可用性
  if (config.frpcPath) {
    console.log(`frpc 可用: ${config.frpcPath}`);
  }

  // ==================== 优雅关闭 ====================
  const shutdown = () => {
    console.log('正在关闭...');
    stopFrpcDaemon();
    stopControlHttpServer();
    conn.disconnect();
    process.exit(0);
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);

  // 保持进程存活
  process.stdin.resume();
}

main().catch((err) => {
  console.error('严重错误:', err);
  process.exit(1);
});
