export type CliErrorCode =
  | 'CONFIG_ERROR'
  | 'ARGUMENT_ERROR'
  | 'HTTP_ERROR'
  | 'NETWORK_ERROR'
  | 'CLIENT_DISCOVERY_ERROR'
  | 'IO_ERROR'
  | 'PARSE_ERROR'
  | 'ALIYUN_PLAN_ERROR'
  | 'ALIYUN_UPLOAD_ERROR';

export class CliError extends Error {
  constructor(
    public readonly code: CliErrorCode,
    message: string,
    public readonly status?: number,
  ) {
    super(message);
    this.name = 'CliError';
  }
}

export function normalizeError(error: unknown): CliError {
  if (error instanceof CliError) return error;
  if (error instanceof Error) return new CliError('NETWORK_ERROR', error.message);
  return new CliError('NETWORK_ERROR', String(error));
}
