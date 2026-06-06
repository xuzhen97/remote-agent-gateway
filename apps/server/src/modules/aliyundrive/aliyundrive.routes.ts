import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { authMiddleware } from '../auth/auth.middleware.js';
import { aliyunDriveAuthService } from './aliyundrive-auth.service.js';
import type { AliyunDriveConfigRecord } from './aliyundrive-types.js';

const ConfigPayloadSchema = z.object({
  clientId: z.string().min(1),
  clientSecret: z.string().optional().nullable(),
  scope: z.string().optional(),
  openapiBase: z
    .string()
    .transform((v) => {
      if (!v) return v;
      return v.startsWith('http://') || v.startsWith('https://') ? v : `https://${v}`;
    })
    .optional(),
  redirectUri: z.string().optional(),
  transferFolder: z.string().min(1).optional(),
  cleanupTtlMs: z.number().int().positive().optional(),
});

const CompletePayloadSchema = z.object({
  state: z.string().min(1),
  code: z.string().min(1),
});

function maskConfig(value: AliyunDriveConfigRecord): Record<string, unknown> {
  const copy: Record<string, unknown> = { ...value };
  delete copy.clientSecret;
  return copy;
}

export async function aliyunDriveRoutes(app: FastifyInstance): Promise<void> {
  app.addHook('preHandler', authMiddleware);

  app.get('/api/aliyundrive/status', async () => aliyunDriveAuthService.getStatus());

  app.put('/api/aliyundrive/config', async (request, reply) => {
    const parsed = ConfigPayloadSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.message });
    return reply.send(maskConfig(aliyunDriveAuthService.saveConfig(parsed.data)));
  });

  app.post('/api/aliyundrive/oauth/start', async (_request, reply) => {
    try {
      return reply.send(await aliyunDriveAuthService.startOAuth());
    } catch (error) {
      return reply.code(400).send({ error: error instanceof Error ? error.message : String(error) });
    }
  });

  app.post('/api/aliyundrive/oauth/complete', async (request, reply) => {
    const parsed = CompletePayloadSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.message });
    try {
      return reply.send(await aliyunDriveAuthService.completeOAuth(parsed.data));
    } catch (error) {
      return reply.code(400).send({ error: error instanceof Error ? error.message : String(error) });
    }
  });

  app.post('/api/aliyundrive/oauth/revoke', async () => {
    aliyunDriveAuthService.revoke();
    return { revoked: true };
  });

  app.post('/api/aliyundrive/test', async () => await aliyunDriveAuthService.testAuthorization());
}
