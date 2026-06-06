import { describe, expect, it } from 'vitest';
import { assertTransferTransition, sanitizeTransferEventPayload } from './transfer-state.js';

describe('transfer-state', () => {
  it('allows the normal aliyundrive upload path', () => {
    expect(() => assertTransferTransition('waiting_cli_upload', 'cli_uploading')).not.toThrow();
    expect(() => assertTransferTransition('cli_uploading', 'aliyun_uploaded')).not.toThrow();
    expect(() => assertTransferTransition('aliyun_uploaded', 'waiting_client_download')).not.toThrow();
    expect(() => assertTransferTransition('waiting_client_download', 'client_downloading')).not.toThrow();
    expect(() => assertTransferTransition('client_downloading', 'completed')).not.toThrow();
  });

  it('rejects invalid forward jumps', () => {
    expect(() => assertTransferTransition('waiting_cli_upload', 'completed')).toThrow('Invalid transfer transition');
  });

  it('allows failure from active states', () => {
    expect(() => assertTransferTransition('client_downloading', 'failed')).not.toThrow();
  });

  it('redacts credentials and signed urls from event payloads', () => {
    const sanitized = sanitizeTransferEventPayload({
      accessToken: 'secret',
      refresh_token: 'refresh',
      upload_url: 'https://upload.example/signature',
      downloadUrl: 'https://download.example/signature',
      safe: 'visible',
    });
    expect(sanitized).toEqual({
      accessToken: '[redacted]',
      refresh_token: '[redacted]',
      upload_url: '[redacted]',
      downloadUrl: '[redacted]',
      safe: 'visible',
    });
  });
});
