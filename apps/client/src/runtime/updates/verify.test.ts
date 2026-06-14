import { createHash } from 'node:crypto';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { verifyArtifact } from './verify.js';

const tempRoots: string[] = [];

function makeTempRoot(): string {
  const root = mkdtempSync(join(tmpdir(), 'rag-verify-'));
  tempRoots.push(root);
  return root;
}

afterEach(() => {
  for (const root of tempRoots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe('verifyArtifact', () => {
  it('accepts matching sha256 and size', async () => {
    const root = makeTempRoot();
    const file = join(root, 'artifact.zip');
    const content = Buffer.from('artifact-content');
    writeFileSync(file, content);
    const hash = createHash('sha256').update(content).digest('hex');

    await expect(verifyArtifact(file, hash, content.length)).resolves.toBeUndefined();
  });

  it('rejects size and hash mismatches', async () => {
    const root = makeTempRoot();
    const file = join(root, 'artifact.zip');
    writeFileSync(file, 'artifact-content');

    await expect(verifyArtifact(file, 'a'.repeat(64), 999)).rejects.toThrow('size mismatch');
    await expect(verifyArtifact(file, 'a'.repeat(64), 'artifact-content'.length)).rejects.toThrow('sha256 mismatch');
  });
});
