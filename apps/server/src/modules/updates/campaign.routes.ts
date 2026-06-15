import type { FastifyInstance } from 'fastify';
import type { CampaignService } from './campaign.service.js';

export interface CampaignExecutorForRoutes {
  start(campaignId: string): Promise<{ phase: string }>;
  dispatchClients(campaignId: string, options?: { waitForOnline?: boolean }): Promise<{ phase: string; dispatched: number }>;
}

export async function campaignRoutes(
  app: FastifyInstance,
  opts: {
    service: CampaignService;
    executor?: CampaignExecutorForRoutes;
  },
): Promise<void> {
  const { service, executor } = opts;

  app.get('/admin/updates/campaigns', async () => ({
    ok: true,
    data: service.listCampaigns(),
  }));

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

  app.get<{ Params: { targetId: string } }>('/admin/updates/targets/:targetId/attempts', async (request) => ({
    ok: true,
    data: service.listAttempts(request.params.targetId),
  }));

  app.post<{ Params: { id: string }; Body: { mode?: string } }>(
    '/admin/updates/campaigns/:id/retry',
    async (request, reply) => {
      try {
        const mode = (request.body.mode ?? 'failed') as 'failed' | 'offline_skipped' | 'all';
        const result = service.retryTargets(request.params.id, mode);

        // 重试后自动触发分发，无需用户再次点击启动
        if (result.length > 0 && executor) {
          setImmediate(async () => {
            try {
              await executor.dispatchClients(request.params.id, { waitForOnline: true });
            } catch (dispatchErr) {
              console.error(`[campaign] retry dispatch failed:`, dispatchErr instanceof Error ? dispatchErr.message : dispatchErr);
            }
          });
        }

        return { ok: true, data: { retried: result.length } };
      } catch (err) {
        return reply.code(400).send({
          ok: false,
          error: { code: 'RETRY_ERROR', message: err instanceof Error ? err.message : String(err) },
        });
      }
    },
  );

  // ==================== 启动编排 ====================
  app.post<{ Params: { id: string } }>(
    '/admin/updates/campaigns/:id/start',
    async (request, reply) => {
      if (!opts.executor) {
        return reply.code(501).send({ ok: false, error: { code: 'NOT_IMPLEMENTED', message: 'Executor not available' } });
      }
      try {
        const result = await opts.executor.start(request.params.id);
        return { ok: true, data: result };
      } catch (err) {
        return reply.code(400).send({
          ok: false,
          error: { code: 'START_ERROR', message: err instanceof Error ? err.message : String(err) },
        });
      }
    },
  );
}
