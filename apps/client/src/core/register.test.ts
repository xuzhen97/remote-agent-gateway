import { describe, expect, it, vi } from 'vitest';
import { sendRegister } from './register.js';

vi.mock('../version.js', () => ({ CLIENT_VERSION: '9.9.9-test' }));
vi.mock('node:os', () => ({ hostname: vi.fn(() => 'test-host') }));
vi.mock('systeminformation', () => ({
  osInfo: vi.fn().mockResolvedValue({ platform: 'windows', arch: 'x64' }),
}));

describe('sendRegister', () => {
  it('reports the injected client version in the registration payload', async () => {
    const send = vi.fn();

    await sendRegister({ send } as any, {
      clientId: 'client-1',
      clientName: 'Client 1',
      serverUrl: 'ws://server/ws/client',
      apiBaseUrl: 'http://server',
      token: 'token',
      workspaceDir: process.cwd(),
      allowedRoots: [],
      tags: ['prod'],
      httpHost: '127.0.0.1',
      httpPort: 17890,
      jobMaxConcurrent: 1,
      jobDefaultTimeoutMs: 1_000,
      jobMaxTimeoutMs: 5_000,
      jobLogBufferLines: 100,
      taskAuditStorePath: '.rag/task-audit.jsonl',
    });

    expect(send).toHaveBeenCalledWith(expect.objectContaining({
      type: 'client.register',
      payload: expect.objectContaining({
        version: '9.9.9-test',
        hostname: 'test-host',
        os: 'windows',
        arch: 'x64',
      }),
    }));
  });
});
