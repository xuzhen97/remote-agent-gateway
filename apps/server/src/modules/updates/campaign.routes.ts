import type { FastifyInstance } from 'fastify';
import type { CampaignService } from './campaign.service.js';

export async function campaignRoutes(app: FastifyInstance, opts: { service: CampaignService }): Promise<void> {
  const { service } = opts;

  app.post<{ Body: Record<string, unknown> }>('/admin/updates/campaigns', async (request, reply) => {
    try {
      const result = service.createCampaign(request.body as any);
      return { ok: true, data: result };
    } catch (err) {
      return reply.code(400).send({
        ok: false,
        error: { code: 'CAMPAIGN_ERROR', message: err instanceof Error ? err.message : String(err) },
      });
    }
  });

  app.get<{ Params: { id: string } }>('/admin/updates/campaigns/:id', async (request, reply) => {
    const campaign = service.getCampaign(request.params.id);
    if (!campaign) {
      return reply.code(404).send({ ok: false, error: { code: 'NOT_FOUND', message: 'Campaign not found' } });
    }
    return { ok: true, data: campaign };
  });

  app.get<{ Params: { id: string } }>('/admin/updates/campaigns/:id/targets', async (request) => ({
    ok: true,
    data: service.listTargets(request.params.id),
  }));

  app.post<{ Params: { id: string }; Body: { mode?: string } }>(
    '/admin/updates/campaigns/:id/retry',
    async (request, reply) => {
      try {
        const mode = (request.body.mode ?? 'failed') as 'failed' | 'offline_skipped' | 'all';
        const result = service.retryTargets(request.params.id, mode);
        return { ok: true, data: { retried: result.length } };
      } catch (err) {
        return reply.code(400).send({
          ok: false,
          error: { code: 'RETRY_ERROR', message: err instanceof Error ? err.message : String(err) },
        });
      }
    },
  );
}
