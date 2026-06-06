import * as fs from 'node:fs/promises';
import { CliError } from './http-error.js';

export interface AliyunUploadPlan {
  mode: 'aliyundrive';
  transferId: string;
  accessToken: string;
  openapiBase: string;
  driveId: string;
  fileId: string;
  uploadId: string;
  partSize: number;
  partCount: number;
  uploadParts: Array<{ partNumber: number; uploadUrl: string; size: number }>;
}

export interface AliyunUploadProgress {
  transferId: string;
  uploadedBytes: number;
  totalBytes: number;
  partNumber: number;
  partCount: number;
  rateBytesPerSecond: number;
  elapsedMs: number;
}

export async function uploadFileToAliyunDrive(options: {
  filePath: string;
  plan: AliyunUploadPlan;
  serverApi: {
    reportCliProgress(transferId: string, input: Record<string, unknown>): Promise<unknown>;
    completeCliUpload(transferId: string): Promise<unknown>;
    refreshUploadUrl(transferId: string, partNumbers: number[]): Promise<unknown>;
  };
  fetchImpl?: typeof fetch;
  retries?: number;
  onProgress?: (progress: AliyunUploadProgress) => void;
}): Promise<void> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const retries = options.retries ?? 5;
  const stat = await fs.stat(options.filePath);
  const file = await fs.open(options.filePath, 'r');
  const startedAt = Date.now();
  let uploadedBytes = 0;
  try {
    const parts = new Map(options.plan.uploadParts.map((part) => [part.partNumber, part]));
    for (let partNumber = 1; partNumber <= options.plan.partCount; partNumber += 1) {
      let part = parts.get(partNumber);
      if (!part) throw new CliError('ALIYUN_PLAN_ERROR', `Missing upload part ${partNumber}`);
      const offset = (partNumber - 1) * options.plan.partSize;
      const buffer = Buffer.alloc(part.size);
      const { bytesRead } = await file.read(buffer, 0, part.size, offset);
      if (bytesRead !== part.size) throw new CliError('IO_ERROR', `Expected ${part.size} bytes at offset ${offset}, got ${bytesRead}`);
      for (let attempt = 1; attempt <= retries; attempt += 1) {
        const response = await fetchImpl(part.uploadUrl, { method: 'PUT', headers: { 'Content-Type': '' }, body: buffer });
        if (response.ok) break;
        if ((response.status === 403 || response.status === 401) && attempt < retries) {
          const refreshed = await options.serverApi.refreshUploadUrl(options.plan.transferId, [partNumber]) as { uploadParts?: Array<{ partNumber: number; uploadUrl: string; size: number }> };
          const replacement = refreshed.uploadParts?.find((item) => item.partNumber === partNumber);
          if (replacement) part = replacement;
          await sleep(500 * attempt);
          continue;
        }
        if (attempt === retries) throw new CliError('ALIYUN_UPLOAD_ERROR', `Upload part ${partNumber} failed: HTTP ${response.status}`, response.status);
        await sleep(500 * attempt);
      }
      uploadedBytes += part.size;
      const progress: AliyunUploadProgress = {
        transferId: options.plan.transferId,
        uploadedBytes,
        totalBytes: stat.size,
        partNumber,
        partCount: options.plan.partCount,
        rateBytesPerSecond: uploadedBytes / Math.max((Date.now() - startedAt) / 1000, 1),
        elapsedMs: Date.now() - startedAt,
      };
      options.onProgress?.(progress);
      await options.serverApi.reportCliProgress(options.plan.transferId, progress as unknown as Record<string, unknown>);
    }
    const completeResponse = await fetchImpl(`${options.plan.openapiBase.replace(/\/+$/, '')}/adrive/v1.0/openFile/complete`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${options.plan.accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        drive_id: options.plan.driveId,
        file_id: options.plan.fileId,
        upload_id: options.plan.uploadId,
      }),
    });
    if (!completeResponse.ok) {
      throw new CliError('ALIYUN_UPLOAD_ERROR', `Complete upload failed: HTTP ${completeResponse.status}`, completeResponse.status);
    }
    await options.serverApi.completeCliUpload(options.plan.transferId);
  } finally {
    await file.close();
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
