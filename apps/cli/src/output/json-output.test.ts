import { describe, expect, it } from 'vitest';
import { CliError } from '../http/http-error.js';
import { errorEnvelope, successEnvelope } from './json-output.js';

describe('json output envelopes', () => {
  it('wraps success data', () => {
    expect(successEnvelope({ id: 'client-1' })).toEqual({ ok: true, data: { id: 'client-1' } });
  });

  it('wraps typed errors without leaking tokens', () => {
    const envelope = errorEnvelope(new CliError('HTTP_ERROR', 'Request failed with token secret-token', 500));
    expect(envelope.ok).toBe(false);
    expect(envelope.error.code).toBe('HTTP_ERROR');
    expect(envelope.error.status).toBe(500);
    expect(envelope.error.message).toContain('[已脱敏]');
    expect(envelope.error.message).not.toContain('secret-token');
  });

  it('wraps generic errors as NETWORK_ERROR', () => {
    expect(errorEnvelope(new Error('connection refused')).error.code).toBe('NETWORK_ERROR');
  });
});
