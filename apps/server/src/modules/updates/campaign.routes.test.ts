import Fastify from 'fastify';
import { describe, it, expect, vi } from 'vitest';
import { campaignRoutes } from './campaign.routes.js';

describe('campaign routes', () => {
  it('creates and retries campaigns', async () => {
    const app = Fastify();
    await app.register(campaignRoutes, {
      service: {
        createCampaign: vi.fn().mockReturnValue({ campaignId: 'camp_1' }),
        retryTargets: vi.fn().mockReturnValue([{ id: 'target_1' }]),
        getCampaign: vi.fn().mockReturnValue({ id: 'camp_1' }),
        listCampaigns: vi.fn().mockReturnValue([{ id: 'camp_1' }]),
        listTargets: vi.fn().mockReturnValue([]),
        listAttempts: vi.fn().mockReturnValue([{ id: 'attempt_1' }]),
      },
    } as any);

    const create = await app.inject({
      method: 'POST',
      url: '/admin/updates/campaigns',
      payload: {
        targetVersion: 'v1.4.0',
        includeServer: true,
        batchSize: 10,
        maxConcurrency: 5,
        scope: { all: true },
        createdBy: 'admin',
      },
    });
    expect(create.statusCode).toBe(200);
    expect(create.json().data).toEqual({ campaignId: 'camp_1' });

    const list = await app.inject({ method: 'GET', url: '/admin/updates/campaigns' });
    expect(list.statusCode).toBe(200);
    expect(list.json().data).toEqual([{ id: 'camp_1' }]);

    const attempts = await app.inject({ method: 'GET', url: '/admin/updates/targets/target_1/attempts' });
    expect(attempts.statusCode).toBe(200);
    expect(attempts.json().data).toEqual([{ id: 'attempt_1' }]);
  });
});
