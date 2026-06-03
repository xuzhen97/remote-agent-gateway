import { describe, expect, it } from 'vitest';
import { deriveClientHttpToken } from './client-http-token.service.js';

describe('deriveClientHttpToken', () => {
  it('is stable for the same secret, version, and client id', () => {
    const a = deriveClientHttpToken({ tokenSecret: 'secret-a', tokenVersion: 1, clientId: 'client-1' });
    const b = deriveClientHttpToken({ tokenSecret: 'secret-a', tokenVersion: 1, clientId: 'client-1' });
    expect(a).toBe(b);
    expect(a.length).toBeGreaterThanOrEqual(43);
  });

  it('changes when tokenVersion changes', () => {
    const v1 = deriveClientHttpToken({ tokenSecret: 'secret-a', tokenVersion: 1, clientId: 'client-1' });
    const v2 = deriveClientHttpToken({ tokenSecret: 'secret-a', tokenVersion: 2, clientId: 'client-1' });
    expect(v1).not.toBe(v2);
  });
});
