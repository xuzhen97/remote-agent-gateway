import * as path from 'node:path';
import * as fs from 'node:fs';
import { spawn } from 'node:child_process';
import type { ConnectionManager } from '../core/connection.js';
import type { ClientConfig } from '../config/client.config.js';
import type { ExecScriptPayload } from '@rag/shared';
import { resolveWorkspace } from '../runtime/workspace.js';

export async function executeScript(
  conn: ConnectionManager,
  config: ClientConfig,
  taskId: string,
  payload: ExecScriptPayload,
): Promise<unknown> {
  const runtime = payload.runtime ?? 'node';
  const timeoutMs = payload.timeoutMs ?? 60_000;

  // Create task workspace
  const taskDir = resolveWorkspace(config.workspaceDir, 'tasks', taskId);
  fs.mkdirSync(taskDir, { recursive: true });

  // Write script file
  const ext = runtime === 'node' ? '.js' : runtime === 'python' ? '.py' : '.sh';
  const scriptPath = path.join(taskDir, `script${ext}`);
  fs.writeFileSync(scriptPath, payload.script);

  // Build command
  let command: string;
  let args: string[];

  switch (runtime) {
    case 'node':
      command = 'node';
      args = [scriptPath];
      break;
    case 'python':
      command = 'python3';
      args = [scriptPath];
      break;
    case 'bash':
      command = 'bash';
      args = [scriptPath];
      break;
    default:
      throw new Error(`Unsupported runtime: ${runtime}`);
  }

  return executeWithTimeout(command, args, taskDir, timeoutMs, conn, taskId);
}

function executeWithTimeout(
  command: string,
  args: string[],
  cwd: string,
  timeoutMs: number,
  conn: ConnectionManager,
  taskId: string,
): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd, timeout: timeoutMs });

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
