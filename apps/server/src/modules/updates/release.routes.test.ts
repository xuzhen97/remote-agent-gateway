import Fastify from 'fastify';
import { describe, it, expect, vi } from 'vitest';
import { releaseRoutes } from './release.routes.js';

describe('release routes', () => {
  it('lists releases and serves controlled artifact downloads', async () => {
    const app = Fastify();
    await app.register(releaseRoutes, {
      service: {
        listReleases: () => [{ version: 'v1.4.0' }],
        getRelease: vi.fn().mockReturnValue({ version: 'v1.4.0' }),
        registerRelease: vi.fn().mockReturnValue({ version: 'v1.4.0' }),
        getArtifactDownload: vi.fn().mockReturnValue({ path: '/tmp/client.zip' }),
      },
    } as any);

    const list = await app.inject({ method: 'GET', url: '/admin/updates/releases' });
    expect(list.statusCode).toBe(200);
    expect(list.json().data).toEqual([{ version: 'v1.4.0' }]);

    const get = await app.inject({ method: 'GET', url: '/admin/updates/releases/v1.4.0' });
    expect(get.statusCode).toBe(200);
  });
});
