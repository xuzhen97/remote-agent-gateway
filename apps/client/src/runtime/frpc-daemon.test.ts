import { afterEach, describe, expect, it, vi } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

const { spawnMock, killMock } = vi.hoisted(() => ({
  spawnMock: vi.fn(),
  killMock: vi.fn(),
}));

vi.mock('node:child_process', () => ({
  spawn: spawnMock,
}));

import { rebuildFrpcDaemon, setFrpsInfo, stopFrpcDaemon } from './frpc-daemon.js';

describe('frpc daemon orphan cleanup', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    stopFrpcDaemon();
  });

  it('kills an orphan frpc pid from the pid file before spawning a new daemon', () => {
    const workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'rag-frpc-daemon-'));
    const mappingsDir = path.join(workDir, 'mappings');
    fs.mkdirSync(mappingsDir, { recursive: true });
    fs.writeFileSync(path.join(mappingsDir, 'pm_test.toml'), [
      'name = "file-service-client-1"',
      'type = "tcp"',
      'localIP = "127.0.0.1"',
      'localPort = 3000',
      'remotePort = 23000',
    ].join('\n'));
    fs.writeFileSync(path.join(workDir, 'frpc-daemon.pid'), '4321');

    const fakeProc = {
      stderr: { on: vi.fn() },
      on: vi.fn(),
      kill: vi.fn(),
      exitCode: null,
      pid: 9876,
    };
    spawnMock.mockReturnValue(fakeProc);

    const killSpy = vi.spyOn(process, 'kill').mockImplementation(((pid: number) => {
      killMock(pid);
      return true;
    }) as typeof process.kill);

    setFrpsInfo({ serverAddr: 'frps.example.com', serverPort: 7000, authToken: 'frp-token' });

    const result = rebuildFrpcDaemon({
      clientId: 'client-1',
      clientName: 'Client 1',
      serverUrl: 'ws://localhost:3000/ws/client',
      apiBaseUrl: 'http://localhost:3000',
      token: 'agent-token',
      workspaceDir: './workspace',
      allowedRoots: ['./workspace'],
      tags: [],
      frpcPath: '/tmp/frpc',
      frpcWorkDir: workDir,
      source: { format: 'yaml', path: '/tmp/client.config.yaml' },
    });

    expect(killSpy).toHaveBeenCalledWith(4321, 'SIGTERM');
    expect(spawnMock).toHaveBeenCalled();
    expect(fs.readFileSync(path.join(workDir, 'frpc-daemon.pid'), 'utf-8').trim()).toBe('9876');
    expect(result).toEqual({ proxyCount: 1 });
  });
});
