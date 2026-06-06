import { describe, expect, it, vi } from 'vitest';
import Fastify from 'fastify';
import { transferRoutes } from './transfer.routes.js';

vi.mock('../auth/auth.middleware.js', () => ({
  authMiddleware: async (request: unknown) => { (request as { authRole?: string }).authRole = 'agent'; },
}));

vi.mock('./transfer.service.js', () => ({
  transferService: {
    createUpload: vi.fn(async () => ({ mode: 'frps_chunked' })),
    getTransfer: vi.fn(() => ({ id: 'tr_1', status: 'completed' })),
    listTransfers: vi.fn(() => ([{ id: 'tr_2', status: 'completed' }])),
    listEvents: vi.fn(() => []),
    recordCliProgress: vi.fn(() => ({ id: 'tr_1' })),
    completeCliUpload: vi.fn(async () => ({ id: 'tr_1', status: 'waiting_client_download' })),
    recordClientProgress: vi.fn(() => ({ id: 'tr_1' })),
    completeClientDownload: vi.fn(() => ({ id: 'tr_1', status: 'completed' })),
    failTransfer: vi.fn(() => ({ id: 'tr_1', status: 'failed' })),
    refreshDownloadUrl: vi.fn(async () => ({ downloadUrl: 'https://download.example/signature' })),
  },
}));

describe('transferRoutes', () => {
  it('lists recent transfers', async () => {
    const app = Fastify();
    await app.register(transferRoutes);
    const res = await app.inject({ method: 'GET', url: '/api/transfers?limit=10', headers: { authorization: 'Bearer token' } });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ items: [{ id: 'tr_2', status: 'completed' }] });
  });

  it('creates an upload transfer', async () => {
    const app = Fastify();
    await app.register(transferRoutes);
    const res = await app.inject({
      method: 'POST',
      url: '/api/transfers/uploads',
      headers: { authorization: 'Bearer token' },
      payload: { clientId: 'client-1', rootId: 'workspace', path: '.', filename: 'a.zip', size: 10, transfer: 'auto' },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ mode: 'frps_chunked' });
  });

  it('accepts cli progress', async () => {
    const app = Fastify();
    await app.register(transferRoutes);
    const res = await app.inject({
      method: 'POST',
      url: '/api/transfers/tr_1/cli-progress',
      headers: { authorization: 'Bearer token' },
      payload: { uploadedBytes: 5, totalBytes: 10, currentPart: 1 },
    });
    expect(res.statusCode).toBe(200);
  });

  it('returns a refreshed aliyun download url', async () => {
    const app = Fastify();
    await app.register(transferRoutes);
    const res = await app.inject({
      method: 'POST',
      url: '/api/transfers/tr_1/refresh-download-url',
      headers: { authorization: 'Bearer token' },
      payload: {},
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ downloadUrl: 'https://download.example/signature' });
  });
});
