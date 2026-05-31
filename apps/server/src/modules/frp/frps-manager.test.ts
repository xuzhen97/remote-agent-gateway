import { describe, expect, it } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { resolveFrpsBinaryPath } from './frps-manager.js';

describe('resolveFrpsBinaryPath', () => {
  it('searches upward from the working directory and appends .exe on Windows when needed', () => {
    const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), 'rag-frps-path-'));
    const serverDir = path.join(rootDir, 'apps', 'server');
    const binDir = path.join(rootDir, 'bin');
    fs.mkdirSync(serverDir, { recursive: true });
    fs.mkdirSync(binDir, { recursive: true });

    const binaryName = process.platform === 'win32' ? 'frps.exe' : 'frps';
    const binaryPath = path.join(binDir, binaryName);
    fs.writeFileSync(binaryPath, '');

    expect(resolveFrpsBinaryPath('./bin/frps', serverDir)).toBe(binaryPath);
  });
});
