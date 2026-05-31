import type { ConnectionManager } from './connection.js';
import type { ClientConfig } from '../config/client.config.js';
import type {
  ExecScriptPayload,
  ExecCommandPayload,
  PushFilePayload,
  FrpCreateProxyPayload,
  FrpRemoveProxyPayload,
  FileServiceStartPayload,
} from '@rag/shared';
import { executeScript } from '../executors/exec-script.executor.js';
import { executeCommand } from '../executors/exec-command.executor.js';
import { executePushFile } from '../executors/push-file.executor.js';
import { executeFrpCreate } from '../executors/frp-create.executor.js';
import { executeFrpRemove } from '../executors/frp-remove.executor.js';
import { executeFileServiceStart } from '../executors/file-service-start.executor.js';
import { executeFileServiceStop } from '../executors/file-service-stop.executor.js';
import { executeFileServiceStatus } from '../executors/file-service-status.executor.js';
import { startFrpcDaemon, stopFrpcDaemon } from '../runtime/frpc-daemon.js';

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

      case 'frpc_start':
        startFrpcDaemon(config);
        result = { started: true };
        break;

      case 'frpc_stop':
        stopFrpcDaemon();
        result = { stopped: true };
        break;

      case 'file_service_start':
        result = await executeFileServiceStart(config, payload as FileServiceStartPayload);
        break;

      case 'file_service_stop':
        result = await executeFileServiceStop();
        break;

      case 'file_service_status':
        result = await executeFileServiceStatus();
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
