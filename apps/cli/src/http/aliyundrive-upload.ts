/** @file 阿里云盘分片上传实现
 *
 * 通过阿里云盘 OpenAPI 进行分片上传。
 * 流程：
 * 1. 服务端生成上传计划（包含 AccessToken、分片 URL 等）
 * 2. CLI 逐分片上传到阿里云盘
 * 3. 分片 URL 过期时通过刷新机制获取新 URL
 * 4. 通知阿里云盘合并文件
 * 5. 通知服务端上传完成
 */
import * as fs from 'node:fs/promises';
import { CliError } from './http-error.js';

/** 阿里云盘上传计划（由服务端生成） */
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

/** 阿里云盘上传进度 */
export interface AliyunUploadProgress {
  transferId: string;
  uploadedBytes: number;
  totalBytes: number;
  partNumber: number;
  partCount: number;
  rateBytesPerSecond: number;
  elapsedMs: number;
}

/**
 * 上传文件到阿里云盘
 * 按照服务端生成的计划逐分片上传，支持 URL 过期刷新和重试。
 */
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

    // 逐分片上传
    for (let partNumber = 1; partNumber <= options.plan.partCount; partNumber += 1) {
      let part = parts.get(partNumber);
      if (!part) throw new CliError('ALIYUN_PLAN_ERROR', `缺少上传分片 ${partNumber}`);

      const offset = (partNumber - 1) * options.plan.partSize;
      const buffer = Buffer.alloc(part.size);
      const { bytesRead } = await file.read(buffer, 0, part.size, offset);
      if (bytesRead !== part.size) throw new CliError('IO_ERROR', `在偏移 ${offset} 处期望 ${part.size} 字节，实际读取 ${bytesRead}`);

      // 上传单个分片（带重试和 URL 刷新）
      for (let attempt = 1; attempt <= retries; attempt += 1) {
        const response = await fetchImpl(part.uploadUrl, { method: 'PUT', headers: { 'Content-Type': '' }, body: buffer });
        if (response.ok) break;

        // Token 过期或权限错误时刷新上传 URL
        if ((response.status === 403 || response.status === 401) && attempt < retries) {
          const refreshed = await options.serverApi.refreshUploadUrl(options.plan.transferId, [partNumber]) as { uploadParts?: Array<{ partNumber: number; uploadUrl: string; size: number }> };
          const replacement = refreshed.uploadParts?.find((item) => item.partNumber === partNumber);
          if (replacement) part = replacement;
          await sleep(500 * attempt);
          continue;
        }

        if (attempt === retries) throw new CliError('ALIYUN_UPLOAD_ERROR', `上传分片 ${partNumber} 失败: HTTP ${response.status}`, response.status);
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

      // 上报分片进度到服务端
      await options.serverApi.reportCliProgress(options.plan.transferId, progress as unknown as Record<string, unknown>);
    }

    // 通知阿里云盘合并所有分片
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
      throw new CliError('ALIYUN_UPLOAD_ERROR', `完成上传失败: HTTP ${completeResponse.status}`, completeResponse.status);
    }

    // 通知服务端 CLI 上传完成
    await options.serverApi.completeCliUpload(options.plan.transferId);
  } finally {
    await file.close();
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
