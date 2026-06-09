/** @file CLI 错误类型
 *
 * 自定义错误体系，包含错误码和 HTTP 状态码。
 * 所有错误通过 CliError 抛出，最终由 errorEnvelope 统一格式化输出。
 */

/** 错误码枚举 */
export type CliErrorCode =
  | 'CONFIG_ERROR'           // 配置缺失
  | 'ARGUMENT_ERROR'         // 参数错误
  | 'HTTP_ERROR'             // HTTP 响应错误
  | 'NETWORK_ERROR'          // 网络请求失败
  | 'CLIENT_DISCOVERY_ERROR' // 客户端发现失败
  | 'IO_ERROR'               // 文件 IO 错误
  | 'PARSE_ERROR'            // JSON/SSE 解析错误
  | 'ALIYUN_PLAN_ERROR'      // 阿里云盘上传计划错误
  | 'ALIYUN_UPLOAD_ERROR';   // 阿里云盘上传执行错误

/** CLI 自定义错误 */
export class CliError extends Error {
  constructor(
    /** 错误码 */
    public readonly code: CliErrorCode,
    message: string,
    /** HTTP 状态码（来自上游响应） */
    public readonly status?: number,
  ) {
    super(message);
    this.name = 'CliError';
  }
}

/** 将任意错误归一化为 CliError */
export function normalizeError(error: unknown): CliError {
  if (error instanceof CliError) return error;
  if (error instanceof Error) return new CliError('NETWORK_ERROR', error.message);
  return new CliError('NETWORK_ERROR', String(error));
}
