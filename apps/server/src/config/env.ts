import { z } from 'zod';
import { config } from 'dotenv';
import * as fs from 'node:fs';
import * as path from 'node:path';

// Find .env by walking up from CWD or the source file directory.
// Handles monorepo CWD issues (pnpm --filter changes CWD to app dir).
function findEnvFile(): string | null {
  // Try exact file path resolution first (works in bundled dist mode)
  const bundledPath = path.join(process.cwd(), '.env');
  if (fs.existsSync(bundledPath)) return bundledPath;

  // Walk up from CWD (works when CWD is the project root)
  let dir = process.cwd();
  for (let i = 0; i < 8; i++) {
    const envPath = path.join(dir, '.env');
    if (fs.existsSync(envPath)) return envPath;
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }

  // Try walking up from this source file's location
  try {
    const srcDir = path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:\/)/, '$1'));
    let d = srcDir;
    for (let i = 0; i < 8; i++) {
      const envPath = path.join(d, '.env');
      if (fs.existsSync(envPath)) return envPath;
      const p = path.dirname(d);
      if (p === d) break;
      d = p;
    }
  } catch { /* ignore */ }

  return null;
}

const envFile = findEnvFile();
if (envFile) {
  config({ path: envFile });
} else {
  config(); // fallback: try CWD
}

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
