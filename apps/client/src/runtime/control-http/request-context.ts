/** @file 任务审计请求上下文解析
 *
 * 从 HTTP 请求头部中提取请求来源、操作者身份等信息，
 * 用于审计记录中的 sourceType / actorType / actorLabel 字段。
 *
 * 自定义头部：
 * - x-rag-source: 请求来源（web-console / agent-api / server-proxy / direct-client-http）
 * - x-rag-actor-type: 操作者 Token 类型（admin-token / agent-token / client-token）
 */
import { randomUUID } from 'node:crypto';
import type { IncomingMessage } from 'node:http';
import { parseBearerToken } from './auth.js';

/** 任务审计请求上下文 */
export interface TaskAuditRequestContext {
  /** 请求唯一 ID */
  requestId: string;
  /** 请求来源类型 */
  sourceType: 'web-console' | 'agent-api' | 'server-proxy' | 'direct-client-http' | 'unknown';
  /** 操作者 Token 类型 */
  actorType: 'admin-token' | 'agent-token' | 'client-token' | 'unknown-token';
  /** 操作者标识标签 */
  actorLabel: string;
}

/**
 * 从 HTTP 请求中解析任务审计上下文
 * 优先从 x-rag-source 和 x-rag-actor-type 头部获取，
 * 否则根据请求特征推断。
 */
export function resolveTaskAuditRequestContext(req: IncomingMessage): TaskAuditRequestContext {
  // 从自定义头部获取来源和操作者类型
  const sourceHeader = req.headers['x-rag-source'];
  const actorHeader = req.headers['x-rag-actor-type'];
  const sourceType = typeof sourceHeader === 'string'
    ? sourceHeader as TaskAuditRequestContext['sourceType']
    : 'direct-client-http';
  const actorType = typeof actorHeader === 'string'
    ? actorHeader as TaskAuditRequestContext['actorType']
    : (parseBearerToken(req.headers.authorization) ? 'client-token' : 'unknown-token');
  return {
    requestId: randomUUID(),          // 生成唯一请求 ID
    sourceType,
    actorType,
    actorLabel: `${sourceType}/${actorType}`,
  };
}
