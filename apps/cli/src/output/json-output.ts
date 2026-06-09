/** @file CLI 输出格式
 *
 * 统一响应格式：
 * - 成功：{ ok: true, data: ... }
 * - 失败：{ ok: false, error: { code, message, status? } }
 *
 * 敏感信息（Token、Bearer）在错误消息中自动脱敏。
 */
import { CliError, normalizeError } from '../http/http-error.js';

/** 成功响应信封 */
export interface SuccessEnvelope<T> {
  ok: true;
  data: T;
}

/** 错误响应信封 */
export interface ErrorEnvelope {
  ok: false;
  error: {
    code: string;
    message: string;
    status?: number;
  };
}

/**
 * 对错误消息中的敏感信息进行脱敏
 * 替换 token、Bearer 等敏感字符串
 */
function redactSecrets(message: string): string {
  return message
    .replace(/token\s+[^\s"']+/gi, 'token [已脱敏]')
    .replace(/Bearer\s+[^\s"']+/gi, 'Bearer [已脱敏]')
    .replace(/secret-token/g, '[已脱敏]');
}

/** 创建成功响应 */
export function successEnvelope<T>(data: T): SuccessEnvelope<T> {
  return { ok: true, data };
}

/** 创建错误响应（自动脱敏） */
export function errorEnvelope(error: unknown): ErrorEnvelope {
  const normalized = normalizeError(error);
  return {
    ok: false,
    error: {
      code: normalized.code,
      message: redactSecrets(normalized.message),
      ...(normalized.status === undefined ? {} : { status: normalized.status }),
    },
  };
}

/** 写入 JSON 输出（带缩进） */
export function writeJson(value: unknown, stream: NodeJS.WritableStream = process.stdout): void {
  stream.write(`${JSON.stringify(value, null, 2)}\n`);
}

/** 写入 JSON Lines 输出（无缩进，每行一条 JSON） */
export function writeJsonLine(value: unknown, stream: NodeJS.WritableStream = process.stdout): void {
  stream.write(`${JSON.stringify(value)}\n`);
}

/**
 * 根据错误类型返回退出码
 * - ARGUMENT_ERROR → 2（参数错误）
 * - 其他错误 → 1（通用错误）
 */
export function exitCodeFor(error: unknown): number {
  return error instanceof CliError && error.code === 'ARGUMENT_ERROR' ? 2 : 1;
}
