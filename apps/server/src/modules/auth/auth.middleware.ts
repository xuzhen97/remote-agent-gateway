import type { FastifyRequest, FastifyReply } from 'fastify';
import { verifyToken } from './auth.service.js';

export async function authMiddleware(
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<void> {
  const authHeader = request.headers.authorization;
  if (!authHeader) {
    reply.code(401).send({ error: 'Missing authorization header' });
    return;
  }

  const [scheme, token] = authHeader.split(' ');
  if (scheme !== 'Bearer' || !token) {
    reply.code(401).send({ error: 'Invalid authorization format. Use: Bearer <token>' });
    return;
  }

  const role = verifyToken(token);
  if (!role) {
    reply.code(403).send({ error: 'Invalid token' });
    return;
  }

  // Attach role to request for downstream use
  (request as unknown as { authRole: string }).authRole = role;
}
