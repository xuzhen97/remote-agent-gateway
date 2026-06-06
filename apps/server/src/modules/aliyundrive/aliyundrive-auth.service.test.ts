import { beforeEach, describe, expect, it, vi } from 'vitest';

const rows = new Map<string, Record<string, unknown>>();

vi.mock('../../db/index.js', () => ({
  getDb: () => ({
    prepare: (sql: string) => ({
      bind: vi.fn(),
      step: vi.fn(() => false),
      getAsObject: vi.fn(() => ({})),
      free: vi.fn(),
    }),
    run: vi.fn((sql: string, params?: unknown[]) => {
      rows.set(sql, { params });
    }),
  }),
  saveDb: vi.fn(),
}));

import { AliyunDriveAuthService, buildCodeChallenge } from './aliyundrive-auth.service.js';

describe('AliyunDriveAuthService', () => {
  beforeEach(() => rows.clear());

  it('builds S256 code challenge', () => {
    expect(buildCodeChallenge('abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUV')).toMatch(/^[A-Za-z0-9_-]+$/);
  });

  it('builds an authorization URL with OOB redirect', async () => {
    const service = new AliyunDriveAuthService({
      fetchImpl: vi.fn() as any,
      now: () => 1000,
      randomString: () => 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUV',
    });
    const result = await service.startOAuth({
      clientId: 'app-id',
      scope: 'user:base,file:all:read,file:all:write',
      openapiBase: 'https://openapi.alipan.com',
      redirectUri: 'oob',
      transferFolder: 'RemoteAgentGatewayTransfers',
      cleanupTtlMs: 86_400_000,
    });
    expect(result.authorizationUrl).toContain('https://openapi.alipan.com/oauth/authorize');
    expect(result.authorizationUrl).toContain('client_id=app-id');
    expect(result.authorizationUrl).toContain('redirect_uri=oob');
    expect(result.authorizationUrl).toContain('code_challenge_method=S256');
    expect(result.state).toHaveLength(32);
  });
});
