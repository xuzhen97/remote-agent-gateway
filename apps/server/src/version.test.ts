import { afterEach, describe, expect, it, vi } from 'vitest';

describe('SERVER_VERSION', () => {
  afterEach(() => {
    delete process.env.RAG_BUILD_VERSION;
    vi.resetModules();
  });

  it('uses the injected build version instead of reading package.json at runtime', async () => {
    process.env.RAG_BUILD_VERSION = '9.9.9-test';
    const { SERVER_VERSION } = await import('./version.js');
    expect(SERVER_VERSION).toBe('9.9.9-test');
  });

  it('falls back to 0.0.0 when no build version is injected', async () => {
    delete process.env.RAG_BUILD_VERSION;
    const { SERVER_VERSION } = await import('./version.js');
    expect(SERVER_VERSION).toBe('0.0.0');
  });
});
