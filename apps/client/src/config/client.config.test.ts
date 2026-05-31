import { afterEach, describe, expect, it } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { loadConfig } from './client.config.js';

describe('loadConfig', () => {
  const previousCwd = process.cwd();

  afterEach(() => {
    process.chdir(previousCwd);
  });

  it('resolves frpcPath by searching upward from the config file and appends .exe on Windows when present', () => {
    const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), 'rag-client-config-'));
    const appDir = path.join(rootDir, 'apps', 'client');
    const binDir = path.join(rootDir, 'bin');
    fs.mkdirSync(appDir, { recursive: true });
    fs.mkdirSync(binDir, { recursive: true });
    fs.writeFileSync(path.join(binDir, process.platform === 'win32' ? 'frpc.exe' : 'frpc'), '');
    fs.writeFileSync(path.join(appDir, 'config.json'), JSON.stringify({
      clientId: 'client-1',
      clientName: 'Client 1',
      serverUrl: 'ws://localhost:3000/ws/client',
      apiBaseUrl: 'http://localhost:3000',
      token: 'tok',
      workspaceDir: './workspace',
      frpcPath: './bin/frpc',
    }));

    const config = loadConfig(path.join(appDir, 'config.json'));

    expect(config.frpcPath).toBe(path.join(binDir, process.platform === 'win32' ? 'frpc.exe' : 'frpc'));
  });
});
