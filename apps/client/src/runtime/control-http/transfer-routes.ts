import type { ControlHttpRouter } from './router.js';
import { requireBearerToken } from './auth.js';
import { readJson, sendOk, sendError } from './response.js';
import { downloadAliyunTransfer } from '../transfers/aliyundrive-download-executor.js';

export function registerTransferRoutes(
  router: ControlHttpRouter,
  options: {
    token: string;
    clientId: string;
    apiBaseUrl: string;
    serverToken: string;
    workspaceDir: string;
    allowedRoots: string[];
  },
): void {
  router.add('POST', /^\/files\/aliyundrive-download$/, async (req, res) => {
    if (!requireBearerToken(req, res, options.token)) return;
    try {
      const payload = await readJson<{ transferId?: string }>(req);
      if (!payload.transferId) return sendError(res, 400, 'INVALID_REQUEST', 'transferId is required');
      void downloadAliyunTransfer({
        transferId: payload.transferId,
        clientId: options.clientId,
        apiBaseUrl: options.apiBaseUrl,
        serverToken: options.serverToken,
        workspaceDir: options.workspaceDir,
        allowedRoots: options.allowedRoots,
        reportProgress: (progress) => postTransferUpdate(options, payload.transferId!, '/client-progress', progress),
        reportComplete: (complete) => postTransferUpdate(options, payload.transferId!, '/client-complete', complete),
        reportFailed: (failed) => postTransferUpdate(options, payload.transferId!, '/fail', failed),
      }).catch((error) => console.error('Aliyun transfer download failed:', error instanceof Error ? error.message : error));
      sendOk(res, { queued: true, transferId: payload.transferId });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      sendError(res, 500, 'INTERNAL_ERROR', message);
    }
  });
}

async function postTransferUpdate(
  options: {
    apiBaseUrl: string;
    serverToken: string;
  },
  transferId: string,
  suffix: '/client-progress' | '/client-complete' | '/fail',
  payload: Record<string, unknown>,
): Promise<void> {
  const response = await fetch(`${options.apiBaseUrl}/api/transfers/${encodeURIComponent(transferId)}${suffix}`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${options.serverToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
  });
  if (!response.ok) {
    throw new Error(`Failed to report transfer update: HTTP ${response.status}`);
  }
}
