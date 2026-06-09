import { describe, expect, it } from 'vitest';
import { readUpdaterState, writeUpdaterState } from './updater-state.js';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

describe('updater state', () => {
  it('persists and reloads updater progress', () => {
    const dir = mkdtempSync(join(tmpdir(), 'rag-updater-state-'));
    try {
      writeUpdaterState(dir, { currentVersion: '0.1.0', targetVersion: 'v1.4.0', phase: 'downloading' });
      const loaded = readUpdaterState(dir);
      expect(loaded?.targetVersion).toBe('v1.4.0');
      expect(loaded?.phase).toBe('downloading');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('returns null when no state file exists', () => {
    expect(readUpdaterState('/nonexistent/path')).toBeNull();
  });
});
