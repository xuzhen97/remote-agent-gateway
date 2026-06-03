import { mkdtempSync, writeFileSync, existsSync, readFileSync, mkdirSync } from 'node:fs';
import { rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
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
  it('copies project skill to target and replaces stale files', async () => {
    const root = tempDir();
    const source = join(root, 'skills', 'rag-agent');
    const target = join(root, 'home', '.pi', 'agent', 'skills', 'rag-agent');
    mkdirSync(source, { recursive: true });
    mkdirSync(target, { recursive: true });
    writeFileSync(join(source, 'SKILL.md'), 'new skill');
    writeFileSync(join(target, 'stale.txt'), 'stale');

    const result = await installPiSkill({ source, target });

    expect(result.source).toBe(source);
    expect(result.target).toBe(target);
    expect(readFileSync(join(target, 'SKILL.md'), 'utf8')).toBe('new skill');
    expect(existsSync(join(target, 'stale.txt'))).toBe(false);
  });
});
