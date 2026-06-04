import { mkdtempSync, writeFileSync, existsSync, readFileSync, mkdirSync } from 'node:fs';
import { rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { installPiSkill } from './install-pi-skill.js';

const tempDirs: string[] = [];

function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'rag-skill-install-'));
  tempDirs.push(dir);
  return dir;
}

afterEach(async () => {
  for (const dir of tempDirs.splice(0)) await rm(dir, { recursive: true, force: true });
});

describe('installPiSkill', () => {
  it('builds first, then copies the whole skill and replaces stale files', async () => {
    const root = tempDir();
    const source = join(root, 'skills', 'rag-agent');
    const dist = join(source, 'dist');
    const target = join(root, 'home', '.pi', 'agent', 'skills', 'rag-agent');
    mkdirSync(dist, { recursive: true });
    mkdirSync(target, { recursive: true });
    writeFileSync(join(source, 'SKILL.md'), 'skill content');
    writeFileSync(join(source, 'references.md'), 'ref content');
    writeFileSync(join(target, 'stale.txt'), 'stale');

    const buildSkillCli = vi.fn(async () => {
      writeFileSync(join(dist, 'rag.cjs'), '#!/usr/bin/env node\nconsole.log("ok")\n');
    });

    const result = await installPiSkill({ source, target, buildSkillCli });

    expect(buildSkillCli).toHaveBeenCalledTimes(1);
    expect(result.source).toBe(source);
    expect(result.target).toBe(target);
    expect(readFileSync(join(target, 'SKILL.md'), 'utf8')).toBe('skill content');
    expect(readFileSync(join(target, 'dist', 'rag.cjs'), 'utf8')).toContain('console.log("ok")');
    expect(existsSync(join(target, 'stale.txt'))).toBe(false);
  });
});
