import type { ConnectionManager } from './connection.js';
import type { ClientConfig } from '../config/client.config.js';
import type {
  ExecScriptPayload,
  ExecCommandPayload,
  PushFilePayload,
  FrpCreateProxyPayload,
  FrpRemoveProxyPayload,
} from '@rag/shared';
import { executeScript } from '../executors/exec-script.executor.js';
import { executeCommand } from '../executors/exec-command.executor.js';
import { executePushFile } from '../executors/push-file.executor.js';
import { executeFrpCreate } from '../executors/frp-create.executor.js';
import { executeFrpRemove } from '../executors/frp-remove.executor.js';

export async function dispatchTask(
  conn: ConnectionManager,
  config: ClientConfig,
  message: { taskId: string; taskType: string; payload: unknown },
): Promise<void> {
  const { taskId, taskType, payload } = message;

  console.log(`Task dispatched: ${taskId} (${taskType})`);

  // Send running status
  conn.send({
    type: 'task.result',
    requestId: taskId,
    payload: { taskId, status: 'running' },
  });

  try {
    let result: unknown;

    switch (taskType) {
      case 'health_check':
        result = { exitCode: 0, message: 'ok' };
        break;

      case 'exec_script':
        result = await executeScript(conn, config, taskId, payload as ExecScriptPayload);
        break;

      case 'exec_command':
        result = await executeCommand(conn, config, taskId, payload as ExecCommandPayload);
        break;

      case 'push_file':
        result = await executePushFile(conn, config, taskId, payload as PushFilePayload);
        break;

      case 'frp_create_proxy':
        result = await executeFrpCreate(conn, config, taskId, payload as FrpCreateProxyPayload);
        break;

      case 'frp_remove_proxy':
        result = await executeFrpRemove(conn, config, taskId, payload as FrpRemoveProxyPayload);
        break;

      default:
        throw new Error(`Unknown task type: ${taskType}`);
    }

    conn.send({
      type: 'task.result',
      requestId: taskId,
      payload: { taskId, status: 'success', result },
    });
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : String(err);

    conn.send({
      type: 'task.log',
      payload: { taskId, stream: 'stderr', content: errorMessage },
    });

    conn.send({
      type: 'task.result',
      requestId: taskId,
      payload: { taskId, status: 'failed', error: errorMessage },
    });
  }
}
