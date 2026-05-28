import type { FastifyInstance } from 'fastify';
import { clientsService } from './clients.service.js';
import { authMiddleware } from '../auth/auth.middleware.js';

export async function clientRoutes(app: FastifyInstance): Promise<void> {
  // All client routes require auth
  app.addHook('preHandler', authMiddleware);

  app.get('/api/clients', async (_request, reply) => {
    const clients = clientsService.listClients();
    return reply.send(clients.map((c) => clientsService.toApi(c)));
  });

  app.get<{ Params: { clientId: string } }>('/api/clients/:clientId', async (request, reply) => {
    const client = clientsService.getClient(request.params.clientId);
    if (!client) {
      return reply.code(404).send({ error: 'Client not found' });
    }
    return reply.send(clientsService.toApi(client));
  });
}
