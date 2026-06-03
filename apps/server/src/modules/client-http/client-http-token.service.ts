import { createHmac } from 'node:crypto';

export function deriveClientHttpToken(input: {
  tokenSecret: string;
  tokenVersion: number;
  clientId: string;
}): string {
  return createHmac('sha256', input.tokenSecret)
    .update(`${input.clientId}:${input.tokenVersion}`)
    .digest('base64url');
}
