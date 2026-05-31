import { describe, expect, it, vi } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { dispatchTask } from './task-dispatcher.js';
import { stopFileHttpServer } from '../runtime/file-http-server.js';

function createConn() {
  const sent: unknown[] = [];
  return {
    sent,
    conn: { send: vi.fn((message: unknown) => { sent.push(message); return true; }) },
  };
}

describe('task dispatcher file service tasks', () => {
  it('starts, reports, and stops the file service', async () => {
    const workspaceDir = fs.mkdtempSync(path.join(os.tmpdir(), 'rag-dispatch-file-service-'));
    const { conn, sent } = createConn();
    const config = {
      clientId: 'client-1',
      clientName: 'Client 1',
      serverUrl: 'ws://localhost:3000/ws/client',
      apiBaseUrl: 'http://localhost:3000',
      token: 'agent-token',
      workspaceDir,
      tags: [],
    };

    await dispatchTask(conn as never, config, {
      taskId: 'task_file_start',
      taskType: 'file_service_start',
      payload: { port: 0, token: 'tok_1234567890123456' },
    });

    expect(sent).toContainEqual(expect.objectContaining({
      type: 'task.result',
      payload: expect.objectContaining({
        taskId: 'task_file_start',
        status: 'success',
        result: expect.objectContaining({ running: true, port: expect.any(Number) }),
      }),
    }));

    await dispatchTask(conn as never, config, {
      taskId: 'task_file_stop',
      taskType: 'file_service_stop',
      payload: {},
    });

    expect(sent).toContainEqual(expect.objectContaining({
      type: 'task.result',
      payload: expect.objectContaining({
        taskId: 'task_file_stop',
        status: 'success',
        result: { stopped: true },
      }),
    }));

    await stopFileHttpServer();
    fs.rmSync(workspaceDir, { recursive: true, force: true });
  });
});
