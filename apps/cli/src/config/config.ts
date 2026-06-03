import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import YAML from 'yaml';

export interface RagCliConfig {
  serverUrl: string;
  token: string;
  commandArgs: string[];
  flags: {
    server?: string;
    token?: string;
    config?: string;
    help?: boolean;
    version?: boolean;
  };
  sources: {
    explicitConfig?: string;
    ragrc?: string;
    dotenv?: string;
    serverConfig?: string;
  };
}

export interface ResolveConfigInput {
  cwd?: string;
  argv?: string[];
  env?: Record<string, string | undefined>;
}

interface ParsedGlobalFlags {
  flags: RagCliConfig['flags'];
  rest: string[];
}

function stripQuotes(value: string): string {
  const trimmed = value.trim();
  if ((trimmed.startsWith('"') && trimmed.endsWith('"')) || (trimmed.startsWith("'") && trimmed.endsWith("'"))) {
    return trimmed.slice(1, -1);
  }
  return trimmed;
}

export function parseKeyValueConfig(content: string): Record<string, string> {
  const result: Record<string, string> = {};
  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const idx = line.indexOf('=');
    if (idx < 0) continue;
    const key = line.slice(0, idx).trim();
    if (!key) continue;
    result[key] = stripQuotes(line.slice(idx + 1));
  }
  return result;
}

function parseGlobalFlags(argv: string[]): ParsedGlobalFlags {
  const flags: RagCliConfig['flags'] = {};
  const rest: string[] = [];

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--server') flags.server = argv[++i];
    else if (arg === '--token') flags.token = argv[++i];
    else if (arg === '--config') flags.config = argv[++i];
    else if (arg === '--help' || arg === '-h') flags.help = true;
    else if (arg === '--version' || arg === '-V') flags.version = true;
    else rest.push(arg);
  }

  return { flags, rest };
}

function findUp(fileName: string, cwd: string, maxDepth = 10): string | undefined {
  let current = resolve(cwd);
  for (let depth = 0; depth < maxDepth; depth += 1) {
    const candidate = join(current, fileName);
    if (existsSync(candidate)) return candidate;
    const parent = dirname(current);
    if (parent === current) break;
    current = parent;
  }
  return undefined;
}

function readKeyValueFile(filePath?: string): Record<string, string> {
  if (!filePath || !existsSync(filePath)) return {};
  return parseKeyValueConfig(readFileSync(filePath, 'utf8'));
}

function readYamlFile(filePath?: string): any {
  if (!filePath || !existsSync(filePath)) return {};
  return YAML.parse(readFileSync(filePath, 'utf8')) ?? {};
}

function serverUrlFromServerConfig(serverConfig: any): string {
  const port = serverConfig?.server?.port;
  if (!port) return '';
  const rawHost = serverConfig?.server?.host;
  const host = rawHost && rawHost !== '0.0.0.0' ? rawHost : 'localhost';
  return `http://${host}:${port}`;
}

function cleanUrl(url: string | undefined): string {
  return String(url ?? '').replace(/\/+$/, '');
}

export function maskToken(token: string): string {
  if (!token) return '(empty)';
  if (token.length <= 12) return `${token.slice(0, 3)}...`;
  return `${token.slice(0, 8)}...${token.slice(-4)}`;
}

export function resolveConfig(input: ResolveConfigInput = {}): RagCliConfig {
  const cwd = input.cwd ?? process.cwd();
  const argv = input.argv ?? process.argv.slice(2);
  const env = input.env ?? process.env;
  const { flags, rest } = parseGlobalFlags(argv);

  const explicitConfig = flags.config ? resolve(cwd, flags.config) : undefined;
  const ragrc = explicitConfig ?? findUp('.ragrc', cwd);
  const dotenv = findUp('.env', cwd);
  const serverConfigPath = findUp('server.config.yaml', cwd);

  const ragrcValues = readKeyValueFile(ragrc);
  const envFileValues = readKeyValueFile(dotenv);
  const serverConfig = readYamlFile(serverConfigPath);

  const serverUrl = cleanUrl(
    flags.server
      ?? env.RAG_SERVER_URL
      ?? ragrcValues.RAG_SERVER_URL
      ?? envFileValues.RAG_SERVER_URL
      ?? serverUrlFromServerConfig(serverConfig),
  );

  const token = String(
    flags.token
      ?? env.RAG_AGENT_TOKEN
      ?? env.RAG_ADMIN_TOKEN
      ?? env.RAG_AGENT_API_TOKEN
      ?? env.AGENT_API_TOKEN
      ?? ragrcValues.RAG_AGENT_TOKEN
      ?? ragrcValues.RAG_ADMIN_TOKEN
      ?? ragrcValues.RAG_AGENT_API_TOKEN
      ?? ragrcValues.AGENT_API_TOKEN
      ?? envFileValues.RAG_AGENT_TOKEN
      ?? envFileValues.RAG_ADMIN_TOKEN
      ?? envFileValues.RAG_AGENT_API_TOKEN
      ?? envFileValues.AGENT_API_TOKEN
      ?? serverConfig?.auth?.agentApiToken
      ?? serverConfig?.auth?.adminToken
      ?? '',
  );

  return {
    serverUrl,
    token,
    commandArgs: rest,
    flags,
    sources: { explicitConfig, ragrc, dotenv, serverConfig: serverConfigPath },
  };
}
