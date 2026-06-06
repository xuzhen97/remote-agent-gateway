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
        sendWs: () => true,
      }).catch((error) => console.error('Aliyun transfer download failed:', error instanceof Error ? error.message : error));
      sendOk(res, { queued: true, transferId: payload.transferId });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      sendError(res, 500, 'INTERNAL_ERROR', message);
    }
  });
}
