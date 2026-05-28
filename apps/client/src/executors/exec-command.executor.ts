import { spawn } from 'node:child_process';
import type { ConnectionManager } from '../core/connection.js';
import type { ExecCommandPayload } from '@rag/shared';

export async function executeCommand(
  conn: ConnectionManager,
  _config: unknown,
  taskId: string,
  payload: ExecCommandPayload,
): Promise<unknown> {
  const { command, args = [], cwd, timeoutMs = 60_000 } = payload;

  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: cwd ?? process.cwd(),
      timeout: timeoutMs,
      shell: true,
    });

    child.stdout?.on('data', (data: Buffer) => {
      conn.send({
        type: 'task.log',
        payload: { taskId, stream: 'stdout', content: data.toString() },
      });
    });

    child.stderr?.on('data', (data: Buffer) => {
      conn.send({
        type: 'task.log',
        payload: { taskId, stream: 'stderr', content: data.toString() },
      });
    });

    child.on('close', (exitCode) => {
      resolve({ exitCode, durationMs: 0 });
    });

    child.on('error', (err) => {
      reject(err);
    });
  });
}
