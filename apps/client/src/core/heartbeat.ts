import type { ConnectionManager } from './connection.js';
import type { ClientConfig } from '../config/client.config.js';
import * as si from 'systeminformation';

let heartbeatTimer: ReturnType<typeof setInterval> | null = null;

export function startHeartbeat(
  conn: ConnectionManager,
  config: ClientConfig,
  intervalMs = 30_000,
): void {
  if (heartbeatTimer) {
    clearInterval(heartbeatTimer);
  }

  heartbeatTimer = setInterval(async () => {
    if (!conn.isConnected()) return;

    let cpu = 0;
    let memory = 0;
    let uptime = 0;

    try {
      const load = await si.currentLoad();
      cpu = load.currentLoad ?? 0;

      const mem = await si.mem();
      memory = (mem.used / mem.total) * 100;

      uptime = (await si.time()).uptime;
    } catch {
      // ignore errors
    }

    conn.send({
      type: 'client.heartbeat',
      payload: {
        clientId: config.clientId,
        cpu: Math.round(cpu * 100) / 100,
        memory: Math.round(memory * 100) / 100,
        uptime,
      },
    });
  }, intervalMs);
}

export function stopHeartbeat(): void {
  if (heartbeatTimer) {
    clearInterval(heartbeatTimer);
    heartbeatTimer = null;
  }
}
