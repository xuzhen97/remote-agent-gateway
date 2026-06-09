import { describe, it, expect } from 'vitest';
import { createReleaseService } from './release.service.js';

describe('release service', () => {
  it('validates manifests and resolves platform-specific artifacts', () => {
    const service = createReleaseService({
      repo: {
        saveRelease: () => undefined,
        getRelease: () => ({
          version: 'v1.4.0',
          manifestJson: JSON.stringify({
            version: 'v1.4.0',
            releaseTime: '2026-06-09T00:00:00Z',
            notes: 'demo',
            minUpdaterVersion: '0.1.0',
            channel: 'stable',
            compatibleFrom: ['0.1.0'],
            artifacts: [
              {
                targetType: 'client', platform: 'windows', arch: 'x64',
                fileName: 'client-win.zip',
                downloadPath: '/updates/artifacts/v1.4.0/client-win.zip',
                sha256: 'abc', size: 10,
                entrypoint: 'client.exe', installerType: 'archive',
                enabled: true,
              },
            ],
          }),
          enabled: true,
        }),
        listReleases: () => [],
      },
      now: () => 1,
    } as any);

    const artifact = service.resolveArtifact('v1.4.0', { targetType: 'client', platform: 'windows', arch: 'x64' });
    expect(artifact.fileName).toBe('client-win.zip');
  });

  it('rejects disabled releases', () => {
    const service = createReleaseService({
      repo: {
        saveRelease: () => undefined,
        getRelease: () => ({ version: 'v1.4.0', manifestJson: '{}', enabled: false }),
        listReleases: () => [],
      },
      now: () => 1,
    } as any);

    expect(() => service.resolveArtifact('v1.4.0', { targetType: 'client', platform: 'windows', arch: 'x64' }))
      .toThrow('disabled');
  });

  it('rejects missing platform artifacts', () => {
    const service = createReleaseService({
      repo: {
        saveRelease: () => undefined,
        getRelease: () => ({
          version: 'v1.4.0',
          manifestJson: JSON.stringify({
            version: 'v1.4.0',
            releaseTime: '2026-06-09T00:00:00Z',
            notes: 'demo',
            minUpdaterVersion: '0.1.0',
            channel: 'stable',
            compatibleFrom: ['0.1.0'],
            artifacts: [
              {
                targetType: 'client', platform: 'linux', arch: 'x64',
                fileName: 'client-linux.tar.gz',
                downloadPath: '/updates/artifacts/v1.4.0/client-linux.tar.gz',
                sha256: 'abc', size: 10,
                entrypoint: 'client.sh', installerType: 'archive',
                enabled: true,
              },
            ],
          }),
          enabled: true,
        }),
        listReleases: () => [],
      },
      now: () => 1,
    } as any);

    expect(() => service.resolveArtifact('v1.4.0', { targetType: 'client', platform: 'windows', arch: 'x64' }))
      .toThrow('No matching artifact');
  });
});
