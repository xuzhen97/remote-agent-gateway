import * as path from 'node:path';
import * as fs from 'node:fs';
import type { ConnectionManager } from '../core/connection.js';
import type { ClientConfig } from '../config/client.config.js';
import type { FrpRemoveProxyPayload } from '@rag/shared';
import { rebuildFrpcDaemon } from '../runtime/frpc-daemon.js';

export async function executeFrpRemove(
  conn: ConnectionManager,
  config: ClientConfig,
  taskId: string,
  payload: FrpRemoveProxyPayload,
): Promise<unknown> {
  const { mappingId } = payload;
  const frpcWorkDir = path.resolve(config.frpcWorkDir ?? path.join(config.workspaceDir, 'frp'));
  const configPath = path.join(frpcWorkDir, 'mappings', `${mappingId}.toml`);

  // Delete mapping config
  try { fs.unlinkSync(configPath); } catch { /* already gone */ }

  conn.send({
    type: 'task.log',
    payload: { taskId, stream: 'stdout', content: `Mapping ${mappingId} config removed\n` },
  });

  // Rebuild daemon without this mapping
  const result = rebuildFrpcDaemon(config);

  conn.send({
    type: 'task.log',
    payload: { taskId, stream: 'stdout', content: result
      ? `frpc daemon restarted with ${result.proxyCount} proxies`
      : 'frpc daemon stopped (no more proxies)' },
  });

  return { mappingId, removed: true, proxies: result?.proxyCount ?? 0 };
}
