import type { FastifyInstance, FastifyRequest } from 'fastify';
import { authMiddleware } from '../auth/auth.middleware.js';
import { frpService } from '../frp/frp.service.js';
import { auditService } from '../audit/audit.service.js';

interface AllocateBusinessPortBody {
  clientId: string;
  name: string;
  proxyType: string;
  localIp: string;
  localPort: number;
  remotePort?: number;
  customDomain?: string;
}

function authRole(request: FastifyRequest): string {
  return (request as unknown as { authRole: string }).authRole;
}

export async function clientHttpPortRoutes(app: FastifyInstance): Promise<void> {
  app.addHook('preHandler', authMiddleware);

  app.post<{ Body: AllocateBusinessPortBody }>('/api/client-http/ports/allocate', async (request, reply) => {
    const mapping = await frpService.createMapping({
      clientId: request.body.clientId,
      name: request.body.name,
      proxyType: request.body.proxyType,
      localIp: request.body.localIp,
      localPort: request.body.localPort,
      remotePort: request.body.remotePort,
      customDomain: request.body.customDomain,
    });

    auditService.log({
      actor: authRole(request),
      action: 'client_http.business_port.allocate',
      targetType: 'port_mapping',
      targetId: mapping.id,
    });

    return reply.send(frpService.toApi(mapping));
  });

  app.delete<{ Params: { mappingId: string } }>('/api/client-http/ports/:mappingId', async (request, reply) => {
    const { mappingId } = request.params;
    const mapping = frpService.getMapping(mappingId);
    if (!mapping) return reply.code(404).send({ error: 'Port mapping not found' });

    frpService.deleteMapping(mappingId);

    auditService.log({
      actor: authRole(request),
      action: 'client_http.business_port.delete',
      targetType: 'port_mapping',
      targetId: mappingId,
    });

    return reply.send({ success: true });
  });
}
