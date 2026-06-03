import { CliError, normalizeError } from '../http/http-error.js';

export interface SuccessEnvelope<T> {
  ok: true;
  data: T;
}

export interface ErrorEnvelope {
  ok: false;
  error: {
    code: string;
    message: string;
    status?: number;
  };
}

function redactSecrets(message: string): string {
  return message
    .replace(/token\s+[^\s"']+/gi, 'token [redacted]')
    .replace(/Bearer\s+[^\s"']+/gi, 'Bearer [redacted]')
    .replace(/secret-token/g, '[redacted]');
}

export function successEnvelope<T>(data: T): SuccessEnvelope<T> {
  return { ok: true, data };
}

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

export function writeJson(value: unknown, stream: NodeJS.WritableStream = process.stdout): void {
  stream.write(`${JSON.stringify(value, null, 2)}\n`);
}

export function writeJsonLine(value: unknown, stream: NodeJS.WritableStream = process.stdout): void {
  stream.write(`${JSON.stringify(value)}\n`);
}

export function exitCodeFor(error: unknown): number {
  return error instanceof CliError && error.code === 'ARGUMENT_ERROR' ? 2 : 1;
}
