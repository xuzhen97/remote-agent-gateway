import { beforeEach, describe, expect, it, vi } from 'vitest';

const { mkdirSyncFailureDirs, mkdirSyncCalls } = vi.hoisted(() => ({
  mkdirSyncFailureDirs: new Set<string>(),
  mkdirSyncCalls: [] as string[],
}));

vi.mock('node:fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs')>();
  return {
    ...actual,
    mkdirSync: vi.fn((dir: fs.PathLike, options?: fs.MakeDirectoryOptions & { recursive?: boolean }) => {
      const dirText = String(dir);
      mkdirSyncCalls.push(dirText);
      if (mkdirSyncFailureDirs.has(dirText)) {
        throw Object.assign(new Error(`EPERM: operation not permitted, mkdir '${dirText}'`), { code: 'EPERM' });
      }
      return actual.mkdirSync(dir, options);
    }),
  };
});

import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { createUploadSessionManager } from './upload-session.js';

function makeWorkspace(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'rag-upload-session-'));
}

async function* bytes(value: string): AsyncGenerator<Buffer> {
  yield Buffer.from(value, 'utf8');
}

describe('createUploadSessionManager', () => {
  let workspaceDir: string;

  beforeEach(() => {
    workspaceDir = makeWorkspace();
    mkdirSyncFailureDirs.clear();
    mkdirSyncCalls.length = 0;
  });

  it('creates and resumes the same session for the same target fingerprint', async () => {
    const manager = createUploadSessionManager({ workspaceDir, ttlMs: 24 * 60 * 60 * 1000 });

    const first = await manager.init({
      rootId: 'root-0',
      targetPath: 'releases',
      filename: 'demo.jar',
      size: 12,
      chunkSize: 4,
      fingerprint: 'fingerprint-1',
    });

    await manager.writePart(first.uploadId, 0, bytes('ABCD'), { expectedSize: 4, expectedOffset: 0 });

    const resumed = await manager.init({
      rootId: 'root-0',
      targetPath: 'releases',
      filename: 'demo.jar',
      size: 12,
      chunkSize: 4,
      fingerprint: 'fingerprint-1',
    });

    expect(resumed.uploadId).toBe(first.uploadId);
    expect(resumed.uploadedParts).toEqual([0]);
    expect(resumed.uploadedBytes).toBe(4);
  });

  it('assembles uploaded parts into the final file and removes the session directory', async () => {
    const targetRoot = path.join(workspaceDir, 'allowed-root');
    fs.mkdirSync(targetRoot, { recursive: true });
    const manager = createUploadSessionManager({ workspaceDir, ttlMs: 24 * 60 * 60 * 1000 });

    const session = await manager.init({
      rootId: 'root-0',
      targetPath: 'drop',
      filename: 'demo.jar',
      size: 12,
      chunkSize: 4,
      fingerprint: 'assemble-1',
      resolvedTargetDir: path.join(targetRoot, 'drop'),
    });

    await manager.writePart(session.uploadId, 0, bytes('ABCD'), { expectedSize: 4, expectedOffset: 0 });
    await manager.writePart(session.uploadId, 1, bytes('EFGH'), { expectedSize: 4, expectedOffset: 4 });
    await manager.writePart(session.uploadId, 2, bytes('IJKL'), { expectedSize: 4, expectedOffset: 8 });

    const completed = await manager.complete(session.uploadId);

    expect(completed.path).toBe('drop/demo.jar');
    expect(fs.readFileSync(path.join(targetRoot, 'drop', 'demo.jar'), 'utf8')).toBe('ABCDEFGHIJKL');
    expect(fs.existsSync(path.join(workspaceDir, '.rag-upload-sessions', session.uploadId))).toBe(false);
  });

  it('does not mkdir an existing resolved target directory during completion', async () => {
    const targetRoot = path.join(workspaceDir, 'existing-root');
    fs.mkdirSync(targetRoot, { recursive: true });
    mkdirSyncCalls.length = 0;
    const manager = createUploadSessionManager({ workspaceDir, ttlMs: 24 * 60 * 60 * 1000 });

    const session = await manager.init({
      rootId: 'root-0',
      targetPath: '.',
      filename: 'demo.txt',
      size: 5,
      chunkSize: 5,
      fingerprint: 'existing-target-dir',
      resolvedTargetDir: targetRoot,
    });
    await manager.writePart(session.uploadId, 0, bytes('hello'), { expectedSize: 5, expectedOffset: 0 });

    mkdirSyncCalls.length = 0;
    mkdirSyncFailureDirs.add(targetRoot);

    const completed = await manager.complete(session.uploadId);

    expect(completed.path).toBe('demo.txt');
    expect(fs.readFileSync(path.join(targetRoot, 'demo.txt'), 'utf8')).toBe('hello');
    expect(mkdirSyncCalls).not.toContain(targetRoot);
  });

  it('rejects completion when any part is missing', async () => {
    const manager = createUploadSessionManager({ workspaceDir, ttlMs: 24 * 60 * 60 * 1000 });
    const session = await manager.init({
      rootId: 'root-0',
      targetPath: '.',
      filename: 'demo.jar',
      size: 8,
      chunkSize: 4,
      fingerprint: 'missing-part',
    });

    await manager.writePart(session.uploadId, 0, bytes('ABCD'), { expectedSize: 4, expectedOffset: 0 });

    await expect(manager.complete(session.uploadId)).rejects.toThrow('Missing uploaded part 1');
  });
});
