import { loadConfig } from './config/client.config.js';
import { ConnectionManager } from './core/connection.js';
import { sendRegister } from './core/register.js';
import { startHeartbeat } from './core/heartbeat.js';
import { dispatchTask } from './core/task-dispatcher.js';
import { startFrpcDaemon, stopFrpcDaemon, setFrpsInfo } from './runtime/frpc-daemon.js';

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

  // Create connection manager
  const conn = new ConnectionManager(config);

  // Handle incoming messages
  conn.onMessage((rawData: string) => {
    let message: { type: string; payload: unknown };
    try {
      message = JSON.parse(rawData);
    } catch {
      return;
    }

    switch (message.type) {
      case 'server.ack': {
        // Extract FRP config if provided
        const ackPayload = message.payload as Record<string, unknown>;
        if (ackPayload.frp && config.frpcPath) {
          const frp = ackPayload.frp as { serverAddr: string; serverPort: number; authToken: string };
          console.log(`frps config received: ${frp.serverAddr}:${frp.serverPort}`);
          setFrpsInfo({ serverAddr: frp.serverAddr, serverPort: frp.serverPort, authToken: frp.authToken });
        }
        break;
      }

      case 'server.error':
        console.error('Server error:', (message.payload as Record<string, unknown>)?.message);
        break;

      case 'task.dispatch': {
        const payload = message.payload as { taskId: string; taskType: string; payload: unknown };
        dispatchTask(conn, config, payload);
        break;
      }

      default:
        console.log('Unknown message type:', message.type);
    }
  });

  // Handle disconnect
  conn.onClose(() => {
    console.log('Disconnected from server');
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
