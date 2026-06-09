import * as fs from 'node:fs';
import * as fsp from 'node:fs/promises';
import * as path from 'node:path';
import { resolveAllowedRoots, resolveRootPath } from '../file-roots.js';

export async function downloadAliyunTransfer(options: {
  transferId: string;
  clientId: string;
  apiBaseUrl: string;
  serverToken: string;
  workspaceDir: string;
  allowedRoots: string[];
  fetchImpl?: typeof fetch;
  sendWs?: (message: unknown) => boolean;
  reportProgress?: (payload: { transferId: string; clientId: string; phase: 'client_downloading'; downloadedBytes: number; writtenBytes: number; totalBytes: number }) => Promise<void> | void;
  reportComplete?: (payload: { transferId: string; clientId: string; rootId: string; path: string; size: number }) => Promise<void> | void;
  reportFailed?: (payload: { transferId: string; clientId: string; errorCode: string; errorMessage: string }) => Promise<void> | void;
}): Promise<void> {
  const fetchImpl = options.fetchImpl ?? fetch;
  try {
    const detailResponse = await fetchImpl(`${options.apiBaseUrl}/api/transfers/${encodeURIComponent(options.transferId)}`, {
      headers: { Authorization: `Bearer ${options.serverToken}` },
    });
    if (!detailResponse.ok) throw new Error(`Failed to fetch transfer detail: HTTP ${detailResponse.status}`);
    const detail = await detailResponse.json() as any;
    const roots = resolveAllowedRoots(options.workspaceDir, options.allowedRoots);
    const targetDir = resolveRootPath(roots, detail.rootId, detail.targetDir);
    await ensureDir(targetDir);
    const finalPath = path.join(targetDir, detail.filename);
    const tempPath = path.join(targetDir, `.rag-transfer-${options.transferId}.part`);
    const downloadUrl = detail.downloadUrl ?? await fetchDownloadUrl(fetchImpl, options);
    const response = await fetchImpl(downloadUrl);
    if (!response.ok || !response.body) throw new Error(`Aliyun download failed: HTTP ${response.status}`);
    const writable = fs.createWriteStream(tempPath);
    let downloadedBytes = 0;
    let lastReport = 0;
    for await (const chunk of response.body as any as AsyncIterable<Uint8Array>) {
      downloadedBytes += chunk.length;
      if (!writable.write(chunk)) await new Promise((resolve) => writable.once('drain', resolve));
      if (Date.now() - lastReport > 1000) {
        lastReport = Date.now();
        const progressPayload = { transferId: options.transferId, clientId: options.clientId, phase: 'client_downloading' as const, downloadedBytes, writtenBytes: downloadedBytes, totalBytes: detail.size };
        options.sendWs?.({ type: 'client.transfer.progress', payload: progressPayload });
        await options.reportProgress?.(progressPayload);
      }
    }
    await new Promise<void>((resolve, reject) => writable.end((error: Error | null | undefined) => error ? reject(error) : resolve()));
    if (fs.existsSync(finalPath)) await fsp.rm(finalPath, { force: true });
    await fsp.rename(tempPath, finalPath);
    const completePayload = { transferId: options.transferId, clientId: options.clientId, rootId: detail.rootId, path: path.posix.join(detail.targetDir === '.' ? '' : detail.targetDir.replace(/\\/g, '/'), detail.filename), size: detail.size };
    options.sendWs?.({ type: 'client.transfer.complete', payload: completePayload });
    await options.reportComplete?.(completePayload);
  } catch (error) {
    const failedPayload = { transferId: options.transferId, clientId: options.clientId, errorCode: 'DOWNLOAD_FAILED', errorMessage: error instanceof Error ? error.message : String(error) };
    options.sendWs?.({ type: 'client.transfer.failed', payload: failedPayload });
    await options.reportFailed?.(failedPayload);
    throw error;
  }
}

async function ensureDir(dir: string): Promise<void> {
  if (!fs.existsSync(dir)) await fsp.mkdir(dir, { recursive: true });
}

async function fetchDownloadUrl(fetchImpl: typeof fetch, options: { apiBaseUrl: string; serverToken: string; transferId: string }): Promise<string> {
  const response = await fetchImpl(`${options.apiBaseUrl}/api/transfers/${encodeURIComponent(options.transferId)}/refresh-download-url`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${options.serverToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({}),
  });
  if (!response.ok) throw new Error(`Failed to refresh download URL: HTTP ${response.status}`);
  const data = await response.json() as { downloadUrl?: string };
  if (!data.downloadUrl) throw new Error('Server did not return downloadUrl');
  return data.downloadUrl;
}
