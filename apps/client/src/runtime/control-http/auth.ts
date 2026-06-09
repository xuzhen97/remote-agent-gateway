/** @file 客户端 HTTP 鉴权
 *
 * 所有数据面 API 请求需要携带 Bearer Token。
 * Token 由服务端协调生成，客户端使用 bootstrap token 启动，
 * 收到 ACK 后切换为正式 token。
 */
import type { IncomingMessage, ServerResponse } from 'node:http';
import { sendError } from './response.js';

/**
 * 从 Authorization 头部解析 Bearer Token
 * @returns token 字符串，或 null（未提供/格式错误）
 */
export function parseBearerToken(authHeader?: string): string | null {
  if (!authHeader) return null;
  const [scheme, token] = authHeader.split(' ');
  if (scheme !== 'Bearer' || !token) return null;
  return token;
}

/**
 * 要求请求携带正确的 Bearer Token
 * @returns 是否通过鉴权
 */
export function requireBearerToken(req: IncomingMessage, res: ServerResponse, token: string): boolean {
  const auth = req.headers.authorization;
  if (!auth) {
    sendError(res, 401, 'UNAUTHORIZED', '缺少鉴权头部');
    return false;
  }
  if (auth !== `Bearer ${token}`) {
    sendError(res, 403, 'FORBIDDEN', 'Token 无效');
    return false;
  }
  return true;
}
