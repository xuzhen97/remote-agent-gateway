/** @file CLI 参数校验工具
 *
 * 提供 requiredString / optionalNumber / requiredNumber 等
 * 便捷的 CLI 参数校验函数。
 */
import { CliError } from '../http/http-error.js';

/** 要求字符串参数必须存在 */
export function requiredString(value: string | undefined, name: string): string {
  if (!value) throw new CliError('ARGUMENT_ERROR', `${name} 是必填参数`);
  return value;
}

/** 可选的数字参数 */
export function optionalNumber(value: string | undefined, name: string): number | undefined {
  if (value === undefined) return undefined;
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) throw new CliError('ARGUMENT_ERROR', `${name} 必须是数字`);
  return parsed;
}

/** 要求数字参数必须存在 */
export function requiredNumber(value: string | undefined, name: string): number {
  const parsed = optionalNumber(value, name);
  if (parsed === undefined) throw new CliError('ARGUMENT_ERROR', `${name} 是必填参数`);
  return parsed;
}
