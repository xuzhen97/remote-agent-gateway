/** @file 工作区路径解析
 *
 * 所有文件操作都会被限制在 workspaceDir 内，
 * 防止路径遍历攻击（path traversal attack）。
 */
import * as path from 'node:path';

/**
 * 解析工作区内的路径
 * @param workspaceDir - 工作区根目录
 * @param segments - 路径片段
 * @returns 规范化后的绝对路径
 * @throws 如果解析后的路径超出工作区范围则抛出错误
 *
 * @example
 * ```ts
 * resolveWorkspace('/data/workspace', 'jobs', 'job-123');
 * // => /data/workspace/jobs/job-123
 * ```
 */
export function resolveWorkspace(workspaceDir: string, ...segments: string[]): string {
  const resolved = path.resolve(workspaceDir, ...segments);

  // 安全检查：确保路径不超出工作区
  const normalizedWorkspace = path.resolve(workspaceDir);
  if (!resolved.startsWith(normalizedWorkspace + path.sep) && resolved !== normalizedWorkspace) {
    throw new Error(`路径遍历被拒绝: ${segments.join('/')} 超出工作区范围`);
  }

  return resolved;
}
