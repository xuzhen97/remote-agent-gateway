import { createHash } from 'node:crypto';
import * as fs from 'node:fs/promises';
import type { ClientFileUploadCompleteResult, ClientFileUploadInitResult } from '@rag/shared';
import type { ClientHttpApi } from './client-http.js';
import { CliError } from './http-error.js';

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
  const fingerprint = await createFingerprint(options.filePath, stat.size, stat.mtimeMs);
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
    for (let partNumber = 0; partNumber < init.partCount; partNumber += 1) {
      if (uploadedParts.has(partNumber)) continue;
      const offset = partNumber * init.chunkSize;
      const size = resolvePartSize(init, partNumber);
      const buffer = Buffer.alloc(size);
      const { bytesRead } = await file.read(buffer, 0, size, offset);
      if (bytesRead !== size) throw new CliError('IO_ERROR', `Expected ${size} bytes at offset ${offset}, got ${bytesRead}`);
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
    return await client.completeUploadSession(init.uploadId);
  } catch (error) {
    if (!isRetryable(error)) {
      await client.abortUploadSession(init.uploadId).catch(() => undefined);
    }
    throw error;
  } finally {
    await file.close();
  }
}

function resolvePartSize(init: ClientFileUploadInitResult, partNumber: number): number {
  if (partNumber === init.partCount - 1) return init.size - (init.chunkSize * (init.partCount - 1));
  return init.chunkSize;
}

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

function isRetryable(error: unknown): boolean {
  if (error instanceof CliError && error.code === 'HTTP_ERROR') return [502, 503, 504].includes(error.status ?? 0);
  const message = error instanceof Error ? error.message.toLowerCase() : String(error).toLowerCase();
  return message.includes('econnreset') || message.includes('etimedout') || message.includes('fetch failed') || message.includes('socket hang up');
}

function resolveBackoffMs(attempt: number): number {
  return [0, 2000, 5000, 10000, 10000, 10000][attempt] ?? 10000;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
