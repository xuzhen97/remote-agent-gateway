import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  promotePendingVersion,
  readClientVersionState,
  rollbackToPreviousVersion,
  writePendingVersion,
} from './current-version.js';

const tempRoots: string[] = [];

function makeDeployRoot(): string {
  const root = mkdtempSync(join(tmpdir(), 'rag-current-version-'));
  tempRoots.push(root);
  return root;
}

afterEach(() => {
  for (const root of tempRoots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe('client current version state', () => {
  it('writes pending and promotes it to current while preserving previous', () => {
    const root = makeDeployRoot();

    writePendingVersion(root, { version: '1.0.0', entrypoint: 'versions/client/1.0.0/client.bundle.cjs' });
    promotePendingVersion(root);
    expect(readClientVersionState(root).current?.version).toBe('1.0.0');
    expect(readClientVersionState(root).pending).toBeNull();

    writePendingVersion(root, { version: '1.0.1', entrypoint: 'versions/client/1.0.1/client.bundle.cjs' });
    promotePendingVersion(root);

    const state = readClientVersionState(root);
    expect(state.current?.version).toBe('1.0.1');
    expect(state.previous?.version).toBe('1.0.0');
    expect(state.pending).toBeNull();
  });

  it('rolls back previous to current', () => {
    const root = makeDeployRoot();

    writePendingVersion(root, { version: '1.0.0', entrypoint: 'versions/client/1.0.0/client.bundle.cjs' });
    promotePendingVersion(root);
    writePendingVersion(root, { version: '1.0.1', entrypoint: 'versions/client/1.0.1/client.bundle.cjs' });
    promotePendingVersion(root);

    rollbackToPreviousVersion(root);

    const state = readClientVersionState(root);
    expect(state.current?.version).toBe('1.0.0');
    expect(state.previous?.version).toBe('1.0.1');
    expect(state.pending).toBeNull();
  });
});
