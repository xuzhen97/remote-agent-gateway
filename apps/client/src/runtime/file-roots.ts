/** @file 文件根目录解析
 *
 * 将配置中的根目录路径解析为 ClientFileRoot 列表。
 * 文件操作必须通过 rootId + 相对路径进行，确保不超过安全边界。
 */
import * as path from 'node:path';
import type { ClientFileRoot } from '@rag/shared';

/**
 * 解析允许的根目录列表
 * @param baseDir - 基础工作目录
 * @param configuredRoots - 配置中指定的根目录路径列表
 * @returns 解析后的 ClientFileRoot 数组
 */
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

/**
 * 根据 rootId 和相对路径解析出绝对路径
 * @param roots - 允许的根目录列表
 * @param rootId - 根目录 ID
 * @param clientPath - 客户端请求的相对路径
 * @returns 解析后的绝对路径
 * @throws 如果 rootId 不存在或路径超出根目录范围
 */
export function resolveRootPath(roots: ClientFileRoot[], rootId: string, clientPath: string): string {
  const root = roots.find((entry) => entry.id === rootId);
  if (!root) throw new Error(`未知的 rootId: ${rootId}`);

  const relative = clientPath === '.' ? '' : clientPath.replace(/\\/g, '/');
  if (relative.split('/').some((part) => part === '..')) {
    throw new Error('路径超出允许的根目录范围');
  }

  const normalizedRoot = path.resolve(root.path);
  const resolved = relative ? path.resolve(normalizedRoot, relative) : normalizedRoot;
  // 二次校验：确保 resolved 确实是 normalizedRoot 的子路径
  const rel = path.relative(normalizedRoot, resolved);
  if (rel.startsWith('..') || path.isAbsolute(rel)) {
    throw new Error('路径超出允许的根目录范围');
  }
  return resolved;
}
