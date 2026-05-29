import { z } from 'zod';
import { config } from 'dotenv';

config();

const envSchema = z.object({
  // Server
  SERVER_PORT: z.coerce.number().int().positive().default(3000),
  SERVER_HOST: z.string().default('0.0.0.0'),
  ADMIN_TOKEN: z.string().min(1),
  AGENT_API_TOKEN: z.string().min(1),

  // Database
  DB_PATH: z.string().default('./storage/db.sqlite'),
  STORAGE_DIR: z.string().default('./storage/files'),

  // FRP
  FRP_MODE: z.enum(['builtin', 'external', 'remote']).default('remote'),
  FRPS_HOST: z.string().default(''),
  FRPS_PORT: z.coerce.number().int().default(7000),
  FRPS_TOKEN: z.string().default('change_me_frp_token'),
  FRPS_DASHBOARD_PORT: z.coerce.number().int().default(7500),
  FRP_PORT_RANGE_START: z.coerce.number().int().default(20000),
  FRP_PORT_RANGE_END: z.coerce.number().int().default(25000),

  // Binaries (for builtin frps)
  FRPS_BIN_PATH: z.string().default('./bin/frps'),
});

export const env = envSchema.parse(process.env);
export type Env = z.infer<typeof envSchema>;

/**
 * Resolve the frps address that clients should connect to.
 *
 * - builtin/external: frps runs on the same host as the server → SERVER_HOST
 * - remote: frps is on a separate machine → FRPS_HOST
 */
export function resolveFrpsHost(): string {
  if (env.FRP_MODE === 'remote') {
    if (!env.FRPS_HOST) {
      throw new Error('FRPS_HOST is required when FRP_MODE=remote');
    }
    return env.FRPS_HOST;
  }
  // builtin/external: frps on same machine
  // Return SERVER_HOST unless it's 0.0.0.0 (then fall back to localhost for frpc)
  return env.SERVER_HOST === '0.0.0.0' ? '127.0.0.1' : env.SERVER_HOST;
}

/** Human-readable public URL for port mappings */
export function buildFrpPublicUrl(remotePort: number): string {
  const host = env.FRP_MODE === 'remote' ? env.FRPS_HOST : env.SERVER_HOST;
  return `${host}:${remotePort}`;
}
