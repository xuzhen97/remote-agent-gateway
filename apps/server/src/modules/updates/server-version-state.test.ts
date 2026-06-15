import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  clearRollbackServerUpdateContext,
  markPendingServerUpdateRolledBack,
  promotePendingServerVersion,
  readCurrentServerVersion,
  readPendingServerUpdateContext,
  readRollbackServerUpdateContext,
  readPreviousServerVersion,
  rollbackToPreviousServerVersion,
  writePendingServerUpdateContext,
  writePendingServerVersion,
} from './server-version-state.js';

const tempRoots: string[] = [];

function makeRoot(): string {
  const root = mkdtempSync(join(tmpdir(), 'rag-server-version-'));
  tempRoots.push(root);
  return root;
}

afterEach(() => {
  for (const root of tempRoots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe('server version state', () => {
  it('promotes pending server versions and supports rollback', () => {
    const root = makeRoot();

    writePendingServerVersion(root, { version: '1.0.0', entrypoint: 'versions/server/1.0.0/server.bundle.cjs' });
    promotePendingServerVersion(root);
    expect(readCurrentServerVersion(root)?.version).toBe('1.0.0');

    writePendingServerVersion(root, { version: '1.0.1', entrypoint: 'versions/server/1.0.1/server.bundle.cjs' });
    promotePendingServerVersion(root);
    expect(readCurrentServerVersion(root)?.version).toBe('1.0.1');
    expect(readPreviousServerVersion(root)?.version).toBe('1.0.0');

    rollbackToPreviousServerVersion(root);
    expect(readCurrentServerVersion(root)?.version).toBe('1.0.0');
  });

  it('moves pending server update context to rollback context', () => {
    const root = makeRoot();
    const context = {
      campaignId: 'camp_1',
      targetId: 'camp_1_server',
      attemptId: 'camp_1_server_1',
      fromVersion: '1.0.0',
      targetVersion: '1.0.1',
    };

    writePendingServerUpdateContext(root, context);
    expect(readPendingServerUpdateContext(root)).toEqual(expect.objectContaining(context));

    markPendingServerUpdateRolledBack(root, 'READY_TIMEOUT', 'server did not become ready');
    expect(readPendingServerUpdateContext(root)).toBeNull();
    expect(readRollbackServerUpdateContext(root)).toEqual(expect.objectContaining({
      ...context,
      errorCode: 'READY_TIMEOUT',
      errorMessage: 'server did not become ready',
    }));

    clearRollbackServerUpdateContext(root);
    expect(readRollbackServerUpdateContext(root)).toBeNull();
  });
});
