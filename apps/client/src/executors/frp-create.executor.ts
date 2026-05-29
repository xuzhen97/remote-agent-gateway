import * as path from 'node:path';
import * as fs from 'node:fs';
import type { ConnectionManager } from '../core/connection.js';
import type { ClientConfig } from '../config/client.config.js';
import type { FrpCreateProxyPayload } from '@rag/shared';
import { setFrpsInfo, rebuildFrpcDaemon } from '../runtime/frpc-daemon.js';

export async function executeFrpCreate(
  conn: ConnectionManager,
  config: ClientConfig,
  taskId: string,
  payload: FrpCreateProxyPayload,
): Promise<unknown> {
  if (!config.frpcPath) {
    throw new Error('frpcPath not configured');
  }

  const { mappingId, name, proxyType, localIp, localPort, remotePort, customDomain, serverAddr, serverPort, authToken } = payload;
  const frpcWorkDir = path.resolve(config.frpcWorkDir ?? path.join(config.workspaceDir, 'frp'));

  const frpsAddr = serverAddr || new URL(config.apiBaseUrl).hostname;
  const frpsPort = serverPort || 7000;
  const frpsToken = authToken || config.token;

  setFrpsInfo({ serverAddr: frpsAddr, serverPort: frpsPort, authToken: frpsToken });

  // Save mapping config for daemon to pick up
  const mappingsDir = path.join(frpcWorkDir, 'mappings');
  fs.mkdirSync(mappingsDir, { recursive: true });

  const configContent = [
    `name = "${name}"`,
    `type = "${proxyType}"`,
    `localIP = "${localIp}"`,
    `localPort = ${localPort}`,
    `remotePort = ${remotePort}`,
    customDomain ? `customDomains = ["${customDomain}"]` : '',
  ].filter(Boolean).join('\n');

  fs.writeFileSync(path.join(mappingsDir, `${mappingId}.toml`), configContent);

  conn.send({
    type: 'task.log',
    payload: { taskId, stream: 'stdout', content: `Mapping config saved for ${mappingId}\n` },
  });

  // Rebuild daemon config with all mappings and restart
  const result = rebuildFrpcDaemon(config);

  if (result) {
    conn.send({
      type: 'task.log',
      payload: { taskId, stream: 'stdout', content: `frpc daemon restarted with ${result.proxyCount} proxies\n` },
    });
  } else {
    conn.send({
      type: 'task.log',
      payload: { taskId, stream: 'stderr', content: 'frpc daemon rebuild failed\n' },
    });
  }

  return { mappingId, proxies: result?.proxyCount ?? 0 };
}
