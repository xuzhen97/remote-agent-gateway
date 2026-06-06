import type { ClientConfig } from '../../config/client.config.js';
import { downloadAliyunTransfer } from './aliyundrive-download-executor.js';

export function handleTransferWsMessage(input: {
  message: { type: string; payload: any };
  config: ClientConfig;
  send: (message: unknown) => boolean;
}): boolean {
  if (input.message.type !== 'transfer.download.start') return false;
  const payload = input.message.payload as { transferId?: string; clientId?: string };
  if (!payload.transferId || payload.clientId !== input.config.clientId) return true;
  void downloadAliyunTransfer({
    transferId: payload.transferId,
    clientId: input.config.clientId,
    apiBaseUrl: input.config.apiBaseUrl,
    serverToken: input.config.token,
    workspaceDir: input.config.workspaceDir,
    allowedRoots: input.config.allowedRoots,
    sendWs: input.send,
  }).catch((error) => console.error('Aliyun transfer download failed:', error instanceof Error ? error.message : error));
  return true;
}
