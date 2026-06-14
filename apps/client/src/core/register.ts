import type { ConnectionManager } from './connection.js';
import type { ClientConfig } from '../config/client.config.js';
import { CLIENT_VERSION } from '../version.js';

export async function sendRegister(
  conn: ConnectionManager,
  config: ClientConfig,
): Promise<void> {
  let os = 'unknown';
  let arch = 'unknown';
  let hostname = 'unknown';

  try {
    const si = await import('systeminformation');
    const osInfo = await si.osInfo();
    os = osInfo.platform;
    arch = osInfo.arch;
  } catch {
    os = process.platform;
    arch = process.arch;
  }

  try {
    hostname = (await import('node:os')).hostname();
  } catch {
    // ignore
  }

  conn.send({
    type: 'client.register',
    requestId: `reg_${config.clientId}`,
    payload: {
      clientId: config.clientId,
      name: config.clientName,
      hostname,
      os,
      arch,
      version: CLIENT_VERSION,
      tags: config.tags,
      http: {
        localHost: config.httpHost,
        localPort: config.httpPort,
        protocol: 'http' as const,
      },
      capabilities: {
        httpControl: true,
        jobs: true,
        sse: true,
        files: true,
        frpMappings: true,
        updates: true,
      },
    },
  });
}
