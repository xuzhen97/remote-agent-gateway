import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../version.js', () => ({ CLIENT_VERSION: '9.9.9-test' }));

import { startControlHttpServer, stopControlHttpServer } from './server.js';

describe('control http server health version', () => {
  afterEach(async () => {
    await stopControlHttpServer();
  });

  it('returns the injected client version from /health instead of a hard-coded value', async () => {
    const state = await startControlHttpServer({
      clientId: 'client-1',
      host: '127.0.0.1',
      port: 0,
      token: 'secret-token',
      workspaceDir: process.cwd(),
      allowedRoots: [process.cwd()],
      job: {
        maxConcurrent: 1,
        defaultTimeoutMs: 1_000,
        maxTimeoutMs: 5_000,
        logBufferLines: 100,
      },
    });

    const response = await fetch(`http://${state.host}:${state.port}/health`, {
      headers: { Authorization: 'Bearer secret-token' },
    });
    const body = await response.json() as { ok: boolean; data: { version: string } };

    expect(response.status).toBe(200);
    expect(body.ok).toBe(true);
    expect(body.data.version).toBe('9.9.9-test');
  });
});
