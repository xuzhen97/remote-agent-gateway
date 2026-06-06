import { loadConfig } from './config/client.config.js';
import { ConnectionManager } from './core/connection.js';
import { sendRegister } from './core/register.js';
import { startHeartbeat } from './core/heartbeat.js';
import { startFrpcDaemon, stopFrpcDaemon, setFrpsInfo } from './runtime/frpc-daemon.js';
import { startControlHttpServer, stopControlHttpServer } from './runtime/control-http/server.js';
import { handleTransferWsMessage } from './runtime/transfers/transfer-ws-handler.js';
import type { ServerAckPayload } from '@rag/shared';

async function main(): Promise<void> {
  console.log('Remote Agent Gateway - Client Agent v0.1.0');

  // Load config
  let config;
  try {
    config = loadConfig();
  } catch (err) {
    console.error('Failed to load config:', err instanceof Error ? err.message : err);
    process.exit(1);
  }

  console.log(`Client config: ${config.source?.path ?? 'unknown'} (${config.source?.format ?? 'unknown'})`);

  console.log(`Client ID: ${config.clientId}`);
  console.log(`Server: ${config.serverUrl}`);

  // Start local HTTP control service
  try {
    const httpState = await startControlHttpServer({
      clientId: config.clientId,
      host: config.httpHost,
      port: config.httpPort,
      token: 'bootstrap-token',
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
    console.log(`HTTP control service started on ${httpState.host}:${httpState.port}`);
  } catch (err) {
    console.warn('Failed to start HTTP control service:', err instanceof Error ? err.message : err);
  }

  // Create connection manager
  const conn = new ConnectionManager(config);

  // Handle incoming messages
  conn.onMessage(async (rawData: string) => {
    let message: { type: string; payload: unknown };
    try {
      message = JSON.parse(rawData);
    } catch {
      return;
    }

    if (handleTransferWsMessage({ message, config, send: (out) => conn.send(out) })) {
      return;
    }

    switch (message.type) {
      case 'server.ack': {
        // Extract FRP config and HTTP control if provided
        const ackPayload = message.payload as ServerAckPayload;

        if (ackPayload.httpControl) {
          const control = ackPayload.httpControl;
          console.log(`httpControl received: ${control.publicBaseUrl}`);

          // Restart HTTP server with coordinated token
          try {
            await stopControlHttpServer();
            await startControlHttpServer({
              clientId: config.clientId,
              host: control.localHost,
              port: control.localPort,
              token: control.token,
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
            console.warn('Failed to restart HTTP with coordinated token:', err instanceof Error ? err.message : err);
          }

          // Start FRP daemon with protected control mapping
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
                protected: true,
              });
              conn.send({
                type: 'client.http_ready',
                requestId: `http_ready_${config.clientId}`,
                payload: { clientId: config.clientId, remotePort: control.remotePort, baseUrl: control.publicBaseUrl },
              });
              console.log(`Client HTTP endpoint ready: ${control.publicBaseUrl}`);
            } catch (err) {
              conn.send({
                type: 'client.http_failed',
                requestId: `http_failed_${config.clientId}`,
                payload: { clientId: config.clientId, remotePort: control.remotePort, reason: err instanceof Error ? err.message : String(err) },
              });
              console.error('Failed to start control tunnel:', err instanceof Error ? err.message : err);
            }
          }
        } else if (ackPayload.frp && config.frpcPath) {
          const frp = ackPayload.frp;
          console.log(`frps config received: ${frp.serverAddr}:${frp.serverPort}`);
          setFrpsInfo({ serverAddr: frp.serverAddr, serverPort: frp.serverPort, authToken: frp.authToken });
        }
        break;
      }

      case 'server.error':
        console.error('Server error:', (message.payload as Record<string, unknown>)?.message);
        break;

      default:
        console.log('Unknown message type:', message.type);
    }
  });

  // Handle disconnect
  conn.onClose(() => {
    console.log('Disconnected from server');
  });

  // Handle (re)connect — re-register on every connection
  conn.onConnect(async (isReconnect: boolean) => {
    if (isReconnect) {
      console.log('Reconnected, re-registering...');
      try {
        await sendRegister(conn, config);
        // Restart heartbeat with fresh interval to avoid duplicate timers
        startHeartbeat(conn, config);
        console.log('Re-registration complete');
      } catch (err) {
        console.error('Re-registration failed:', err instanceof Error ? err.message : err);
      }
    }
  });

  // Connect to server
  conn.connect();

  // Wait for connection, then register
  await new Promise<void>((resolve) => {
    const check = setInterval(() => {
      if (conn.isConnected()) {
        clearInterval(check);
        resolve();
      }
    }, 100);
  });

  console.log('Connected. Registering...');
  await sendRegister(conn, config);

  // Start heartbeat
  startHeartbeat(conn, config);

  console.log('Client agent ready. Waiting for tasks...');

  // frpc daemon is started on-demand via the web console or API.
  // The client reports frpc availability on registration.
  if (config.frpcPath) {
    console.log(`frpc available: ${config.frpcPath}`);
  }

  // Graceful shutdown
  const shutdown = () => {
    console.log('Shutting down...');
    stopFrpcDaemon();
    stopControlHttpServer();
    conn.disconnect();
    process.exit(0);
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);

  // Keep alive
  process.stdin.resume();
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
