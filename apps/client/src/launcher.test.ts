import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { afterEach, describe, expect, it } from 'vitest';
import { decideNextLaunch, readCurrentVersionState, resolveClientEntrypoint } from './launcher.js';

const tempRoots: string[] = [];

function makeDeployRoot(): string {
  const root = join(tmpdir(), `rag-client-launcher-${process.pid}-${Date.now()}-${Math.random().toString(16).slice(2)}`);
  mkdirSync(root, { recursive: true });
  tempRoots.push(root);
  return root;
}

afterEach(() => {
  for (const root of tempRoots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

describe('client launcher entrypoint resolution', () => {
  it('uses current-version entrypoint when state exists', () => {
    const root = makeDeployRoot();
    const currentVersion = {
      version: '1.0.1',
      entrypoint: 'versions/client/1.0.1/client.bundle.cjs',
    };

    const result = resolveClientEntrypoint({
      deployRoot: root,
      currentVersion,
      bundleExists: (file) => file.endsWith(join('versions', 'client', '1.0.1', 'client.bundle.cjs')),
    });

    expect(result.version).toBe('1.0.1');
    expect(result.entrypoint).toContain('versions');
    expect(result.entrypoint).toContain('client.bundle.cjs');
  });

  it('falls back to root client.bundle.cjs for legacy deployments', () => {
    const root = makeDeployRoot();

    const result = resolveClientEntrypoint({
      deployRoot: root,
      currentVersion: null,
      bundleExists: (file) => file.endsWith('client.bundle.cjs'),
    });

    expect(result.version).toBe('bootstrap');
    expect(result.entrypoint).toContain('client.bundle.cjs');
  });

  it('reads current-version state and returns null for invalid state', () => {
    const root = makeDeployRoot();
    mkdirSync(join(root, 'state'), { recursive: true });

    expect(readCurrentVersionState(root)).toBeNull();

    writeFileSync(join(root, 'state', 'client-current-version.json'), JSON.stringify({ version: '', entrypoint: '' }));
    expect(readCurrentVersionState(root)).toBeNull();

    writeFileSync(join(root, 'state', 'client-current-version.json'), JSON.stringify({
      version: '1.0.1',
      entrypoint: 'versions/client/1.0.1/client.bundle.cjs',
    }));
    expect(readCurrentVersionState(root)).toEqual({
      version: '1.0.1',
      entrypoint: 'versions/client/1.0.1/client.bundle.cjs',
    });
  });
});

describe('client launcher restart decisions', () => {
  it('promotes pending on update restart exit code', () => {
    expect(decideNextLaunch({ exitCode: 20, hasPending: true, verificationFailed: false })).toBe('promote-pending');
  });

  it('rolls back when requested or when pending verification failed', () => {
    expect(decideNextLaunch({ exitCode: 21, hasPending: false, verificationFailed: false })).toBe('rollback');
    expect(decideNextLaunch({ exitCode: 1, hasPending: false, verificationFailed: true })).toBe('rollback');
  });

  it('exits on normal process exit', () => {
    expect(decideNextLaunch({ exitCode: 0, hasPending: false, verificationFailed: false })).toBe('exit');
  });
});
