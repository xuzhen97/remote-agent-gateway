import { describe, expect, it } from 'vitest';
import type { ClientUpdateCommandPayload, ClientUpdateStatusPayload, ReleaseManifest } from '@rag/shared';
import { summarizeTargets, transitionCampaignStatus } from './update-state.js';

describe('shared update protocol types compile into server tests', () => {
  it('accepts release and updater payload shapes', () => {
    const manifest: ReleaseManifest = {
      version: 'v1.4.0',
      releaseTime: '2026-06-09T00:00:00Z',
      notes: 'test',
      minUpdaterVersion: '0.1.0',
      channel: 'stable',
      compatibleFrom: ['0.1.0'],
      artifacts: [
        {
          targetType: 'client',
          platform: 'windows',
          arch: 'x64',
          fileName: 'client-windows-x64.zip',
          downloadPath: '/updates/artifacts/v1.4.0/client-windows-x64.zip',
          sha256: 'abc',
          size: 123,
          entrypoint: 'client.exe',
          installerType: 'archive',
          enabled: true,
        },
      ],
    };

    const command: ClientUpdateCommandPayload = {
      campaignId: 'camp_1',
      targetId: 'target_1',
      attemptId: 'att_1',
      version: 'v1.4.0',
      artifact: manifest.artifacts[0],
      downloadUrl: 'http://server/updates/artifacts/v1.4.0/client-windows-x64.zip',
      expectedSha256: 'abc',
      expectedSize: 123,
    };

    const status: ClientUpdateStatusPayload = {
      campaignId: 'camp_1',
      targetId: 'target_1',
      attemptId: 'att_1',
      phase: 'downloading',
      currentVersion: '0.1.0',
      targetVersion: 'v1.4.0',
    };

    expect(command.artifact.fileName).toBe('client-windows-x64.zip');
    expect(status.phase).toBe('downloading');
  });
});

describe('update state', () => {
  it('marks campaigns with errors when failed or offline targets exist', () => {
    const summary = summarizeTargets([
      { phase: 'succeeded' },
      { phase: 'failed' },
      { phase: 'offline_skipped' },
    ] as any);

    expect(summary.succeeded).toBe(1);
    expect(summary.failed).toBe(1);
    expect(summary.offlineSkipped).toBe(1);
    expect(summary.total).toBe(3);
    expect(transitionCampaignStatus(summary)).toBe('completed_with_errors');
  });

  it('marks campaigns as completed when all targets succeed', () => {
    const summary = summarizeTargets([
      { phase: 'succeeded' },
      { phase: 'succeeded' },
    ] as any);

    expect(summary.succeeded).toBe(2);
    expect(summary.failed).toBe(0);
    expect(transitionCampaignStatus(summary)).toBe('completed');
  });
});
