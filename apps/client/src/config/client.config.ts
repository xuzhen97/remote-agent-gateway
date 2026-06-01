import { z } from 'zod';
import { parse as parseYaml } from 'yaml';
import * as fs from 'node:fs';
import * as path from 'node:path';

const ClientYamlSchema = z.object({
  client: z.object({
    id: z.string().min(1),
    name: z.string().min(1),
    tags: z.array(z.string()).default([]),
  }),
  server: z.object({
    wsUrl: z.string().url(),
    apiBaseUrl: z.string().url(),
    token: z.string().min(1),
  }),
  workspace: z.object({
    dir: z.string().min(1),
    allowedRoots: z.array(z.string()).default([]),
  }),
  frp: z.object({
    binPath: z.string().optional(),
    workDir: z.string().optional(),
  }).default({}),
});

export interface ClientConfig {
  clientId: string;
  clientName: string;
  serverUrl: string;
  apiBaseUrl: string;
  token: string;
  workspaceDir: string;
  allowedRoots: string[];
  frpcPath?: string;
  frpcWorkDir?: string;
  tags: string[];
  source?: { format: 'yaml'; path: string };
}

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

function resolveExecutablePath(configDir: string, configuredPath?: string): string | undefined {
  const relativeInput = configuredPath?.replace(/^[.][/\\]/, '') ?? 'bin/frpc';
  const candidates: string[] = [];

  if (configuredPath) {
    if (path.isAbsolute(configuredPath)) {
      candidates.push(configuredPath);
    } else {
      candidates.push(path.resolve(configDir, configuredPath));
    }
  }

  let current = configDir;
  for (;;) {
    candidates.push(path.resolve(current, relativeInput));
    const parent = path.dirname(current);
    if (parent === current) break;
    current = parent;
  }

  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) return candidate;
    if (process.platform === 'win32' && !candidate.toLowerCase().endsWith('.exe')) {
      const withExe = `${candidate}.exe`;
      if (fs.existsSync(withExe)) return withExe;
    }
  }

  return configuredPath
    ? (path.isAbsolute(configuredPath) ? configuredPath : path.resolve(configDir, configuredPath))
    : undefined;
}

function resolveClientConfigPath(explicitPath?: string, cwd = process.cwd()): string | null {
  const cliPath = parseCliConfigPath('--config');
  const envPath = process.env.RAG_CLIENT_CONFIG;
  const selected = explicitPath ?? cliPath ?? envPath;
  if (selected) return path.resolve(cwd, selected);

  return findUpward('client.config.yaml', cwd);
}

function normalizeYamlConfig(raw: z.infer<typeof ClientYamlSchema>, configPath: string): ClientConfig {
  const configDir = path.dirname(path.resolve(configPath));
  return {
    clientId: raw.client.id,
    clientName: raw.client.name,
    serverUrl: process.env.RAG_CLIENT_WS_URL ?? raw.server.wsUrl,
    apiBaseUrl: process.env.RAG_CLIENT_API_BASE_URL ?? raw.server.apiBaseUrl,
    token: process.env.RAG_CLIENT_TOKEN ?? raw.server.token,
    workspaceDir: raw.workspace.dir,
    allowedRoots: raw.workspace.allowedRoots,
    frpcPath: resolveExecutablePath(configDir, raw.frp.binPath),
    frpcWorkDir: raw.frp.workDir,
    tags: raw.client.tags,
    source: { format: 'yaml', path: configPath },
  };
}

export function loadConfig(explicitPath?: string, options?: { cwd?: string }): ClientConfig {
  const cwd = options?.cwd ?? process.cwd();
  const configPath = resolveClientConfigPath(explicitPath, cwd);

  if (!configPath || !fs.existsSync(configPath)) {
    throw new Error('Client config not found. Create client.config.yaml.');
  }

  const raw = parseYaml(fs.readFileSync(configPath, 'utf-8'));
  return normalizeYamlConfig(ClientYamlSchema.parse(raw), configPath);
}
