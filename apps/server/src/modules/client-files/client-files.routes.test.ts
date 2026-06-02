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

const { uploadMock, rootsMock } = vi.hoisted(() => ({
  uploadMock: vi.fn().mockResolvedValue({ path: 'notes/a.txt', size: 11 }),
  rootsMock: vi.fn().mockResolvedValue({
    roots: [{ id: 'root-0', label: 'workspace', path: '/tmp/workspace' }],
  }),
}));

vi.mock('./client-file-proxy.service.js', () => ({
  clientFileProxyService: {
    roots: rootsMock,
    list: vi.fn().mockResolvedValue({ path: '.', entries: [{ name: 'a.txt', path: 'a.txt', type: 'file', size: 3, mtimeMs: 1000 }] }),
    upload: uploadMock,
  },
}));

describe('client file routes', () => {
  it('returns client roots through the proxy', async () => {
    const app = Fastify();
    await app.register(clientFilesRoutes);

    const response = await app.inject({ method: 'GET', url: '/api/clients/client-1/files/roots' });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      roots: [{ id: 'root-0', label: 'workspace', path: '/tmp/workspace' }],
    });
  });

  it('lists client files through the proxy', async () => {
    const app = Fastify();
    await app.register(clientFilesRoutes);

    const response = await app.inject({ method: 'GET', url: '/api/clients/client-1/files?rootId=root-0&path=.' });
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
      url: '/api/clients/client-1/files/upload?rootId=root-0&path=notes&filename=a.txt',
      headers: { 'content-type': 'application/octet-stream' },
      payload: Buffer.from('hello upload'),
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ path: 'notes/a.txt', size: 11 });
    expect(uploadMock).toHaveBeenCalledWith(expect.any(Object), 'root-0', 'notes', 'a.txt', Buffer.from('hello upload'));
  });

  it('returns direct upload URL with session info', async () => {
    const app = Fastify();
    await app.register(clientFilesRoutes);

    const response = await app.inject({
      method: 'POST',
      url: '/api/clients/client-1/files/upload-url?rootId=root-0&path=notes&filename=test.txt',
    });

    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.url).toContain('http://127.0.0.1:23001/v1/upload');
    expect(body.url).toContain('rootId=root-0');
    expect(body.url).toContain('path=notes');
    expect(body.url).toContain('filename=test.txt');
    expect(body.method).toBe('POST');
    expect(body.headers).toEqual({ Authorization: 'Bearer file_token', 'Content-Type': 'application/octet-stream' });
    expect(body.rootId).toBe('root-0');
    expect(body.path).toBe('notes');
    expect(body.filename).toBe('test.txt');
  });

  it('returns 400 when upload-url is called without filename', async () => {
    const app = Fastify();
    await app.register(clientFilesRoutes);

    const response = await app.inject({
      method: 'POST',
      url: '/api/clients/client-1/files/upload-url?rootId=root-0&path=notes',
    });

    expect(response.statusCode).toBe(400);
    expect(response.json()).toEqual({ error: 'filename is required' });
  });

  it('returns direct write URL with session info', async () => {
    const app = Fastify();
    await app.register(clientFilesRoutes);

    const response = await app.inject({
      method: 'POST',
      url: '/api/clients/client-1/files/write-url?rootId=root-0&path=notes/a.txt',
    });

    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.url).toContain('http://127.0.0.1:23001/v1/write');
    expect(body.url).toContain('rootId=root-0');
    expect(body.url).toContain('path=notes');
    expect(body.method).toBe('PUT');
    expect(body.headers).toEqual({ Authorization: 'Bearer file_token', 'Content-Type': 'application/octet-stream' });
    expect(body.rootId).toBe('root-0');
    expect(body.path).toBe('notes/a.txt');
  });

  it('returns 400 when write-url is called without path', async () => {
    const app = Fastify();
    await app.register(clientFilesRoutes);

    const response = await app.inject({
      method: 'POST',
      url: '/api/clients/client-1/files/write-url?rootId=root-0',
    });

    expect(response.statusCode).toBe(400);
    expect(response.json()).toEqual({ error: 'path is required' });
  });
});
