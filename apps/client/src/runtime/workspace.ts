import * as path from 'node:path';

/**
 * Resolve a path within the workspace directory.
 * All file operations are restricted to workspaceDir for security.
 */
export function resolveWorkspace(workspaceDir: string, ...segments: string[]): string {
  const resolved = path.resolve(workspaceDir, ...segments);

  // Security: ensure path stays within workspace
  const normalizedWorkspace = path.resolve(workspaceDir);
  if (!resolved.startsWith(normalizedWorkspace + path.sep) && resolved !== normalizedWorkspace) {
    throw new Error(`Path traversal denied: ${segments.join('/')} is outside workspace`);
  }

  return resolved;
}
