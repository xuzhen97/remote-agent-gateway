import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AliyunDriveAuthRecord, AliyunDriveConfigRecord } from './aliyundrive-types.js';

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

  const config: AliyunDriveConfigRecord = {
    id: 'default',
    clientId: 'app-id',
    clientSecret: null,
    scope: 'user:base,file:all:read,file:all:write',
    openapiBase: 'https://openapi.alipan.com',
    redirectUri: 'oob',
    transferFolder: 'RemoteAgentGatewayTransfers',
    cleanupTtlMs: 86_400_000,
    createdAt: 1,
    updatedAt: 1,
  };

  const auth: AliyunDriveAuthRecord = {
    id: 'default',
    accessToken: 'access-token',
    refreshToken: 'refresh-token',
    tokenType: 'Bearer',
    expiresAt: 10_000,
    driveId: null,
    authorizedAccountName: null,
    updatedAt: 1,
  };

  it('builds S256 code challenge', () => {
    expect(buildCodeChallenge('abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUV')).toMatch(/^[A-Za-z0-9_-]+$/);
  });

  it('challenge-verifier round-trip is consistent', () => {
    const verifier = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUV';
    const challenge1 = buildCodeChallenge(verifier);
    const challenge2 = buildCodeChallenge(verifier);
    expect(challenge1).toBe(challenge2);
  });

  it('builds an authorization URL with OOB redirect', async () => {
    const service = new AliyunDriveAuthService({
      fetchImpl: vi.fn() as any,
      now: () => 1000,
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
    expect(result.authorizationUrl).toContain('code_challenge_method=plain');
    expect(result.state).toHaveLength(32);
  });

  it('reports local authorization state as authorized when token is not expired', () => {
    const service = new AliyunDriveAuthService({ now: () => 1_000 });
    vi.spyOn(service, 'getConfig').mockReturnValue(config);
    vi.spyOn(service, 'getAuth').mockReturnValue({ ...auth, expiresAt: 400_000 });

    expect(service.getStatus()).toMatchObject({
      configured: true,
      authorized: true,
      authorizationState: 'authorized',
    });
  });

  it('tests authorization remotely and persists drive/account info on success', async () => {
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({
      default_drive_id: 'drive-1',
      nick_name: 'tester',
    }), { status: 200 }));
    const service = new AliyunDriveAuthService({ now: () => 1_000, fetchImpl: fetchImpl as any });
    vi.spyOn(service, 'getConfig').mockReturnValue(config);
    vi.spyOn(service, 'getAuth').mockReturnValue({ ...auth, expiresAt: 10_000 });
    const saveAuth = vi.spyOn(service, 'saveAuth').mockImplementation(() => undefined);

    await expect(service.testAuthorization()).resolves.toMatchObject({
      state: 'valid',
      driveId: 'drive-1',
      authorizedAccountName: 'tester',
    });
    expect(saveAuth).toHaveBeenCalledWith(expect.objectContaining({
      driveId: 'drive-1',
      authorizedAccountName: 'tester',
    }));
  });

  it('returns expired without remote call when local token is expired', async () => {
    const fetchImpl = vi.fn();
    const service = new AliyunDriveAuthService({ now: () => 10_000, fetchImpl: fetchImpl as any });
    vi.spyOn(service, 'getConfig').mockReturnValue(config);
    vi.spyOn(service, 'getAuth').mockReturnValue({ ...auth, expiresAt: 9_000 });

    await expect(service.testAuthorization()).resolves.toMatchObject({ state: 'expired' });
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});
