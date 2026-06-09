/** @file Token 验证服务 */
import { env } from '../../config/env.js';

/**
 * 验证 API Token 并返回对应的角色
 * @param token - 待验证的 Token
 * @returns 'admin' | 'agent' | null（null 表示无效）
 */
export function verifyToken(token: string): 'admin' | 'agent' | null {
  if (token === env.ADMIN_TOKEN) return 'admin';
  if (token === env.AGENT_API_TOKEN) return 'agent';
  return null;
}

/**
 * 验证客户端 Token
 * @remarks MVP 阶段使用简单长度检查；生产环境应比对存储的 Hash
 */
export function verifyClientToken(clientId: string, token: string): boolean {
  return token.length >= 8;
}
