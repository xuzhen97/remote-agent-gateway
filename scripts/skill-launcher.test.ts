import { copyFileSync, mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { afterEach, describe, expect, it } from 'vitest';

const tempDirs: string[] = [];
const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const sourceLauncher = join(repoRoot, 'skills', 'rag-agent', 'run.cjs');

function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'rag-skill-launcher-'));
  tempDirs.push(dir);
  return dir;
}

afterEach(async () => {
  for (const dir of tempDirs.splice(0)) await rm(dir, { recursive: true, force: true });
});

describe('rag-agent launcher', () => {
  it('resolves dist/rag.cjs relative to itself instead of the caller cwd', () => {
    const root = tempDir();
    const skillDir = join(root, 'skills', 'rag-agent');
    const distDir = join(skillDir, 'dist');
    const callerCwd = join(root, 'workspace');
    mkdirSync(distDir, { recursive: true });
    mkdirSync(callerCwd, { recursive: true });

    copyFileSync(sourceLauncher, join(skillDir, 'run.cjs'));
    writeFileSync(
      join(distDir, 'rag.cjs'),
      "#!/usr/bin/env node\nexports.run = async (argv) => { console.log(JSON.stringify({ argv, cwd: process.cwd(), entry: __filename })); };\nif (typeof require !== 'undefined' && require.main === module) { exports.run(process.argv.slice(2)); }\n",
    );

    const result = spawnSync(process.execPath, [join(skillDir, 'run.cjs'), 'clients', 'list'], {
      cwd: callerCwd,
      encoding: 'utf8',
    });

    expect(result.status).toBe(0);
    expect(result.stderr).toBe('');
    expect(JSON.parse(result.stdout)).toEqual({
      argv: ['clients', 'list'],
      cwd: callerCwd,
      entry: join(distDir, 'rag.cjs'),
    });
  });

  it('invokes the bundled cli run export with forwarded argv', () => {
    const root = tempDir();
    const skillDir = join(root, 'skills', 'rag-agent');
    const distDir = join(skillDir, 'dist');
    mkdirSync(distDir, { recursive: true });

    copyFileSync(sourceLauncher, join(skillDir, 'run.cjs'));
    writeFileSync(
      join(distDir, 'rag.cjs'),
      "#!/usr/bin/env node\nexports.run = async (argv) => { console.log(JSON.stringify({ argv, entry: __filename })); };\nif (typeof require !== 'undefined' && require.main === module) { exports.run(process.argv.slice(2)); }\n",
    );

    const result = spawnSync(process.execPath, [join(skillDir, 'run.cjs'), '--help'], {
      encoding: 'utf8',
    });

    expect(result.status).toBe(0);
    expect(result.stderr).toBe('');
    expect(JSON.parse(result.stdout)).toEqual({
      argv: ['--help'],
      entry: join(distDir, 'rag.cjs'),
    });
  });
});
