import type { TransferStatus } from '@rag/shared';

const allowedTransitions: Record<TransferStatus, TransferStatus[]> = {
  created: ['waiting_cli_upload', 'failed', 'cancelled'],
  waiting_cli_upload: ['cli_uploading', 'failed', 'cancelled'],
  cli_uploading: ['aliyun_uploaded', 'failed', 'cancelled'],
  aliyun_uploaded: ['waiting_client_download', 'failed', 'cancelled'],
  waiting_client_download: ['client_downloading', 'failed', 'cancelled'],
  client_downloading: ['completed', 'failed', 'cancelled'],
  completed: [],
  failed: [],
  cancelled: [],
};

const secretKeyPattern = /(token|authorization|upload_url|download_url|downloadurl|uploadurl|secret)/i;

export function assertTransferTransition(from: TransferStatus, to: TransferStatus): void {
  if (!allowedTransitions[from]?.includes(to)) {
    throw new Error(`Invalid transfer transition: ${from} -> ${to}`);
  }
}

export function sanitizeTransferEventPayload(value: unknown): unknown {
  if (Array.isArray(value)) return value.map((item) => sanitizeTransferEventPayload(item));
  if (!value || typeof value !== 'object') return value;
  const result: Record<string, unknown> = {};
  for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
    result[key] = secretKeyPattern.test(key) ? '[redacted]' : sanitizeTransferEventPayload(child);
  }
  return result;
}
