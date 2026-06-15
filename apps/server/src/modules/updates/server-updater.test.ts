import { createHash } from 'node:crypto';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createServerUpdater } from './server-updater.js';
import { readPendingServerUpdateContext, readPendingServerVersion } from './server-version-state.js';

const tempRoots: string[] = [];

function makeRoot(): string {
  const root = mkdtempSync(join(tmpdir(), 'rag-server-updater-'));
  tempRoots.push(root);
  return root;
}

afterEach(() => {
  for (const root of tempRoots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe('server updater', () => {
  it('downloads, verifies, extracts, writes pending state, and requests restart', async () => {
    const root = makeRoot();
    const archive = Buffer.from('server artifact');
    const sha = createHash('sha256').update(archive).digest('hex');
    const restart = vi.fn();

    const updater = createServerUpdater({
      deployRoot: root,
      currentVersion: '1.0.0',
      restart,
      fetchImpl: vi.fn().mockResolvedValue(new Response(archive)) as any,
      extractArtifact: (_archivePath, versionsDir, version) => {
        const versionDir = join(versionsDir, version);
        mkdirSync(versionDir, { recursive: true });
        writeFileSync(join(versionDir, 'server.bundle.cjs'), 'console.log("server")');
        return versionDir;
      },
    });

    await updater.run({
      campaignId: 'camp_1',
      targetId: 'camp_1_server',
      attemptId: 'camp_1_server_1',
      version: '1.0.1',
      downloadUrl: 'http://server/updates/artifacts/1.0.1/rag-server-v1.0.1-windows-x64.zip',
      expectedSha256: sha,
      expectedSize: archive.length,
    });

    expect(readPendingServerVersion(root)?.version).toBe('1.0.1');
    expect(readPendingServerUpdateContext(root)).toEqual(expect.objectContaining({
      campaignId: 'camp_1',
      fromVersion: '1.0.0',
      targetVersion: '1.0.1',
    }));
    expect(restart).toHaveBeenCalledOnce();
    expect(readFileSync(join(root, 'downloads', 'rag-server-v1.0.1-windows-x64.zip'))).toEqual(archive);
  });
});
