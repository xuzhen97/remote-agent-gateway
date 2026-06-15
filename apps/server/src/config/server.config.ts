import { z } from 'zod';
import { parse as parseYaml } from 'yaml';
import * as fs from 'node:fs';
import * as path from 'node:path';

const ServerConfigSchema = z.object({
  server: z.object({
    host: z.string().default('0.0.0.0'),
    port: z.coerce.number().int().positive().default(3000),
  }),
  auth: z.object({
    adminToken: z.string().min(1),
    agentApiToken: z.string().min(1),
  }),
  storage: z.object({
    dbPath: z.string().default('./storage/db.sqlite'),
    filesDir: z.string().default('./storage/files'),
  }),
  frp: z.object({
    mode: z.enum(['builtin', 'external', 'remote']).default('remote'),
    connectHost: z.string().default(''),
    publicHost: z.string().default(''),
    port: z.coerce.number().int().default(7000),
    token: z.string().default('change_me_frp_token'),
    dashboard: z.object({
      scheme: z.enum(['http', 'https']).default('http'),
      host: z.string().default(''),
      port: z.coerce.number().int().default(7500),
      user: z.string().default('admin'),
      password: z.string().default('admin'),
    }).default({}),
    binPath: z.string().default('./bin/frps'),
    portRange: z.object({
      start: z.coerce.number().int().default(20000),
      end: z.coerce.number().int().default(25000),
    }),
  }),
  clientHttp: z.object({
    tokenSecret: z.string().min(16).default('change-me-client-http-secret'),
    tokenVersion: z.coerce.number().int().positive().default(1),
    requestTimeoutMs: z.coerce.number().int().positive().default(10_000),
  }).default({}),
  updates: z.object({
    publicBaseUrl: z.string().url().optional(),
  }).default({}),
});

export type ServerConfig = z.infer<typeof ServerConfigSchema> & {
  source: { format: 'yaml'; path: string };
};

function parseCliConfigPath(flagName: string): string | undefined {
  const index = process.argv.indexOf(flagName);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

function findUpward(fileName: string, startDir: string): string | null {
  let current = path.resolve(startDir);
  for (let i = 0; i < 8; i++) {
    const candidate = path.join(current, fileName);
    if (fs.existsSync(candidate)) return candidate;
    const parent = path.dirname(current);
    if (parent === current) break;
    current = parent;
  }
  return null;
}

function resolveServerConfigPath(explicitPath?: string, cwd = process.cwd()): string | null {
  const cliPath = parseCliConfigPath('--config');
  const envPath = process.env.RAG_SERVER_CONFIG;
  const selected = explicitPath ?? cliPath ?? envPath;
  if (selected) return path.resolve(cwd, selected);
  return findUpward('server.config.yaml', cwd);
}

function applyOverrides(config: ServerConfig): ServerConfig {
  const next: ServerConfig = {
    ...config,
    server: { ...config.server },
    auth: { ...config.auth },
    storage: { ...config.storage },
    frp: {
      ...config.frp,
      portRange: { ...config.frp.portRange },
    },
    source: { ...config.source },
  };

  if (process.env.RAG_SERVER_HOST) next.server.host = process.env.RAG_SERVER_HOST;
  if (process.env.RAG_SERVER_PORT) next.server.port = Number(process.env.RAG_SERVER_PORT);
  if (process.env.RAG_ADMIN_TOKEN) next.auth.adminToken = process.env.RAG_ADMIN_TOKEN;
  if (process.env.RAG_AGENT_API_TOKEN) next.auth.agentApiToken = process.env.RAG_AGENT_API_TOKEN;
  if (process.env.RAG_FRP_TOKEN) next.frp.token = process.env.RAG_FRP_TOKEN;
  if (process.env.RAG_UPDATE_PUBLIC_BASE_URL) next.updates.publicBaseUrl = process.env.RAG_UPDATE_PUBLIC_BASE_URL;

  return next;
}

function validateBusinessRules(config: ServerConfig): ServerConfig {
  if (!config.frp.connectHost) {
    throw new Error('frp.connectHost is required');
  }
  return config;
}

export function loadServerConfig(explicitPath?: string, options?: { cwd?: string }): ServerConfig {
  const cwd = options?.cwd ?? process.cwd();
  const configPath = resolveServerConfigPath(explicitPath, cwd);

  if (configPath && fs.existsSync(configPath)) {
    const raw = parseYaml(fs.readFileSync(configPath, 'utf-8'));
    const parsed = ServerConfigSchema.parse(raw);
    return validateBusinessRules(applyOverrides({
      ...parsed,
      source: { format: 'yaml', path: configPath },
    }));
  }

  throw new Error('Server config not found. Create server.config.yaml.');
}
