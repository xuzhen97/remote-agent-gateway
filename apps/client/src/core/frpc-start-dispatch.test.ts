import { describe, expect, it, vi } from 'vitest';

const { startFrpcDaemonMock, stopFrpcDaemonMock, setFrpsInfoMock } = vi.hoisted(() => ({
  startFrpcDaemonMock: vi.fn(),
  stopFrpcDaemonMock: vi.fn(),
  setFrpsInfoMock: vi.fn(),
}));

vi.mock('../runtime/frpc-daemon.js', () => ({
  startFrpcDaemon: startFrpcDaemonMock,
  stopFrpcDaemon: stopFrpcDaemonMock,
  setFrpsInfo: setFrpsInfoMock,
}));

import { dispatchTask } from './task-dispatcher.js';

function createConn() {
  const sent: unknown[] = [];
  return {
    sent,
    conn: { send: vi.fn((message: unknown) => { sent.push(message); return true; }) },
  };
}

describe('task dispatcher frpc start task', () => {
  it('sets frps info before starting the daemon', async () => {
    const { conn } = createConn();
    const config = {
      clientId: 'client-1',
      clientName: 'Client 1',
      serverUrl: 'ws://localhost:3000/ws/client',
      apiBaseUrl: 'http://localhost:3000',
      token: 'agent-token',
      workspaceDir: './workspace',
      allowedRoots: ['./workspace'],
      tags: [],
      frpcPath: './bin/frpc',
      httpHost: '127.0.0.1',
      httpPort: 17890,
      jobMaxConcurrent: 4,
      jobDefaultTimeoutMs: 300000,
      jobMaxTimeoutMs: 1800000,
      jobLogBufferLines: 5000,
    };

    await dispatchTask(conn as never, config, {
      taskId: 'task_frpc_start',
      taskType: 'frpc_start',
      payload: {
        serverAddr: 'frps.example.com',
        serverPort: 7000,
        authToken: 'frps-token',
      },
    });

    expect(setFrpsInfoMock).toHaveBeenCalledWith({
      serverAddr: 'frps.example.com',
      serverPort: 7000,
      authToken: 'frps-token',
    });
    expect(startFrpcDaemonMock).toHaveBeenCalledWith(config);
  });
});
