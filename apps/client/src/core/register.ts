import type { ConnectionManager } from './connection.js';
import type { ClientConfig } from '../config/client.config.js';
import { readFileSync } from 'node:fs';

function readClientVersion(): string {
  try {
    const pkgJson = JSON.parse(readFileSync(new URL('../../package.json', import.meta.url), 'utf-8'));
    return pkgJson.version || '0.0.0';
  } catch {
    return '0.0.0';
  }
}

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
      version: readClientVersion(),
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
