import { afterEach, describe, expect, it } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { loadServerConfig } from './server.config.js';

describe('loadServerConfig', () => {
  const originalArgv = [...process.argv];
  const originalEnv = { ...process.env };

  afterEach(() => {
    process.argv = [...originalArgv];
    process.env = { ...originalEnv };
  });

  it('loads server.config.yaml from an explicit path and applies env overrides', () => {
    const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), 'rag-server-config-'));
    const configPath = path.join(rootDir, 'server.config.yaml');
    fs.writeFileSync(configPath, `
server:
  host: 0.0.0.0
  port: 3000
auth:
  adminToken: yaml-admin
  agentApiToken: yaml-agent
storage:
  dbPath: ./storage/db.sqlite
  filesDir: ./storage/files
frp:
  mode: builtin
  connectHost: frps-connect.example.com
  publicHost: frps-public.example.com
  port: 7000
  token: yaml-frp
  dashboard:
    scheme: http
    host: frps-dashboard.example.com
    port: 7500
    user: admin
    password: secret
  binPath: ./bin/frps
  portRange:
    start: 20000
    end: 25000
`);

    process.env.RAG_SERVER_PORT = '3300';

    const config = loadServerConfig(configPath);

    expect(config.source.format).toBe('yaml');
    expect(config.server.port).toBe(3300);
    expect(config.auth.adminToken).toBe('yaml-admin');
  });

  it('throws when server.config.yaml does not exist', () => {
    const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), 'rag-server-missing-'));

    expect(() => loadServerConfig(undefined, { cwd: rootDir })).toThrow(
      'Server config not found. Create server.config.yaml.'
    );
  });

  it('rejects missing frp connectHost', () => {
    const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), 'rag-server-invalid-'));
    const configPath = path.join(rootDir, 'server.config.yaml');
    fs.writeFileSync(configPath, `
server:
  host: 0.0.0.0
  port: 3000
auth:
  adminToken: yaml-admin
  agentApiToken: yaml-agent
storage:
  dbPath: ./storage/db.sqlite
  filesDir: ./storage/files
frp:
  mode: remote
  connectHost: ""
  publicHost: ""
  port: 7000
  token: yaml-frp
  dashboard:
    scheme: http
    host: frps-dashboard.example.com
    port: 7500
    user: admin
    password: secret
  binPath: ./bin/frps
  portRange:
    start: 20000
    end: 25000
`);

    expect(() => loadServerConfig(configPath)).toThrow('frp.connectHost is required');
  });
});
