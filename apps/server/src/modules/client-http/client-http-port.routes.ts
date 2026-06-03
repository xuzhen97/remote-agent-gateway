import type { FastifyInstance } from 'fastify';
import { authMiddleware } from '../auth/auth.middleware.js';
import { frpService } from '../frp/frp.service.js';
import { auditService } from '../audit/audit.service.js';

export async function clientHttpPortRoutes(app: FastifyInstance): Promise<void> {
  app.addHook('preHandler', authMiddleware);

  // Allocate a business port without dispatching a WebSocket task
  app.post<{ Params: { clientId: string }; Body: { name: string; proxyType: string; localIp: string; localPort: number; remotePort?: number; customDomain?: string } }>(
    '/api/client-http/ports/allocate',
    async (request, reply) => {
      const mapping = await frpService.createMapping({
        clientId: request.params.clientId,
        name: request.body.name,
        proxyType: request.body.proxyType,
        localIp: request.body.localIp,
        localPort: request.body.localPort,
        remotePort: request.body.remotePort,
        customDomain: request.body.customDomain,
      });

      auditService.log({
        actor: (request as unknown as { authRole: string }).authRole,
        action: 'client_http.business_port.allocate',
        targetType: 'port_mapping',
        targetId: mapping.id,
      });

      return reply.send(frpService.toApi(mapping));
    },
  );

  // Delete a single mapping record without dispatching a WebSocket task
  app.delete<{ Params: { mappingId: string } }>('/api/client-http/ports/:mappingId', async (request, reply) => {
    const id = request.params.mappingId;
    const mapping = frpService.getMapping(id);
    if (!mapping) return reply.code(404).send({ error: 'Port mapping not found' });

    frpService.deleteMapping(id);

    auditService.log({
      actor: (request as unknown as { authRole: string }).authRole,
      action: 'client_http.business_port.delete',
      targetType: 'port_mapping',
      targetId: id,
    });

    return reply.send({ success: true });
  });
}
