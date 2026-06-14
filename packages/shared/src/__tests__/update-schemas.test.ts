import { describe, expect, it } from 'vitest';
import { ClientUpdateStatusPayloadSchema, ReleaseManifestSchema } from '../update-schemas.js';

describe('update schemas', () => {
  it('accepts a complete release manifest', () => {
    const result = ReleaseManifestSchema.safeParse({
      version: '1.0.1',
      releaseTime: '2026-06-14T00:00:00.000Z',
      notes: 'test release',
      minUpdaterVersion: '1.0.0',
      channel: 'stable',
      compatibleFrom: ['1.0.0'],
      artifacts: [{
        targetType: 'client',
        platform: 'windows',
        arch: 'x64',
        fileName: 'rag-client-v1.0.1-windows-x64.zip',
        downloadPath: '/updates/artifacts/1.0.1/rag-client-v1.0.1-windows-x64.zip',
        sha256: 'a'.repeat(64),
        size: 123,
        entrypoint: 'client.bundle.cjs',
        installerType: 'archive',
        enabled: true,
      }],
    });

    expect(result.success).toBe(true);
  });

  it('rejects incomplete manifests', () => {
    const result = ReleaseManifestSchema.safeParse({ version: '1.0.1', artifacts: [] });
    expect(result.success).toBe(false);
  });

  it('accepts client update status payload', () => {
    const result = ClientUpdateStatusPayloadSchema.safeParse({
      campaignId: 'camp_1',
      targetId: 'target_1',
      attemptId: 'attempt_1',
      phase: 'downloading',
      currentVersion: '1.0.0',
      targetVersion: '1.0.1',
    });
    expect(result.success).toBe(true);
  });
});
