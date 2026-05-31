import * as path from 'node:path';
import type { ClientFileRoot } from '@rag/shared';

export function resolveAllowedRoots(baseDir: string, configuredRoots?: string[]): ClientFileRoot[] {
  const roots = (configuredRoots && configuredRoots.length > 0) ? configuredRoots : ['./workspace'];
  return roots.map((rootPath, index) => {
    const absolute = path.isAbsolute(rootPath) ? rootPath : path.resolve(baseDir, rootPath);
    return {
      id: `root-${index}`,
      label: rootPath === './workspace' ? 'workspace' : rootPath,
      path: path.resolve(absolute),
    };
  });
}

export function resolveRootPath(roots: ClientFileRoot[], rootId: string, clientPath: string): string {
  const root = roots.find((entry) => entry.id === rootId);
  if (!root) throw new Error(`Unknown rootId: ${rootId}`);

  const relative = clientPath === '.' ? '' : clientPath.replace(/\\/g, '/');
  if (relative.split('/').some((part) => part === '..')) {
    throw new Error('Path outside allowed root');
  }

  const resolved = relative ? path.resolve(root.path, relative) : path.resolve(root.path);
  const normalizedRoot = path.resolve(root.path);
  if (resolved !== normalizedRoot && !resolved.startsWith(normalizedRoot + path.sep)) {
    throw new Error('Path outside allowed root');
  }
  return resolved;
}
