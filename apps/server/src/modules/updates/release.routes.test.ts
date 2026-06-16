import Fastify from 'fastify';
import { describe, it, expect, vi } from 'vitest';
import { releaseRoutes } from './release.routes.js';
import { ReleaseInUseError } from './update-delete-errors.js';

describe('release routes', () => {
  it('lists releases and serves controlled artifact downloads', async () => {
    const app = Fastify();
    await app.register(releaseRoutes, {
      service: {
        listReleases: () => [{ version: 'v1.4.0' }],
        getRelease: vi.fn().mockReturnValue({ version: 'v1.4.0' }),
        registerRelease: vi.fn().mockReturnValue({ version: 'v1.4.0' }),
        getArtifactDownload: vi.fn().mockReturnValue({ path: '/tmp/client.zip' }),
        getArtifactDir: vi.fn().mockReturnValue('/tmp/artifacts/v1.4.0'),
      },
    } as any);

    const list = await app.inject({ method: 'GET', url: '/admin/updates/releases' });
    expect(list.statusCode).toBe(200);
    expect(list.json().data).toEqual([{ version: 'v1.4.0' }]);

    const get = await app.inject({ method: 'GET', url: '/admin/updates/releases/v1.4.0' });
    expect(get.statusCode).toBe(200);
  });

  it('deletes a release through the admin route', async () => {
    const app = Fastify();
    await app.register(releaseRoutes, {
      service: {
        listReleases: () => [{ version: 'v1.4.0' }],
        getRelease: vi.fn().mockReturnValue({ version: 'v1.4.0' }),
        registerRelease: vi.fn().mockReturnValue({ version: 'v1.4.0' }),
        getArtifactDownload: vi.fn().mockReturnValue({ path: '/tmp/client.zip' }),
        getArtifactDir: vi.fn().mockReturnValue('/tmp/artifacts/v1.4.0'),
        deleteRelease: vi.fn().mockReturnValue({
          version: 'v1.4.0',
          force: false,
          deletedCampaignCount: 0,
          deletedTargetCount: 0,
          deletedAttemptCount: 0,
          deletedArtifactDir: true,
        }),
      },
    } as any);

    const res = await app.inject({ method: 'DELETE', url: '/admin/updates/releases/v1.4.0' });
    expect(res.statusCode).toBe(200);
    expect(res.json().data.deletedArtifactDir).toBe(true);
  });

  it('maps release-in-use conflicts to 409', async () => {
    const app = Fastify();
    await app.register(releaseRoutes, {
      service: {
        listReleases: () => [],
        getRelease: vi.fn(),
        registerRelease: vi.fn(),
        getArtifactDownload: vi.fn(),
        getArtifactDir: vi.fn(),
        deleteRelease: vi.fn().mockImplementation(() => { throw new ReleaseInUseError(1); }),
      },
    } as any);

    const res = await app.inject({ method: 'DELETE', url: '/admin/updates/releases/v1.4.0' });
    expect(res.statusCode).toBe(409);
    expect(res.json().error.code).toBe('RELEASE_IN_USE');
  });
});
