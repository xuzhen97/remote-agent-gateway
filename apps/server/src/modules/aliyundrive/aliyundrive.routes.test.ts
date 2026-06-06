import { describe, expect, it, vi } from 'vitest';
import Fastify from 'fastify';
import { aliyunDriveRoutes } from './aliyundrive.routes.js';

vi.mock('../auth/auth.middleware.js', () => ({
  authMiddleware: async (request: unknown) => { (request as { authRole?: string }).authRole = 'admin'; },
}));

vi.mock('./aliyundrive-auth.service.js', () => ({
  aliyunDriveAuthService: {
    getStatus: vi.fn(() => ({ configured: false, authorized: false, authorizationState: 'unauthorized' })),
    saveConfig: vi.fn((input) => ({ id: 'default', ...input, createdAt: 1, updatedAt: 2 })),
    startOAuth: vi.fn(async () => ({ state: 'state-1', authorizationUrl: 'https://openapi.alipan.com/oauth/authorize?client_id=app', expiresAt: 123 })),
    completeOAuth: vi.fn(async () => ({ configured: true, authorized: true, authorizationState: 'authorized' })),
    testAuthorization: vi.fn(async () => ({ state: 'valid', message: '授权有效', checkedAt: 123 })),
    revoke: vi.fn(),
  },
}));

describe('aliyunDriveRoutes', () => {
  it('returns status', async () => {
    const app = Fastify();
    await app.register(aliyunDriveRoutes);
    const res = await app.inject({ method: 'GET', url: '/api/aliyundrive/status', headers: { authorization: 'Bearer token' } });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ configured: false, authorized: false, authorizationState: 'unauthorized' });
  });

  it('saves config', async () => {
    const app = Fastify();
    await app.register(aliyunDriveRoutes);
    const res = await app.inject({
      method: 'PUT',
      url: '/api/aliyundrive/config',
      headers: { authorization: 'Bearer token' },
      payload: { clientId: 'app-id', cleanupTtlMs: 86400000 },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().clientSecret).toBeUndefined();
  });

  it('starts oauth', async () => {
    const app = Fastify();
    await app.register(aliyunDriveRoutes);
    const res = await app.inject({ method: 'POST', url: '/api/aliyundrive/oauth/start', headers: { authorization: 'Bearer token' } });
    expect(res.statusCode).toBe(200);
    expect(res.json().authorizationUrl).toContain('openapi.alipan.com');
  });

  it('tests authorization remotely', async () => {
    const app = Fastify();
    await app.register(aliyunDriveRoutes);
    const res = await app.inject({ method: 'POST', url: '/api/aliyundrive/test', headers: { authorization: 'Bearer token' } });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ state: 'valid', message: '授权有效', checkedAt: 123 });
  });
});
