import { describe, expect, it } from 'vitest';
import * as path from 'node:path';
import { resolveClientFilePath, toClientFileEntry, toClientFileStat } from './file-paths.js';

describe('client file path utilities', () => {
  const workspace = path.resolve('tmp-test-workspace');

  it('resolves relative paths inside workspace', () => {
    expect(resolveClientFilePath(workspace, 'notes/a.txt')).toBe(path.join(workspace, 'notes', 'a.txt'));
    expect(resolveClientFilePath(workspace, '.')).toBe(workspace);
  });

  it('rejects traversal and absolute paths', () => {
    expect(() => resolveClientFilePath(workspace, '../x.txt')).toThrow('路径遍历被拒绝');
    expect(() => resolveClientFilePath(workspace, '/tmp/x.txt')).toThrow('路径遍历被拒绝');
    expect(() => resolveClientFilePath(workspace, 'C:\\Windows\\win.ini')).toThrow('路径遍历被拒绝');
  });

  it('converts fs stats to API metadata', () => {
    const fakeStats = {
      isFile: () => true,
      isDirectory: () => false,
      size: 12,
      mtimeMs: 1000,
      ctimeMs: 900,
    } as import('node:fs').Stats;

    expect(toClientFileEntry('a.txt', 'notes/a.txt', fakeStats)).toEqual({
      name: 'a.txt',
      path: 'notes/a.txt',
      type: 'file',
      size: 12,
      mtimeMs: 1000,
    });

    expect(toClientFileStat('notes/a.txt', fakeStats)).toEqual({
      path: 'notes/a.txt',
      type: 'file',
      size: 12,
      mtimeMs: 1000,
      ctimeMs: 900,
    });
  });
});
