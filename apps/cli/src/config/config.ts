export interface RagCliConfig {
  serverUrl: string;
  token: string;
  commandArgs: string[];
  flags: {
    server?: string;
    token?: string;
    help?: boolean;
    version?: boolean;
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
    else if (arg === '--help' || arg === '-h') flags.help = true;
    else if (arg === '--version' || arg === '-V') flags.version = true;
    else rest.push(arg);
  }

  return { flags, rest };
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
  const argv = input.argv ?? process.argv.slice(2);
  const env = input.env ?? process.env;
  const { flags, rest } = parseGlobalFlags(argv);

  const serverUrl = cleanUrl(
    flags.server
      ?? env.RAG_SERVER_URL
      ?? '',
  );

  const token = String(
    flags.token
      ?? env.RAG_AGENT_TOKEN
      ?? env.RAG_ADMIN_TOKEN
      ?? env.RAG_AGENT_API_TOKEN
      ?? env.AGENT_API_TOKEN
      ?? '',
  );

  return {
    serverUrl,
    token,
    commandArgs: rest,
    flags,
  };
}
