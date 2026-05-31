import { describe, expect, it, vi } from 'vitest';
import Fastify from 'fastify';
import { clientFilesRoutes } from './client-files.routes.js';

vi.mock('../auth/auth.middleware.js', () => ({
  authMiddleware: async (request: unknown) => {
    (request as { authRole?: string }).authRole = 'agent';
  },
}));

vi.mock('./client-file-sessions.service.js', () => ({
  clientFileSessionsService: {
    startSession: vi.fn().mockResolvedValue({
      clientId: 'client-1',
      token: 'file_token',
      publicUrl: 'http://127.0.0.1:23001',
      mappingId: 'pm_file',
      localPort: 45123,
      startedAt: 1000,
      expiresAt: Date.now() + 600000,
    }),
    getSession: vi.fn(),
    stopSession: vi.fn(),
  },
}));

const { uploadMock } = vi.hoisted(() => ({
  uploadMock: vi.fn().mockResolvedValue({ path: 'notes/a.txt', size: 11 }),
}));

vi.mock('./client-file-proxy.service.js', () => ({
  clientFileProxyService: {
    list: vi.fn().mockResolvedValue({ path: '.', entries: [{ name: 'a.txt', path: 'a.txt', type: 'file', size: 3, mtimeMs: 1000 }] }),
    upload: uploadMock,
  },
}));

describe('client file routes', () => {
  it('lists client files through the proxy', async () => {
    const app = Fastify();
    await app.register(clientFilesRoutes);

    const response = await app.inject({ method: 'GET', url: '/api/clients/client-1/files?path=.' });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      path: '.',
      entries: [{ name: 'a.txt', path: 'a.txt', type: 'file', size: 3, mtimeMs: 1000 }],
    });
  });

  it('uploads a browser file body to the selected client path', async () => {
    const app = Fastify();
    await app.register(clientFilesRoutes);

    const response = await app.inject({
      method: 'POST',
      url: '/api/clients/client-1/files/upload?path=notes&filename=a.txt',
      headers: { 'content-type': 'application/octet-stream' },
      payload: Buffer.from('hello upload'),
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ path: 'notes/a.txt', size: 11 });
    expect(uploadMock).toHaveBeenCalledWith(expect.any(Object), 'notes', 'a.txt', Buffer.from('hello upload'));
  });
});
