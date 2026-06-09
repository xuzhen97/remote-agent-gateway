/** @file 文件路径工具
 *
 * 处理客户端文件路径的规范化、合法性校验，
 * 以及将 fs.Stats 转换为 API 响应格式。
 */
import * as path from 'node:path';
import type { Stats } from 'node:fs';
import type { ClientFileEntry, ClientFileStat } from '@rag/shared';

/**
 * 规范化并校验相对路径
 * @throws 如果路径包含绝对路径、盘符路径或父目录回溯
 */
function normalizeRelativePath(input: string): string {
  const normalized = input.replace(/\\/g, '/').trim();
  if (normalized === '' || normalized === '.') return '.';
  if (normalized.startsWith('/')) throw new Error('路径遍历被拒绝: 不允许使用绝对路径');
  if (/^[A-Za-z]:\//.test(normalized)) throw new Error('路径遍历被拒绝: 不允许使用盘符路径');
  if (normalized.split('/').some((part) => part === '..')) {
    throw new Error('路径遍历被拒绝: 不允许使用父目录引用');
  }
  return normalized;
}

/**
 * 解析客户端文件路径
 * @param workspaceDir - 工作区目录
 * @param clientPath - 客户端传入的相对路径
 * @returns 规范化后的绝对路径
 * @throws 如果路径超出工作区范围则抛出错误
 */
export function resolveClientFilePath(workspaceDir: string, clientPath: string): string {
  const workspace = path.resolve(workspaceDir);
  const relative = normalizeRelativePath(clientPath);
  const resolved = relative === '.' ? workspace : path.resolve(workspace, relative);

  if (resolved !== workspace && !resolved.startsWith(workspace + path.sep)) {
    throw new Error(`路径遍历被拒绝: ${clientPath} 超出工作区范围`);
  }

  return resolved;
}

/**
 * 检测文件类型
 */
export function detectFileType(stats: Stats): 'file' | 'directory' | 'other' {
  if (stats.isFile()) return 'file';
  if (stats.isDirectory()) return 'directory';
  return 'other';
}

/** 将文件名和 Stats 转换为 ClientFileEntry 格式 */
export function toClientFileEntry(name: string, clientPath: string, stats: Stats): ClientFileEntry {
  return {
    name,
    path: clientPath.replace(/\\/g, '/'),
    type: detectFileType(stats),
    size: stats.size,
    mtimeMs: stats.mtimeMs,
  };
}

/** 将路径和 Stats 转换为 ClientFileStat 格式 */
export function toClientFileStat(clientPath: string, stats: Stats): ClientFileStat {
  return {
    path: clientPath.replace(/\\/g, '/'),
    type: detectFileType(stats),
    size: stats.size,
    mtimeMs: stats.mtimeMs,
    ctimeMs: stats.ctimeMs,
  };
}
