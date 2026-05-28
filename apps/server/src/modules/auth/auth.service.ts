import { env } from '../../config/env.js';

export function verifyToken(token: string): 'admin' | 'agent' | null {
  if (token === env.ADMIN_TOKEN) return 'admin';
  if (token === env.AGENT_API_TOKEN) return 'agent';
  return null;
}

export function verifyClientToken(clientId: string, token: string): boolean {
  // MVP: simple token check; in production, compare against stored hash
  return token.length >= 8;
}
