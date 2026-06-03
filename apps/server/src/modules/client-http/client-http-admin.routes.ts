import type { FastifyInstance } from 'fastify';
import { authMiddleware } from '../auth/auth.middleware.js';
import { auditService } from '../audit/audit.service.js';
import { clientHttpAdminService } from './client-http-admin.service.js';

export async function clientHttpAdminRoutes(app: FastifyInstance): Promise<void> {
  app.addHook('preHandler', authMiddleware);

  app.get<{ Params: { clientId: string } }>('/api/clients/:clientId/http/health', async (request, reply) => {
    const result = await clientHttpAdminService.request(request.params.clientId, { method: 'GET', path: '/health' });
    return reply.code(result.status).send(result.body);
  });

  app.get<{ Params: { clientId: string } }>('/api/clients/:clientId/http/frp/mappings', async (request, reply) => {
    const result = await clientHttpAdminService.request(request.params.clientId, { method: 'GET', path: '/frp/mappings' });
    return reply.code(result.status).send(result.body);
  });

  app.post<{ Params: { clientId: string }; Body: unknown }>('/api/clients/:clientId/http/frp/mappings', async (request, reply) => {
    const result = await clientHttpAdminService.request(request.params.clientId, { method: 'POST', path: '/frp/mappings', body: request.body });
    auditService.log({ actor: (request as unknown as { authRole: string }).authRole, action: 'client_http.frp_mapping.create', targetType: 'client', targetId: request.params.clientId });
    return reply.code(result.status).send(result.body);
  });

  app.delete<{ Params: { clientId: string; mappingId: string } }>('/api/clients/:clientId/http/frp/mappings/:mappingId', async (request, reply) => {
    const result = await clientHttpAdminService.request(request.params.clientId, { method: 'DELETE', path: `/frp/mappings/${encodeURIComponent(request.params.mappingId)}` });
    auditService.log({ actor: (request as unknown as { authRole: string }).authRole, action: 'client_http.frp_mapping.delete', targetType: 'port_mapping', targetId: request.params.mappingId });
    return reply.code(result.status).send(result.body);
  });
}
