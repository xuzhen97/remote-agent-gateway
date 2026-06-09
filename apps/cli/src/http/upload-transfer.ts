/** @file 分片上传工具
 *
 * 支持断点续传的分片上传实现。
 * 上传流程：
 * 1. 初始化上传会话（获取 uploadId、分片信息）
 * 2. 按分片逐个上传（支持重试和断点续传）
 * 3. 完成上传（合并分片）
 *
 * 弱网/FRP 抖动时自动重试失败分片。
 * 再次执行同一文件上传时尝试续传。
 */
import { createHash } from 'node:crypto';
import * as fs from 'node:fs/promises';
import type { ClientFileUploadCompleteResult, ClientFileUploadInitResult } from '@rag/shared';
import type { ClientHttpApi } from './client-http.js';
import { CliError } from './http-error.js';

/** 上传进度回调信息 */
export interface UploadProgress {
  filename: string;
  uploadedBytes: number;
  totalBytes: number;
  partNumber: number;
  partCount: number;
  attempt: number;
  rateBytesPerSecond: number;
  elapsedMs: number;
}

/**
 * 分片上传文件（带进度回调和重试）
 * @param client - 客户端 HTTP API
 * @param options.rootId - 根目录 ID
 * @param options.path - 目标路径
 * @param options.filePath - 本地文件路径
 * @param options.filename - 远程文件名
 * @param options.chunkSize - 分片大小（默认 8MB）
 * @param options.retries - 每个分片最大重试次数（默认 5）
 * @param options.onProgress - 进度回调
 */
export async function uploadFileWithProgress(
  client: Pick<ClientHttpApi, 'initUploadSession' | 'uploadPart' | 'completeUploadSession' | 'abortUploadSession'>,
  options: {
    rootId: string;
    path: string;
    filePath: string;
    filename: string;
    chunkSize?: number;
    retries?: number;
    onProgress?: (progress: UploadProgress) => void;
  },
): Promise<ClientFileUploadCompleteResult> {
  const stat = await fs.stat(options.filePath);
  const chunkSize = options.chunkSize ?? 8 * 1024 * 1024;
  const retries = options.retries ?? 5;

  // 创建文件指纹（用于续传检测）
  const fingerprint = await createFingerprint(options.filePath, stat.size, stat.mtimeMs);

  // 初始化上传会话（如果是续传会返回已上传的分片）
  const init = await client.initUploadSession({
    rootId: options.rootId,
    path: options.path,
    filename: options.filename,
    size: stat.size,
    chunkSize,
    lastModifiedMs: Math.trunc(stat.mtimeMs),
    fingerprint,
  });

  const file = await fs.open(options.filePath, 'r');
  const startedAt = Date.now();
  let uploadedBytes = init.uploadedBytes;
  const uploadedParts = new Set(init.uploadedParts);

  try {
    // 跳过已上传的分片，只上传未完成的分片
    for (let partNumber = 0; partNumber < init.partCount; partNumber += 1) {
      if (uploadedParts.has(partNumber)) continue;

      const offset = partNumber * init.chunkSize;
      const size = resolvePartSize(init, partNumber);
      const buffer = Buffer.alloc(size);
      const { bytesRead } = await file.read(buffer, 0, size, offset);
      if (bytesRead !== size) throw new CliError('IO_ERROR', `在偏移 ${offset} 处期望 ${size} 字节，实际读取 ${bytesRead}`);

      // 上传单个分片（带重试）
      await uploadPartWithRetry(client, init.uploadId, partNumber, buffer, { offset, size }, retries);

      uploadedBytes += size;
      options.onProgress?.({
        filename: options.filename,
        uploadedBytes,
        totalBytes: stat.size,
        partNumber,
        partCount: init.partCount,
        attempt: 1,
        rateBytesPerSecond: uploadedBytes / Math.max((Date.now() - startedAt) / 1000, 1),
        elapsedMs: Date.now() - startedAt,
      });
    }

    // 完成上传（合并分片）
    return await client.completeUploadSession(init.uploadId);
  } catch (error) {
    // 非重试类错误时清理上传会话
    if (!isRetryable(error)) {
      await client.abortUploadSession(init.uploadId).catch(() => undefined);
    }
    throw error;
  } finally {
    await file.close();
  }
}

/** 计算分片实际大小（最后一个分片可能小于 chunkSize） */
function resolvePartSize(init: ClientFileUploadInitResult, partNumber: number): number {
  if (partNumber === init.partCount - 1) return init.size - (init.chunkSize * (init.partCount - 1));
  return init.chunkSize;
}

/**
 * 创建文件指纹（用于续传检测）
 * 基于文件大小、修改时间和头尾各 64KB 内容的 SHA256 哈希
 */
async function createFingerprint(filePath: string, size: number, mtimeMs: number): Promise<string> {
  const file = await fs.open(filePath, 'r');
  try {
    const head = Buffer.alloc(Math.min(size, 64 * 1024));
    const tail = Buffer.alloc(Math.min(size, 64 * 1024));
    await file.read(head, 0, head.length, 0);
    await file.read(tail, 0, tail.length, Math.max(0, size - tail.length));
    return createHash('sha256').update(String(size)).update(String(Math.trunc(mtimeMs))).update(head).update(tail).digest('hex');
  } finally {
    await file.close();
  }
}

/** 上传单个分片（带重试） */
async function uploadPartWithRetry(
  client: Pick<ClientHttpApi, 'uploadPart'>,
  uploadId: string,
  partNumber: number,
  buffer: Uint8Array,
  meta: { offset: number; size: number },
  retries: number,
): Promise<void> {
  for (let attempt = 1; attempt <= retries; attempt += 1) {
    try {
      await client.uploadPart(uploadId, partNumber, buffer, meta);
      return;
    } catch (error) {
      if (!isRetryable(error) || attempt === retries) throw error;
      await sleep(resolveBackoffMs(attempt));
    }
  }
}

/** 判断错误是否可重试（网络抖动、502/503/504 等） */
function isRetryable(error: unknown): boolean {
  if (error instanceof CliError && error.code === 'HTTP_ERROR') return [502, 503, 504].includes(error.status ?? 0);
  const message = error instanceof Error ? error.message.toLowerCase() : String(error).toLowerCase();
  return message.includes('econnreset') || message.includes('etimedout') || message.includes('fetch failed') || message.includes('socket hang up');
}

/** 计算退避时间（毫秒） */
function resolveBackoffMs(attempt: number): number {
  return [0, 2000, 5000, 10000, 10000, 10000][attempt] ?? 10000;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
