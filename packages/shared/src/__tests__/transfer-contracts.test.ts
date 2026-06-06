import { describe, expect, it } from 'vitest';
import {
  ClientTransferCompletePayloadSchema,
  ClientTransferFailedPayloadSchema,
  ClientTransferProgressPayloadSchema,
  ServerTransferDownloadStartPayloadSchema,
} from '../schemas.js';

const transferId = 'tr_123';

const baseProgress = {
  transferId,
  clientId: 'client-1',
  phase: 'client_downloading',
  downloadedBytes: 512,
  writtenBytes: 256,
  totalBytes: 1024,
  message: 'downloading',
};

describe('transfer websocket schemas', () => {
  it('accepts server download start payload', () => {
    const parsed = ServerTransferDownloadStartPayloadSchema.parse({ transferId, clientId: 'client-1' });
    expect(parsed.transferId).toBe(transferId);
  });

  it('accepts client progress payload', () => {
    const parsed = ClientTransferProgressPayloadSchema.parse(baseProgress);
    expect(parsed.downloadedBytes).toBe(512);
  });

  it('rejects negative transfer progress bytes', () => {
    expect(() => ClientTransferProgressPayloadSchema.parse({ ...baseProgress, downloadedBytes: -1 })).toThrow();
  });

  it('accepts client completion payload', () => {
    const parsed = ClientTransferCompletePayloadSchema.parse({
      transferId,
      clientId: 'client-1',
      rootId: 'workspace',
      path: 'drop/app.zip',
      size: 1024,
    });
    expect(parsed.path).toBe('drop/app.zip');
  });

  it('accepts client failure payload', () => {
    const parsed = ClientTransferFailedPayloadSchema.parse({
      transferId,
      clientId: 'client-1',
      errorCode: 'DOWNLOAD_FAILED',
      errorMessage: 'network reset',
    });
    expect(parsed.errorCode).toBe('DOWNLOAD_FAILED');
  });
});
