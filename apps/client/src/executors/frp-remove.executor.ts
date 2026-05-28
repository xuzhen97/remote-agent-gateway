import * as path from 'node:path';
import * as fs from 'node:fs';
import type { ConnectionManager } from '../core/connection.js';
import type { ClientConfig } from '../config/client.config.js';
import type { FrpRemoveProxyPayload } from '@rag/shared';
import { runningProcesses } from './frp-create.executor.js';

export async function executeFrpRemove(
  conn: ConnectionManager,
  config: ClientConfig,
  taskId: string,
  payload: FrpRemoveProxyPayload,
): Promise<unknown> {
  const { mappingId } = payload;
  const frpcWorkDir = config.frpcWorkDir ?? path.join(config.workspaceDir, 'frp');

  // Kill the process if still running
  const proc = runningProcesses.get(mappingId);
  if (proc) {
    try {
      process.kill(proc.pid, 'SIGTERM');
      conn.send({
        type: 'task.log',
        payload: { taskId, stream: 'stdout', content: `Stopped frpc process ${proc.pid}\n` },
      });
    } catch {
      // Process may already be dead
    }
    runningProcesses.delete(mappingId);
  }

  // Clean up config and pid files
  const configPath = path.join(frpcWorkDir, 'mappings', `${mappingId}.toml`);
  const pidPath = path.join(frpcWorkDir, 'pids', `${mappingId}.pid`);

  try { fs.unlinkSync(configPath); } catch { /* ignore */ }
  try { fs.unlinkSync(pidPath); } catch { /* ignore */ }

  return { mappingId, removed: true };
}
