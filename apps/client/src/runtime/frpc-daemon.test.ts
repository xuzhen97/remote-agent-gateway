import { afterEach, describe, expect, it, vi } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

const { spawnMock, execFileSyncMock, killMock } = vi.hoisted(() => ({
  spawnMock: vi.fn(),
  execFileSyncMock: vi.fn(),
  killMock: vi.fn(),
}));

vi.mock('node:child_process', () => ({
  spawn: spawnMock,
  execFileSync: execFileSyncMock,
}));

import { rebuildFrpcDaemon, setFrpsInfo, stopFrpcDaemon } from './frpc-daemon.js';

describe('frpc daemon orphan cleanup', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    stopFrpcDaemon();
  });

  it('drops stale cached http proxy configs without customDomains before spawning frpc', () => {
    const workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'rag-frpc-daemon-'));
    const mappingsDir = path.join(workDir, 'mappings');
    fs.mkdirSync(mappingsDir, { recursive: true });
    fs.writeFileSync(path.join(mappingsDir, 'pm_stale_http.toml'), [
      'name = "auto-file-http-client-1"',
      'type = "http"',
      'localIP = "127.0.0.1"',
      'localPort = 3000',
      'remotePort = 23000',
    ].join('\n'));
    fs.writeFileSync(path.join(mappingsDir, 'pm_http_domain.toml'), [
      'name = "web-preview-client-1"',
      'type = "http"',
      'localIP = "127.0.0.1"',
      'localPort = 3002',
      'remotePort = 23002',
      'customDomains = ["preview.example.com"]',
    ].join('\n'));
    fs.writeFileSync(path.join(mappingsDir, 'pm_tcp.toml'), [
      'name = "file-service-client-1"',
      'type = "tcp"',
      'localIP = "127.0.0.1"',
      'localPort = 3001',
      'remotePort = 23001',
    ].join('\n'));

    const fakeProc = {
      stderr: { on: vi.fn() },
      on: vi.fn(),
      kill: vi.fn(),
      exitCode: null,
      pid: 9876,
    };
    spawnMock.mockReturnValue(fakeProc);

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

    const combined = fs.readFileSync(path.join(workDir, 'frpc-combined.toml'), 'utf-8');
    expect(combined).not.toContain('auto-file-http-client-1');
    expect(combined).toContain('web-preview-client-1');
    expect(combined).not.toContain('remotePort = 23002');
    expect(combined).toContain('file-service-client-1');
    expect(result).toEqual({ proxyCount: 2 });
  });

  it('kills orphan frpc processes that use the same combined config before spawning a new daemon', () => {
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
    const configPath = path.join(workDir, 'frpc-combined.toml');

    const fakeProc = {
      stderr: { on: vi.fn() },
      on: vi.fn(),
      kill: vi.fn(),
      exitCode: null,
      pid: 9876,
    };
    spawnMock.mockReturnValue(fakeProc);
    execFileSyncMock.mockImplementation((command: string) => {
      if (command === 'wmic') {
        return Buffer.from([
          'Node,CommandLine,ProcessId',
          `HOST,"D:\\rag-v0.1.0-win\\bin\\frpc.exe" -c "${configPath}",14500`,
          `HOST,D:/rag-v0.1.0-win/bin/frpc.exe -c ${configPath},8456`,
          'HOST,D:/rag-v0.1.0-win/bin/frpc.exe -c D:/other/frpc-combined.toml,1111',
        ].join('\r\n'));
      }
      throw new Error('unexpected command');
    });

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

    expect(killSpy).toHaveBeenCalledWith(14500, 'SIGTERM');
    expect(killSpy).toHaveBeenCalledWith(8456, 'SIGTERM');
    expect(killSpy).not.toHaveBeenCalledWith(1111, 'SIGTERM');
    expect(spawnMock).toHaveBeenCalled();
    expect(result).toEqual({ proxyCount: 1 });
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
