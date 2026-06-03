import type { IncomingMessage, ServerResponse } from 'node:http';
import { sendError } from './response.js';

export function parseBearerToken(authHeader?: string): string | null {
  if (!authHeader) return null;
  const [scheme, token] = authHeader.split(' ');
  if (scheme !== 'Bearer' || !token) return null;
  return token;
}

export function requireBearerToken(req: IncomingMessage, res: ServerResponse, token: string): boolean {
  const auth = req.headers.authorization;
  if (!auth) {
    sendError(res, 401, 'UNAUTHORIZED', 'Missing authorization header');
    return false;
  }
  if (auth !== `Bearer ${token}`) {
    sendError(res, 403, 'FORBIDDEN', 'Invalid token');
    return false;
  }
  return true;
}
