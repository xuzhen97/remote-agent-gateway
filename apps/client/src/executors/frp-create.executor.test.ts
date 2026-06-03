import { afterEach, describe, expect, it, vi } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

const { rebuildFrpcDaemonMock, setFrpsInfoMock } = vi.hoisted(() => ({
  rebuildFrpcDaemonMock: vi.fn(() => ({ proxyCount: 1 })),
  setFrpsInfoMock: vi.fn(),
}));

vi.mock('../runtime/frpc-daemon.js', () => ({
  rebuildFrpcDaemon: rebuildFrpcDaemonMock,
  setFrpsInfo: setFrpsInfoMock,
}));

import { executeFrpCreate } from './frp-create.executor.js';

function makeConfig(workDir: string) {
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
  };
}

describe('executeFrpCreate', () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it('omits remotePort from saved http proxy config because frp http proxies do not support it', async () => {
    const workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'rag-frp-create-'));
    const conn = { send: vi.fn() };

    await executeFrpCreate(conn as never, makeConfig(workDir), 'task-1', {
      mappingId: 'pm-http',
      name: 'web-preview',
      proxyType: 'http',
      localIp: '127.0.0.1',
      localPort: 3000,
      remotePort: 23001,
      customDomain: 'preview.example.com',
      serverAddr: 'frps.example.com',
      serverPort: 7000,
      authToken: 'frp-token',
    });

    const saved = fs.readFileSync(path.join(workDir, 'mappings', 'pm-http.toml'), 'utf-8');
    expect(saved).toContain('type = "http"');
    expect(saved).toContain('customDomains = ["preview.example.com"]');
    expect(saved).not.toContain('remotePort');
  });

  it('keeps remotePort in saved tcp proxy config', async () => {
    const workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'rag-frp-create-'));
    const conn = { send: vi.fn() };

    await executeFrpCreate(conn as never, makeConfig(workDir), 'task-1', {
      mappingId: 'pm-tcp',
      name: 'file-service',
      proxyType: 'tcp',
      localIp: '127.0.0.1',
      localPort: 45123,
      remotePort: 23001,
      serverAddr: 'frps.example.com',
      serverPort: 7000,
      authToken: 'frp-token',
    });

    const saved = fs.readFileSync(path.join(workDir, 'mappings', 'pm-tcp.toml'), 'utf-8');
    expect(saved).toContain('type = "tcp"');
    expect(saved).toContain('remotePort = 23001');
  });

  it('rejects http proxy config without a customDomain before writing cache or restarting frpc', async () => {
    const workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'rag-frp-create-'));
    const conn = { send: vi.fn() };

    await expect(executeFrpCreate(conn as never, makeConfig(workDir), 'task-1', {
      mappingId: 'pm-http-no-domain',
      name: 'web-preview',
      proxyType: 'http',
      localIp: '127.0.0.1',
      localPort: 3000,
      remotePort: 23001,
      serverAddr: 'frps.example.com',
      serverPort: 7000,
      authToken: 'frp-token',
    })).rejects.toThrow('http/https FRP proxies require customDomain');

    expect(fs.existsSync(path.join(workDir, 'mappings', 'pm-http-no-domain.toml'))).toBe(false);
    expect(rebuildFrpcDaemonMock).not.toHaveBeenCalled();
  });
});
