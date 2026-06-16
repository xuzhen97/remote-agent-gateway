import { describe, expect, it, vi } from 'vitest';
import { buildReleaseManifest, deleteCampaign, deleteRelease, type UploadedArtifact } from '../updates.js';

describe('update manifest builder', () => {
  it('builds a complete release manifest from uploaded artifacts', () => {
    const uploaded: UploadedArtifact[] = [
      {
        fileName: 'rag-client-v1.0.1-windows-x64.zip',
        targetType: 'client',
        platform: 'windows',
        arch: 'x64',
        sha256: 'a'.repeat(64),
        size: 123,
        enabled: true,
      },
      {
        fileName: 'rag-server-v1.0.1-linux-x64.tar.gz',
        targetType: 'server',
        platform: 'linux',
        arch: 'x64',
        sha256: 'b'.repeat(64),
        size: 456,
        enabled: true,
      },
    ];

    const manifest = buildReleaseManifest('v1.0.1', uploaded, '2026-06-15T00:00:00.000Z');

    expect(manifest).toEqual({
      version: 'v1.0.1',
      releaseTime: '2026-06-15T00:00:00.000Z',
      notes: 'Remote Agent Gateway v1.0.1',
      minUpdaterVersion: 'v1.0.1',
      channel: 'stable',
      compatibleFrom: ['v1.0.1'],
      artifacts: [
        {
          fileName: 'rag-client-v1.0.1-windows-x64.zip',
          targetType: 'client',
          platform: 'windows',
          arch: 'x64',
          downloadPath: '/updates/artifacts/v1.0.1/rag-client-v1.0.1-windows-x64.zip',
          sha256: 'a'.repeat(64),
          size: 123,
          entrypoint: 'client.bundle.cjs',
          installerType: 'archive',
          enabled: true,
        },
        {
          fileName: 'rag-server-v1.0.1-linux-x64.tar.gz',
          targetType: 'server',
          platform: 'linux',
          arch: 'x64',
          downloadPath: '/updates/artifacts/v1.0.1/rag-server-v1.0.1-linux-x64.tar.gz',
          sha256: 'b'.repeat(64),
          size: 456,
          entrypoint: 'server.bundle.cjs',
          installerType: 'archive',
          enabled: true,
        },
      ],
    });
  });
});

describe('update delete api', () => {
  it('calls deleteRelease with optional force query', async () => {
    const api = { delete: vi.fn().mockResolvedValue({ data: { version: 'v1.4.0' } }) } as any;
    await deleteRelease(api, 'v1.4.0');
    await deleteRelease(api, 'v1.4.0', { force: true });

    expect(api.delete).toHaveBeenNthCalledWith(1, '/admin/updates/releases/v1.4.0');
    expect(api.delete).toHaveBeenNthCalledWith(2, '/admin/updates/releases/v1.4.0?force=true');
  });

  it('calls deleteCampaign with optional force query', async () => {
    const api = { delete: vi.fn().mockResolvedValue({ data: { campaignId: 'camp_1' } }) } as any;
    await deleteCampaign(api, 'camp_1');
    await deleteCampaign(api, 'camp_1', { force: true });

    expect(api.delete).toHaveBeenNthCalledWith(1, '/admin/updates/campaigns/camp_1');
    expect(api.delete).toHaveBeenNthCalledWith(2, '/admin/updates/campaigns/camp_1?force=true');
  });
});
