/** @file CLI 配置解析
 *
 * 配置来源优先级（高到低）：
 * 1. CLI 全局参数 --server / --token
 * 2. 系统环境变量 RAG_SERVER_URL / RAG_AGENT_TOKEN 等
 *
 * CLI 不读取 .env、.ragrc 或 server.config.yaml。
 */

export interface RagCliConfig {
  /** 服务端基础 URL */
  serverUrl: string;
  /** API Token */
  token: string;
  /** 剩余的命令参数 */
  commandArgs: string[];
  /** 解析后的全局标记 */
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

/** 去除值两端的引号 */
function stripQuotes(value: string): string {
  const trimmed = value.trim();
  if ((trimmed.startsWith('"') && trimmed.endsWith('"')) || (trimmed.startsWith("'") && trimmed.endsWith("'"))) {
    return trimmed.slice(1, -1);
  }
  return trimmed;
}

/** 解析键值对配置文件（如 .env 格式） */
export function parseKeyValueConfig(content: string): Record<string, string> {
  const result: Record<string, string> = {};
  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;  // 跳过空行和注释
    const idx = line.indexOf('=');
    if (idx < 0) continue;
    const key = line.slice(0, idx).trim();
    if (!key) continue;
    result[key] = stripQuotes(line.slice(idx + 1));
  }
  return result;
}

/** 解析全局 CLI 参数 */
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

/** 去除 URL 尾部多余斜杠 */
function cleanUrl(url: string | undefined): string {
  return String(url ?? '').replace(/\/+$/, '');
}

/**
 * 脱敏 Token（仅显示前 8 位和后 4 位）
 * 短 Token（≤12 字符）仅显示前 3 位加省略号
 */
export function maskToken(token: string): string {
  if (!token) return '(空)';
  if (token.length <= 12) return `${token.slice(0, 3)}...`;
  return `${token.slice(0, 8)}...${token.slice(-4)}`;
}

/**
 * 解析完整的 CLI 配置
 * 优先级：CLI 参数 > 环境变量
 */
export function resolveConfig(input: ResolveConfigInput = {}): RagCliConfig {
  const argv = input.argv ?? process.argv.slice(2);
  const env = input.env ?? process.env;
  const { flags, rest } = parseGlobalFlags(argv);

  // 服务端 URL（优先 CLI 参数，其次环境变量）
  const serverUrl = cleanUrl(
    flags.server
      ?? env.RAG_SERVER_URL
      ?? '',
  );

  // Token（按优先级依次尝试多个环境变量）
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
