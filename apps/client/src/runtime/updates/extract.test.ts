import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { extractArtifact } from './extract.js';

const tempRoots: string[] = [];

function makeTempRoot(): string {
  const root = mkdtempSync(join(tmpdir(), 'rag-extract-'));
  tempRoots.push(root);
  return root;
}

afterEach(() => {
  for (const root of tempRoots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe('extractArtifact', () => {
  it('extracts an archive into the client version directory after validating entrypoint', async () => {
    const root = makeTempRoot();
    const fakeArchive = join(root, 'artifact.zip');
    writeFileSync(fakeArchive, 'fake');

    const result = await extractArtifact({
      archivePath: fakeArchive,
      versionsDir: join(root, 'versions', 'client'),
      version: '1.0.1',
      entrypoint: 'client.bundle.cjs',
      extractArchive: async (archivePath, stagingDir) => {
        expect(archivePath).toBe(fakeArchive);
        writeFileSync(join(stagingDir, 'client.bundle.cjs'), 'console.log("client")');
      },
    });

    expect(result).toBe(join(root, 'versions', 'client', '1.0.1'));
  });

  it('rejects archives missing the expected entrypoint', async () => {
    const root = makeTempRoot();
    const fakeArchive = join(root, 'artifact.zip');
    writeFileSync(fakeArchive, 'fake');

    await expect(extractArtifact({
      archivePath: fakeArchive,
      versionsDir: join(root, 'versions', 'client'),
      version: '1.0.1',
      entrypoint: 'client.bundle.cjs',
      extractArchive: async (_archivePath, stagingDir) => {
        mkdirSync(stagingDir, { recursive: true });
        writeFileSync(join(stagingDir, 'README.txt'), 'missing bundle');
      },
    })).rejects.toThrow('entrypoint not found');
  });
});
