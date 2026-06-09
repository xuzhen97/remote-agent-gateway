import { describe, it, expect, vi } from 'vitest';
import { createCampaignService } from './campaign.service.js';

describe('campaign service', () => {
  it('creates a campaign only when required artifacts exist', () => {
    const service = createCampaignService({
      releaseService: {
        resolveArtifact: () => ({ fileName: 'ok', sha256: 'abc', size: 10 }),
      },
      clientsService: {
        listClients: () => [
          { id: 'client-1', os: 'win32', arch: 'x64', status: 'online' },
        ],
      },
      repo: {
        saveCampaign: vi.fn(),
        saveTarget: vi.fn(),
        saveAttempt: vi.fn(),
      },
      now: () => 1,
      id: () => 'camp_1',
    } as any);

    const result = service.createCampaign({
      targetVersion: 'v1.4.0',
      includeServer: true,
      batchSize: 10,
      maxConcurrency: 5,
      createdBy: 'admin',
      scope: { all: true },
    });

    expect(result.campaignId).toBe('camp_1');
    expect(result.targets).toHaveLength(2); // server + 1 client
  });

  it('rejects campaign creation when server artifact is missing', () => {
    const service = createCampaignService({
      releaseService: {
        resolveArtifact: vi.fn().mockImplementation(() => { throw new Error('No matching artifact'); }),
      },
      clientsService: {
        listClients: () => [],
      },
      repo: {
        saveCampaign: vi.fn(),
        saveTarget: vi.fn(),
        saveAttempt: vi.fn(),
      },
      now: () => 1,
      id: () => 'camp_1',
    } as any);

    expect(() =>
      service.createCampaign({
        targetVersion: 'v1.4.0',
        includeServer: true,
        batchSize: 10,
        maxConcurrency: 5,
        createdBy: 'admin',
        scope: { all: true },
      }),
    ).toThrow('No matching artifact');
  });
});
