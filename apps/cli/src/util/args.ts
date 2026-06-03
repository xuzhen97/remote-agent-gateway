import { CliError } from '../http/http-error.js';

export function requiredString(value: string | undefined, name: string): string {
  if (!value) throw new CliError('ARGUMENT_ERROR', `${name} is required`);
  return value;
}

export function optionalNumber(value: string | undefined, name: string): number | undefined {
  if (value === undefined) return undefined;
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) throw new CliError('ARGUMENT_ERROR', `${name} must be a number`);
  return parsed;
}

export function requiredNumber(value: string | undefined, name: string): number {
  const parsed = optionalNumber(value, name);
  if (parsed === undefined) throw new CliError('ARGUMENT_ERROR', `${name} is required`);
  return parsed;
}
