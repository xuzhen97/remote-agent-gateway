import { afterEach, describe, expect, it } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { loadConfig } from './client.config.js';

describe('loadConfig', () => {
  const originalArgv = [...process.argv];
  const originalEnv = { ...process.env };

  afterEach(() => {
    process.argv = [...originalArgv];
    process.env = { ...originalEnv };
  });

  it('loads client.config.yaml and applies token override', () => {
    const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), 'rag-client-config-'));
    const configPath = path.join(rootDir, 'client.config.yaml');
    fs.writeFileSync(configPath, `
client:
  id: client-1
  name: Client 1
  tags:
    - dev
server:
  wsUrl: ws://localhost:3000/ws/client
  apiBaseUrl: http://localhost:3000
  token: yaml-token
workspace:
  dir: ./workspace
  allowedRoots:
    - ./workspace
frp:
  binPath: ./bin/frpc
  workDir: ./frp
`);

    const binDir = path.join(rootDir, 'bin');
    fs.mkdirSync(binDir, { recursive: true });
    fs.writeFileSync(path.join(binDir, process.platform === 'win32' ? 'frpc.exe' : 'frpc'), '');
    process.env.RAG_CLIENT_TOKEN = 'override-token';

    const config = loadConfig(configPath);

    expect(config.clientId).toBe('client-1');
    expect(config.token).toBe('override-token');
    expect(config.allowedRoots).toEqual(['./workspace']);
  });

  it('throws when client.config.yaml is absent', () => {
    const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), 'rag-client-missing-'));

    expect(() => loadConfig(undefined, { cwd: rootDir })).toThrow(
      'Client config not found. Create client.config.yaml.'
    );
  });

  it('finds root-level client.config.yaml and resolves frpcPath upward from it', () => {
    const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), 'rag-client-frpc-'));
    const nestedDir = path.join(rootDir, 'apps', 'client');
    const binDir = path.join(rootDir, 'bin');
    fs.mkdirSync(nestedDir, { recursive: true });
    fs.mkdirSync(binDir, { recursive: true });
    const binaryName = process.platform === 'win32' ? 'frpc.exe' : 'frpc';
    fs.writeFileSync(path.join(binDir, binaryName), '');
    fs.writeFileSync(path.join(rootDir, 'client.config.yaml'), `
client:
  id: client-1
  name: Client 1
server:
  wsUrl: ws://localhost:3000/ws/client
  apiBaseUrl: http://localhost:3000
  token: tok
workspace:
  dir: ./workspace
  allowedRoots:
    - ./workspace
frp:
  binPath: ./bin/frpc
  workDir: ./frp
`);

    const config = loadConfig(undefined, { cwd: nestedDir });

    expect(config.frpcPath).toBe(path.join(binDir, binaryName));
    expect(config.source?.path).toBe(path.join(rootDir, 'client.config.yaml'));
  });
});
