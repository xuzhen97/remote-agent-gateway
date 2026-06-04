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

function makeFakeProcess(pid: number) {
  return {
    stderr: { on: vi.fn() },
    on: vi.fn(),
    kill: vi.fn(),
    exitCode: null,
    pid,
  };
}

function makeClientConfig(workDir: string) {
  return {
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
    source: { format: 'yaml' as const, path: '/tmp/client.config.yaml' },
    httpHost: '127.0.0.1',
    httpPort: 17890,
    jobMaxConcurrent: 4,
    jobDefaultTimeoutMs: 300000,
    jobMaxTimeoutMs: 1800000,
    jobLogBufferLines: 5000,
    taskAuditStorePath: `${workDir}/.rag/task-audit.jsonl`,
  };
}

function makeWorkDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'rag-frpc-daemon-'));
}

function writeStore(workDir: string, mappings: Array<{ id: string; name: string; type: string; localHost: string; localPort: number; remotePort?: number; customDomain?: string }>): void {
  fs.writeFileSync(path.join(workDir, 'frp-mappings.json'), JSON.stringify(mappings, null, 2));
}

function writeMapping(workDir: string, file: string, lines: string[]): void {
  const mappingsDir = path.join(workDir, 'mappings');
  fs.mkdirSync(mappingsDir, { recursive: true });
  fs.writeFileSync(path.join(mappingsDir, file), lines.join('\n'));
}

function writeTcpMapping(workDir: string, file = 'pm_test.toml'): void {
  writeMapping(workDir, file, [
    'name = "file-service-client-1"',
    'type = "tcp"',
    'localIP = "127.0.0.1"',
    'localPort = 3000',
    'remotePort = 23000',
  ]);
  writeStore(workDir, [{
    id: file.replace(/\.toml$/, ''),
    name: 'file-service-client-1',
    type: 'tcp',
    localHost: '127.0.0.1',
    localPort: 3000,
    remotePort: 23000,
  }]);
}

describe('frpc daemon orphan cleanup', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    stopFrpcDaemon();
  });

  it('drops stale cached http proxy configs without customDomains before spawning frpc', () => {
    const workDir = makeWorkDir();
    writeMapping(workDir, 'pm_stale_http.toml', [
      'name = "auto-file-http-client-1"',
      'type = "http"',
      'localIP = "127.0.0.1"',
      'localPort = 3000',
      'remotePort = 23000',
    ]);
    writeMapping(workDir, 'pm_http_domain.toml', [
      'name = "web-preview-client-1"',
      'type = "http"',
      'localIP = "127.0.0.1"',
      'localPort = 3002',
      'remotePort = 23002',
      'customDomains = ["preview.example.com"]',
    ]);
    writeTcpMapping(workDir, 'pm_tcp.toml');
    writeStore(workDir, [
      {
        id: 'pm_stale_http',
        name: 'auto-file-http-client-1',
        type: 'http',
        localHost: '127.0.0.1',
        localPort: 3000,
        remotePort: 23000,
      },
      {
        id: 'pm_http_domain',
        name: 'web-preview-client-1',
        type: 'http',
        localHost: '127.0.0.1',
        localPort: 3002,
        remotePort: 23002,
        customDomain: 'preview.example.com',
      },
      {
        id: 'pm_tcp',
        name: 'file-service-client-1',
        type: 'tcp',
        localHost: '127.0.0.1',
        localPort: 3000,
        remotePort: 23000,
      },
    ]);

    spawnMock.mockReturnValue(makeFakeProcess(9876));
    setFrpsInfo({ serverAddr: 'frps.example.com', serverPort: 7000, authToken: 'frp-token' });

    const result = rebuildFrpcDaemon(makeClientConfig(workDir));

    const combined = fs.readFileSync(path.join(workDir, 'frpc-combined.toml'), 'utf-8');
    expect(combined).not.toContain('auto-file-http-client-1');
    expect(combined).toContain('web-preview-client-1');
    expect(combined).not.toContain('remotePort = 23002');
    expect(combined).toContain('file-service-client-1');
    expect(result).toEqual({ proxyCount: 2 });
  });

  it('restarts the tracked daemon without treating it as an orphan process', () => {
    const workDir = makeWorkDir();
    writeTcpMapping(workDir);

    const firstProc = makeFakeProcess(4321);
    const secondProc = makeFakeProcess(9876);
    spawnMock.mockReturnValueOnce(firstProc).mockReturnValueOnce(secondProc);

    const killSpy = vi.spyOn(process, 'kill').mockImplementation(((pid: number) => {
      killMock(pid);
      return true;
    }) as typeof process.kill);

    setFrpsInfo({ serverAddr: 'frps.example.com', serverPort: 7000, authToken: 'frp-token' });
    const config = makeClientConfig(workDir);

    rebuildFrpcDaemon(config);
    const result = rebuildFrpcDaemon(config);

    expect(firstProc.kill).toHaveBeenCalledWith('SIGTERM');
    expect(killSpy).not.toHaveBeenCalledWith(4321, 'SIGTERM');
    expect(fs.readFileSync(path.join(workDir, 'frpc-daemon.pid'), 'utf-8').trim()).toBe('9876');
    expect(result).toEqual({ proxyCount: 1 });
  });

  it('kills orphan frpc processes that use the same combined config before spawning a new daemon', () => {
    const workDir = makeWorkDir();
    writeTcpMapping(workDir);
    const configPath = path.join(workDir, 'frpc-combined.toml');

    spawnMock.mockReturnValue(makeFakeProcess(9876));
    execFileSyncMock.mockImplementation((command: string) => {
      if (command !== 'wmic') throw new Error('unexpected command');
      return Buffer.from([
        'Node,CommandLine,ProcessId',
        `HOST,"D:\\rag-v0.1.0-win\\bin\\frpc.exe" -c "${configPath}",14500`,
        `HOST,D:/rag-v0.1.0-win/bin/frpc.exe -c ${configPath},8456`,
        'HOST,D:/rag-v0.1.0-win/bin/frpc.exe -c D:/other/frpc-combined.toml,1111',
      ].join('\r\n'));
    });

    const killSpy = vi.spyOn(process, 'kill').mockImplementation(((pid: number) => {
      killMock(pid);
      return true;
    }) as typeof process.kill);

    setFrpsInfo({ serverAddr: 'frps.example.com', serverPort: 7000, authToken: 'frp-token' });

    const result = rebuildFrpcDaemon(makeClientConfig(workDir));

    expect(killSpy).toHaveBeenCalledWith(14500, 'SIGTERM');
    expect(killSpy).toHaveBeenCalledWith(8456, 'SIGTERM');
    expect(killSpy).not.toHaveBeenCalledWith(1111, 'SIGTERM');
    expect(spawnMock).toHaveBeenCalled();
    expect(result).toEqual({ proxyCount: 1 });
  });

  it('kills an orphan frpc pid from the pid file before spawning a new daemon', () => {
    const workDir = makeWorkDir();
    writeTcpMapping(workDir);
    fs.writeFileSync(path.join(workDir, 'frpc-daemon.pid'), '4321');

    spawnMock.mockReturnValue(makeFakeProcess(9876));

    const killSpy = vi.spyOn(process, 'kill').mockImplementation(((pid: number) => {
      killMock(pid);
      return true;
    }) as typeof process.kill);

    setFrpsInfo({ serverAddr: 'frps.example.com', serverPort: 7000, authToken: 'frp-token' });

    const result = rebuildFrpcDaemon(makeClientConfig(workDir));

    expect(killSpy).toHaveBeenCalledWith(4321, 'SIGTERM');
    expect(spawnMock).toHaveBeenCalled();
    expect(fs.readFileSync(path.join(workDir, 'frpc-daemon.pid'), 'utf-8').trim()).toBe('9876');
    expect(result).toEqual({ proxyCount: 1 });
  });

  it('force-kills the tracked frpc daemon before respawn when it does not exit after SIGTERM', () => {
    const workDir = makeWorkDir();
    writeTcpMapping(workDir);

    const firstProc = makeFakeProcess(4321);
    const secondProc = makeFakeProcess(9876);
    spawnMock.mockReturnValueOnce(firstProc).mockReturnValueOnce(secondProc);

    let trackedAlive = true;
    const killSpy = vi.spyOn(process, 'kill').mockImplementation(((pid: number, signal?: NodeJS.Signals | 0) => {
      if (pid !== 4321) return true;
      if (signal === 0) {
        if (!trackedAlive) throw new Error('ESRCH');
        return true;
      }
      if (signal === 'SIGKILL') trackedAlive = false;
      return true;
    }) as typeof process.kill);

    setFrpsInfo({ serverAddr: 'frps.example.com', serverPort: 7000, authToken: 'frp-token' });
    const config = makeClientConfig(workDir);

    rebuildFrpcDaemon(config);
    const result = rebuildFrpcDaemon(config);

    expect(firstProc.kill).toHaveBeenCalledWith('SIGTERM');
    expect(killSpy).toHaveBeenCalledWith(4321, 0);
    expect(killSpy).toHaveBeenCalledWith(4321, 'SIGKILL');
    expect(spawnMock).toHaveBeenCalledTimes(2);
    expect(result).toEqual({ proxyCount: 1 });
  });
});
