import type { IncomingMessage, ServerResponse } from 'node:http';
import { sendError } from './response.js';

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
