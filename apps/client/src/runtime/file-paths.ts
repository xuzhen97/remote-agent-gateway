import * as path from 'node:path';
import type { Stats } from 'node:fs';
import type { ClientFileEntry, ClientFileStat } from '@rag/shared';

function normalizeRelativePath(input: string): string {
  const normalized = input.replace(/\\/g, '/').trim();
  if (normalized === '' || normalized === '.') return '.';
  if (normalized.startsWith('/')) throw new Error('Path traversal denied: absolute paths are not allowed');
  if (/^[A-Za-z]:\//.test(normalized)) throw new Error('Path traversal denied: drive paths are not allowed');
  if (normalized.split('/').some((part) => part === '..')) {
    throw new Error('Path traversal denied: parent segments are not allowed');
  }
  return normalized;
}

export function resolveClientFilePath(workspaceDir: string, clientPath: string): string {
  const workspace = path.resolve(workspaceDir);
  const relative = normalizeRelativePath(clientPath);
  const resolved = relative === '.' ? workspace : path.resolve(workspace, relative);

  if (resolved !== workspace && !resolved.startsWith(workspace + path.sep)) {
    throw new Error(`Path traversal denied: ${clientPath} is outside workspace`);
  }

  return resolved;
}

export function detectFileType(stats: Stats): 'file' | 'directory' | 'other' {
  if (stats.isFile()) return 'file';
  if (stats.isDirectory()) return 'directory';
  return 'other';
}

export function toClientFileEntry(name: string, clientPath: string, stats: Stats): ClientFileEntry {
  return {
    name,
    path: clientPath.replace(/\\/g, '/'),
    type: detectFileType(stats),
    size: stats.size,
    mtimeMs: stats.mtimeMs,
  };
}

export function toClientFileStat(clientPath: string, stats: Stats): ClientFileStat {
  return {
    path: clientPath.replace(/\\/g, '/'),
    type: detectFileType(stats),
    size: stats.size,
    mtimeMs: stats.mtimeMs,
    ctimeMs: stats.ctimeMs,
  };
}
