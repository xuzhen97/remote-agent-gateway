import { randomUUID } from 'node:crypto';
import type { IncomingMessage } from 'node:http';
import { parseBearerToken } from './auth.js';

export interface TaskAuditRequestContext {
  requestId: string;
  sourceType: 'web-console' | 'agent-api' | 'server-proxy' | 'direct-client-http' | 'unknown';
  actorType: 'admin-token' | 'agent-token' | 'client-token' | 'unknown-token';
  actorLabel: string;
}

export function resolveTaskAuditRequestContext(req: IncomingMessage): TaskAuditRequestContext {
  const sourceHeader = req.headers['x-rag-source'];
  const actorHeader = req.headers['x-rag-actor-type'];
  const sourceType = typeof sourceHeader === 'string'
    ? sourceHeader as TaskAuditRequestContext['sourceType']
    : 'direct-client-http';
  const actorType = typeof actorHeader === 'string'
    ? actorHeader as TaskAuditRequestContext['actorType']
    : (parseBearerToken(req.headers.authorization) ? 'client-token' : 'unknown-token');
  return {
    requestId: randomUUID(),
    sourceType,
    actorType,
    actorLabel: `${sourceType}/${actorType}`,
  };
}
