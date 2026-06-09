import { describe, expect, it } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { resolveAllowedRoots, resolveRootPath } from './file-roots.js';

describe('file roots', () => {
  it('builds stable root metadata from configured roots', () => {
    const roots = resolveAllowedRoots('/tmp/client', ['/', './workspace']);
    expect(roots.map((root) => root.id)).toEqual(['root-0', 'root-1']);
    expect(roots[1]?.label).toBe('workspace');
  });

  it('rejects path traversal outside a root', () => {
    const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'rag-root-'));
    const roots = resolveAllowedRoots(workspace, ['./workspace']);
    expect(() => resolveRootPath(roots, 'root-0', '../secret.txt')).toThrow('路径超出允许的根目录范围');
  });
});
