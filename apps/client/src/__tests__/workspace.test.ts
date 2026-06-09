import { describe, it, expect } from 'vitest';
import * as path from 'node:path';
import { resolveWorkspace } from '../runtime/workspace.js';

describe('resolveWorkspace', () => {
  it('resolves path within workspace', () => {
    const ws = path.resolve('/tmp/workspace');
    const result = resolveWorkspace(ws, 'tasks', 'task-1');
    expect(result).toBe(path.join(ws, 'tasks', 'task-1'));
  });

  it('rejects path traversal', () => {
    const ws = path.resolve('/tmp/workspace');
    expect(() => resolveWorkspace(ws, '..', 'etc')).toThrow('路径遍历被拒绝');
  });

  it('allows workspace root itself', () => {
    const ws = path.resolve('/tmp/workspace');
    const result = resolveWorkspace(ws);
    expect(result).toBe(ws);
  });
});
