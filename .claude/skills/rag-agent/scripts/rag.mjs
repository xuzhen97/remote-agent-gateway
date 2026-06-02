#!/usr/bin/env node
import { readFileSync, existsSync } from 'node:fs';
import { dirname, resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const VERSION = '0.1.0';
const TERMINAL_STATUSES = new Set(['success', 'failed', 'cancelled']);

function stripQuotes(value) {
  const text = String(value ?? '').trim();
  if ((text.startsWith('"') && text.endsWith('"')) || (text.startsWith("'") && text.endsWith("'"))) {
    return text.slice(1, -1);
  }
  return text;
}

function coerceScalar(value) {
  const v = stripQuotes(value);
  if (v === 'true') return true;
  if (v === 'false') return false;
  if (/^-?\d+$/.test(v)) return Number(v);
  return v;
}

export function parseKeyValueConfig(content) {
  const result = {};
  for (const rawLine of String(content).split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const idx = line.indexOf('=');
    if (idx < 0) continue;
    const key = line.slice(0, idx).trim();
    const value = line.slice(idx + 1).trim();
    if (!key) continue;
    result[key] = stripQuotes(value);
  }
  return result;
}

export function parseYamlLikeConfig(content) {
  const root = {};
  const stack = [{ indent: -1, value: root }];

  for (const rawLine of String(content).split(/\r?\n/)) {
    if (!rawLine.trim() || rawLine.trim().startsWith('#')) continue;
    const indent = rawLine.match(/^\s*/)?.[0].length ?? 0;
    const line = rawLine.trim();
    const idx = line.indexOf(':');
    if (idx < 0) continue;

    const key = line.slice(0, idx).trim();
    const tail = line.slice(idx + 1).trim();
    while (stack.length > 1 && indent <= stack[stack.length - 1].indent) stack.pop();
    const parent = stack[stack.length - 1].value;

    if (tail === '') {
      parent[key] = {};
      stack.push({ indent, value: parent[key] });
    } else {
      parent[key] = coerceScalar(tail);
    }
  }

  return root;
}

function findUp(fileName, cwd, maxDepth = 8) {
  let current = resolve(cwd);
  for (let i = 0; i < maxDepth; i += 1) {
    const candidate = join(current, fileName);
    if (existsSync(candidate)) return candidate;
    const parent = dirname(current);
    if (parent === current) break;
    current = parent;
  }
  return null;
}

function readKeyValueFile(file) {
  if (!file || !existsSync(file)) return {};
  return parseKeyValueConfig(readFileSync(file, 'utf8'));
}

function readYamlFile(file) {
  if (!file || !existsSync(file)) return {};
  return parseYamlLikeConfig(readFileSync(file, 'utf8'));
}

function parseGlobalFlags(argv) {
  const rest = [];
  const flags = {};
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--server') {
      flags.serverUrl = argv[++i];
    } else if (arg === '--token') {
      flags.agentToken = argv[++i];
    } else if (arg === '--config') {
      flags.configPath = argv[++i];
    } else if (arg === '--help' || arg === '-h') {
      flags.help = true;
    } else if (arg === '--version' || arg === '-V') {
      flags.version = true;
    } else {
      rest.push(arg);
    }
  }
  return { flags, rest };
}

function urlFromServerConfig(server) {
  if (!server?.port) return '';
  const host = server.host && server.host !== '0.0.0.0' ? server.host : 'localhost';
  return `http://${host}:${server.port}`;
}

export function resolveConfig({ cwd = process.cwd(), argv = process.argv.slice(2), env = process.env } = {}) {
  const { flags, rest } = parseGlobalFlags(argv);
  const explicitConfig = flags.configPath ? resolve(cwd, flags.configPath) : null;

  const ragrc = explicitConfig ?? findUp('.ragrc', cwd);
  const dotenv = findUp('.env', cwd);
  const clientYaml = findUp('client.config.yaml', cwd);
  const serverYaml = findUp('server.config.yaml', cwd);

  const ragrcValues = readKeyValueFile(ragrc);
  const envValues = readKeyValueFile(dotenv);
  const clientConfig = readYamlFile(clientYaml);
  const serverConfig = readYamlFile(serverYaml);

  const serverFromRealEnvPort = env.SERVER_PORT ? `http://localhost:${env.SERVER_PORT}` : '';
  const serverFromEnvFilePort = envValues.SERVER_PORT ? `http://localhost:${envValues.SERVER_PORT}` : '';
  const serverUrl = flags.serverUrl
    || env.RAG_SERVER_URL
    || serverFromRealEnvPort
    || ragrcValues.RAG_SERVER_URL
    || envValues.RAG_SERVER_URL
    || serverFromEnvFilePort
    || clientConfig.server?.apiBaseUrl
    || urlFromServerConfig(serverConfig.server)
    || '';

  const agentToken = flags.agentToken
    || env.RAG_AGENT_TOKEN
    || env.RAG_AGENT_API_TOKEN
    || env.AGENT_API_TOKEN
    || ragrcValues.RAG_AGENT_TOKEN
    || ragrcValues.RAG_AGENT_API_TOKEN
    || ragrcValues.AGENT_API_TOKEN
    || envValues.RAG_AGENT_TOKEN
    || envValues.RAG_AGENT_API_TOKEN
    || envValues.AGENT_API_TOKEN
    || clientConfig.server?.token
    || serverConfig.auth?.agentApiToken
    || '';

  return {
    serverUrl: String(serverUrl).replace(/\/$/, ''),
    agentToken: String(agentToken),
    commandArgs: rest,
    sources: { ragrc, dotenv, clientYaml, serverYaml, explicitConfig },
    flags,
  };
}

function maskToken(token) {
  if (!token) return '(empty)';
  if (token.length <= 12) return `${token.slice(0, 3)}...`;
  return `${token.slice(0, 8)}...${token.slice(-4)}`;
}

function help() {
  return `rag — Remote Agent Gateway Node CLI v${VERSION}

Usage:
  rag [--server <url>] [--token <token>] <command> [args...]
  node bin/rag [--server <url>] [--token <token>] <command> [args...]

Unified config lookup priority:
  1. --server / --token flags
  2. Env vars: RAG_SERVER_URL, RAG_AGENT_TOKEN, RAG_AGENT_API_TOKEN, AGENT_API_TOKEN
  3. .ragrc in current/parent dirs
  4. .env in current/parent dirs
  5. client.config.yaml: server.apiBaseUrl + server.token
  6. server.config.yaml: server.port + auth.agentApiToken

Recommended Windows PowerShell setup:
  [Environment]::SetEnvironmentVariable("RAG_SERVER_URL", "http://your-server:3000", "User")
  [Environment]::SetEnvironmentVariable("RAG_AGENT_TOKEN", "test_agent_token", "User")

Commands:
  config                                   Show resolved config
  clients                                  List remote clients
  client <clientId>                        Get client details

  exec <clientId> <script>                 Execute inline script
  exec-file <clientId> <file>              Execute script from local file
  task <taskId>                            Get task status
  wait <taskId> [--interval ms] [--timeout ms]

  session <clientId>                       Create/reuse file session
  session-close <clientId>                 Close file session
  ls <clientId> [path] [rootId]            List remote files
  read <clientId> <path> [rootId]          Read remote file
  write <clientId> <path> [content]        Write file, or read content from stdin
  mkdir <clientId> <path> [rootId]         Create directory
  rm <clientId> <path> [rootId]            Delete recursively
  mv <clientId> <from> <to> [rootId]       Move/rename
  cp <clientId> <from> <to> [rootId]       Copy

  open-port <clientId> <name> <localPort> [remotePort] [tcp|http|https]
  close-port <mappingId>
  push <clientId> <fileId> <targetPath>

Examples:
  rag clients
  rag exec dev-client-01 "console.log(process.platform)"
  rag wait task_abc
  rag read dev-client-01 README.md
  echo "hello" | rag write dev-client-01 notes/hello.txt
`;
}

function requireArgs(args, count, usage) {
  if (args.length < count) throw new Error(`Usage: ${usage}`);
}

async function readStdinIfAvailable() {
  if (process.stdin.isTTY) return null;
  const chunks = [];
  for await (const chunk of process.stdin) chunks.push(chunk);
  return Buffer.concat(chunks);
}

class RagClient {
  constructor(config) {
    if (!config.serverUrl) throw new Error('RAG server URL is missing. Set RAG_SERVER_URL or create .ragrc/client.config.yaml/server.config.yaml.');
    if (!config.agentToken) throw new Error('RAG agent token is missing. Set RAG_AGENT_TOKEN or use client.config.yaml/server.config.yaml.');
    this.serverUrl = config.serverUrl;
    this.agentToken = config.agentToken;
  }

  async api(method, path, body) {
    const res = await fetch(`${this.serverUrl}${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${this.agentToken}`,
        ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    return readResponse(res);
  }

  async fileApi(session, method, path, options = {}) {
    const res = await fetch(`${session.publicUrl}/v1${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${session.token}`,
        ...(options.contentType ? { 'Content-Type': options.contentType } : {}),
      },
      body: options.body,
    });
    return readResponse(res, options.raw ?? false);
  }

  clients() { return this.api('GET', '/api/agent/clients'); }
  client(id) { return this.api('GET', `/api/agent/clients/${encodeURIComponent(id)}`); }
  session(clientId) { return this.api('POST', '/api/agent/file-session', { clientId }); }
  closeSession(clientId) { return this.api('DELETE', '/api/agent/file-session', { clientId }); }
  runScript(clientId, script, timeoutMs = 60_000) {
    return this.api('POST', '/api/agent/run-script', { target: { clientId }, script, timeoutMs });
  }
  openPort(clientId, name, localPort, remotePort, type = 'tcp') {
    const body = { clientId, name, localPort: Number(localPort), type };
    if (remotePort) body.remotePort = Number(remotePort);
    return this.api('POST', '/api/agent/open-port', body);
  }
  closePort(mappingId) { return this.api('POST', '/api/agent/close-port', { mappingId }); }
  pushFile(clientId, fileId, targetPath) { return this.api('POST', '/api/agent/push-file', { clientId, fileId, targetPath }); }
  task(taskId) { return this.api('GET', `/api/agent/tasks/${encodeURIComponent(taskId)}`); }
}

async function readResponse(res, raw = false) {
  const text = await res.text();
  if (!res.ok) {
    let message = text;
    try { message = JSON.parse(text).error ?? text; } catch {}
    throw new Error(`HTTP ${res.status}: ${message}`);
  }
  if (raw) return text;
  try { return JSON.parse(text); } catch { return text; }
}

function qs(params) {
  const u = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) u.set(k, String(v));
  return u.toString();
}

async function withSession(client, clientId, fn) {
  const session = await client.session(clientId);
  try {
    return await fn(session);
  } finally {
    await client.closeSession(clientId).catch(() => undefined);
  }
}

function print(value, { raw = false } = {}) {
  if (raw) {
    process.stdout.write(String(value));
    if (!String(value).endsWith('\n')) process.stdout.write('\n');
    return;
  }
  if (typeof value === 'string') {
    process.stdout.write(value);
    if (!value.endsWith('\n')) process.stdout.write('\n');
  } else {
    process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);
  }
}

function parseWaitOptions(args) {
  const options = { intervalMs: 2_000, timeoutMs: 120_000 };
  const rest = [];
  for (let i = 0; i < args.length; i += 1) {
    if (args[i] === '--interval') options.intervalMs = Number(args[++i]);
    else if (args[i] === '--timeout') options.timeoutMs = Number(args[++i]);
    else rest.push(args[i]);
  }
  return { options, rest };
}

export async function runCli({ argv = process.argv.slice(2), env = process.env, cwd = process.cwd() } = {}) {
  const config = resolveConfig({ cwd, argv, env });
  if (config.flags.version) return `rag v${VERSION}\n`;
  if (config.flags.help || config.commandArgs.length === 0 || config.commandArgs[0] === 'help') return help();

  const [command, ...args] = config.commandArgs;
  if (command === 'config') {
    return {
      serverUrl: config.serverUrl || null,
      agentToken: maskToken(config.agentToken),
      sources: config.sources,
    };
  }

  const client = new RagClient(config);

  switch (command) {
    case 'clients':
    case 'list':
      return client.clients();
    case 'client':
      requireArgs(args, 1, 'rag client <clientId>');
      return client.client(args[0]);
    case 'session':
      requireArgs(args, 1, 'rag session <clientId>');
      return client.session(args[0]);
    case 'session-close':
      requireArgs(args, 1, 'rag session-close <clientId>');
      return client.closeSession(args[0]);
    case 'exec':
      requireArgs(args, 2, 'rag exec <clientId> <script>');
      return client.runScript(args[0], args.slice(1).join(' '));
    case 'exec-file': {
      requireArgs(args, 2, 'rag exec-file <clientId> <file>');
      return client.runScript(args[0], readFileSync(resolve(cwd, args[1]), 'utf8'));
    }
    case 'open-port': {
      requireArgs(args, 3, 'rag open-port <clientId> <name> <localPort> [remotePort] [type]');
      const [clientId, name, localPort, maybeRemoteOrType, maybeType] = args;
      const isTypeOnly = ['tcp', 'http', 'https'].includes(maybeRemoteOrType);
      return client.openPort(clientId, name, localPort, isTypeOnly ? undefined : maybeRemoteOrType, maybeType || (isTypeOnly ? maybeRemoteOrType : 'tcp'));
    }
    case 'close-port':
      requireArgs(args, 1, 'rag close-port <mappingId>');
      return client.closePort(args[0]);
    case 'push':
      requireArgs(args, 3, 'rag push <clientId> <fileId> <targetPath>');
      return client.pushFile(args[0], args[1], args[2]);
    case 'task':
      requireArgs(args, 1, 'rag task <taskId>');
      return client.task(args[0]);
    case 'wait': {
      const { options, rest } = parseWaitOptions(args);
      requireArgs(rest, 1, 'rag wait <taskId> [--interval ms] [--timeout ms]');
      const startedAt = Date.now();
      while (true) {
        const task = await client.task(rest[0]);
        if (TERMINAL_STATUSES.has(task.status)) return task;
        if (Date.now() - startedAt > options.timeoutMs) throw new Error(`Timed out waiting for task ${rest[0]} (last status: ${task.status})`);
        await new Promise((resolveSleep) => setTimeout(resolveSleep, options.intervalMs));
      }
    }
    case 'ls': {
      requireArgs(args, 1, 'rag ls <clientId> [path] [rootId]');
      const [clientId, path = '.', rootId = 'root-0'] = args;
      return withSession(client, clientId, (session) => client.fileApi(session, 'GET', `/list?${qs({ rootId, path })}`));
    }
    case 'read': {
      requireArgs(args, 2, 'rag read <clientId> <path> [rootId]');
      const [clientId, path, rootId = 'root-0'] = args;
      return withSession(client, clientId, (session) => client.fileApi(session, 'GET', `/read?${qs({ rootId, path })}`, { raw: true }));
    }
    case 'write': {
      requireArgs(args, 2, 'rag write <clientId> <path> [content] [rootId]');
      const [clientId, path, ...rest] = args;
      let content;
      let rootId;
      const last = rest[rest.length - 1];
      if (rest.length === 0 || (rest.length === 1 && last?.startsWith('root-'))) {
        const stdinContent = await readStdinIfAvailable();
        content = stdinContent;
        rootId = rest[0] || 'root-0';
      } else if (last && last.startsWith('root-')) {
        rootId = last;
        content = rest.slice(0, -1).join(' ');
      } else {
        rootId = 'root-0';
        content = rest.join(' ');
      }
      if (!content || (typeof content === 'string' && !content.trim())) throw new Error('write requires content argument or stdin');
      return withSession(client, clientId, (session) => client.fileApi(session, 'PUT', `/write?${qs({ rootId, path })}`, { body: Buffer.isBuffer(content) ? content : String(content), contentType: 'application/octet-stream' }));
    }
    case 'mkdir': {
      requireArgs(args, 2, 'rag mkdir <clientId> <path> [rootId]');
      const [clientId, path, rootId = 'root-0'] = args;
      return withSession(client, clientId, (session) => client.fileApi(session, 'POST', '/mkdir', { body: JSON.stringify({ rootId, path, recursive: true }), contentType: 'application/json' }));
    }
    case 'rm': {
      requireArgs(args, 2, 'rag rm <clientId> <path> [rootId]');
      const [clientId, path, rootId = 'root-0'] = args;
      return withSession(client, clientId, (session) => client.fileApi(session, 'DELETE', `/delete?${qs({ rootId, path, recursive: true })}`));
    }
    case 'mv': {
      requireArgs(args, 3, 'rag mv <clientId> <from> <to> [rootId]');
      const [clientId, from, to, rootId = 'root-0'] = args;
      return withSession(client, clientId, (session) => client.fileApi(session, 'POST', '/move', { body: JSON.stringify({ rootId, from, to, overwrite: true }), contentType: 'application/json' }));
    }
    case 'cp': {
      requireArgs(args, 3, 'rag cp <clientId> <from> <to> [rootId]');
      const [clientId, from, to, rootId = 'root-0'] = args;
      return withSession(client, clientId, (session) => client.fileApi(session, 'POST', '/copy', { body: JSON.stringify({ rootId, from, to, overwrite: true }), contentType: 'application/json' }));
    }
    default:
      throw new Error(`Unknown command: ${command}\n\n${help()}`);
  }
}

const isMain = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  runCli()
    .then((result) => print(result, { raw: typeof result === 'string' && !result.trim().startsWith('{') && !result.includes('rag —') }))
    .catch((error) => {
      console.error(`[rag] ${error.message}`);
      process.exitCode = 1;
    });
}
