/** @file 服务端 API 鉴权中间件
 *
 * 验证所有 API 请求的 Bearer Token，区分 admin 和 agent 角色。
 * 未通过鉴权的请求返回 401 或 403。
 */
import type { FastifyRequest, FastifyReply } from 'fastify';
import { verifyToken } from './auth.service.js';

/**
 * Fastify 鉴权中间件
 * 从 Authorization 头部提取 Bearer Token 并进行验证。
 */
export async function authMiddleware(
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<void> {
  // 检查是否有 Authorization 头部
  const authHeader = request.headers.authorization;
  if (!authHeader) {
    reply.code(401).send({ error: '缺少 Authorization 头部' });
    return;
  }

  // 解析 Bearer Token
  const [scheme, token] = authHeader.split(' ');
  if (scheme !== 'Bearer' || !token) {
    reply.code(401).send({ error: '鉴权格式错误，请使用: Bearer <token>' });
    return;
  }

  // 验证 Token 有效性
  const role = verifyToken(token);
  if (!role) {
    reply.code(403).send({ error: 'Token 无效' });
    return;
  }

  // 将角色信息附加到请求对象，供后续路由使用
  (request as unknown as { authRole: string }).authRole = role;
}
