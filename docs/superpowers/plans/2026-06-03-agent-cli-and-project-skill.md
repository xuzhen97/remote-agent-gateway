# Agent-first CLI and Project Skill Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a cross-platform Node/TypeScript AI-agent-first `rag` CLI aligned with the current Remote Agent Gateway API, and add a project-owned `rag-agent` skill with a Pi Agent copy installer.

**Architecture:** Add a new `@rag/cli` workspace app under `apps/cli` using commander for argument parsing, focused HTTP client modules for server discovery and client HTTP operations, and stable JSON output helpers. Keep `bin/rag` and `bin/rag.bat` as thin wrappers to the compiled CLI, move skill source to `skills/rag-agent`, and provide a Node/TypeScript installer that copies the skill to `~/.pi/agent/skills/rag-agent`.

**Tech Stack:** Node.js 22+, TypeScript ESM, commander, Vitest, built-in `fetch`, built-in `fs/path/os` modules, pnpm workspace.

---

## Scope Check

The approved spec includes three related deliverables: CLI, project skill, and skill installer/docs. They are coupled because the skill instructs agents to use the CLI and the installer deploys that skill. This plan keeps them in one implementation plan but breaks work into independently testable tasks:

1. CLI scaffolding, config resolution, and output primitives.
2. HTTP clients and discovery helpers.
3. Read-only command groups and diagnostics.
4. Mutating/client-direct command groups.
5. Project skill and copy installer.
6. Wrappers, docs, cleanup, and full validation.

## File Structure and Responsibilities

### New CLI app

| File | Responsibility |
|---|---|
| `apps/cli/package.json` | Workspace package metadata, scripts, dependencies. |
| `apps/cli/tsconfig.json` | TypeScript config extending root base config. |
| `apps/cli/vitest.config.ts` | Vitest config for the CLI package. |
| `apps/cli/src/index.ts` | CLI entrypoint; builds commander program, registers commands, handles errors. |
| `apps/cli/src/config/config.ts` | Config resolution from flags, env, `.ragrc`, `.env`, `server.config.yaml`; token masking. |
| `apps/cli/src/config/config.test.ts` | TDD coverage for config priority and token masking. |
| `apps/cli/src/http/http-error.ts` | Typed CLI errors and error normalization. |
| `apps/cli/src/http/server-api.ts` | Authenticated server API calls: clients, task history. |
| `apps/cli/src/http/client-http.ts` | Authenticated client HTTP calls after discovery: health, jobs, files, FRP. |
| `apps/cli/src/http/http.test.ts` | Mock-fetch tests for server and client HTTP modules. |
| `apps/cli/src/output/json-output.ts` | Success/error JSON envelopes and raw output helpers. |
| `apps/cli/src/output/json-output.test.ts` | Tests for output envelopes and token-safe errors. |
| `apps/cli/src/commands/clients.ts` | `rag clients list/get`. |
| `apps/cli/src/commands/doctor.ts` | `rag doctor [--client]`. |
| `apps/cli/src/commands/tasks.ts` | `rag tasks list/get`. |
| `apps/cli/src/commands/jobs.ts` | `rag jobs run/script/get/logs/events/cancel`. |
| `apps/cli/src/commands/files.ts` | `rag files roots/list/stat/read/write/upload/download/mkdir/delete/move/copy`. |
| `apps/cli/src/commands/frp.ts` | `rag frp list/create/delete`. |
| `apps/cli/src/commands/commands.test.ts` | Commander command behavior tests with mocked API clients. |
| `apps/cli/src/util/args.ts` | Small shared argument helpers such as required options and command splitting. |

### Project skill and installer

| File | Responsibility |
|---|---|
| `skills/rag-agent/SKILL.md` | Concise skill entrypoint and operating rules. |
| `skills/rag-agent/references/cli.md` | Full CLI command reference and JSON examples. |
| `skills/rag-agent/references/workflows.md` | Common AI Agent workflows. |
| `skills/rag-agent/references/api-map.md` | Mapping from CLI commands to current server/client HTTP APIs. |
| `scripts/install-pi-skill.ts` | Cross-platform Node/TS copy installer for Pi user skills. |
| `scripts/install-pi-skill.test.ts` | Unit tests for installer copy behavior using temp dirs. |

### Existing files to modify

| File | Responsibility |
|---|---|
| `bin/rag` | Replace single-file old CLI with Node wrapper to `apps/cli/dist/index.js`. |
| `bin/rag.bat` | Replace batch wrapper to load `apps\cli\dist\index.js`. |
| `package.json` | Add `dev:cli`, `build:cli`, `install:pi-skill`; add root dev deps if needed. |
| `pnpm-workspace.yaml` | Already includes `apps/*`; verify no change needed unless formatting is required. |
| `README.md` | Document new CLI and project skill; remove stale old `/api/agent/*` CLI guidance if present. |
| `docs/TESTING.md` or `docs/cli.md` | Add CLI validation commands and usage. |
| `.claude/skills/rag-agent/` | Remove stale skill source after project skill exists. |

---

## Task 1: Scaffold `@rag/cli`, JSON output, and config resolution

**Files:**
- Create: `apps/cli/package.json`
- Create: `apps/cli/tsconfig.json`
- Create: `apps/cli/vitest.config.ts`
- Create: `apps/cli/src/config/config.ts`
- Create: `apps/cli/src/config/config.test.ts`
- Create: `apps/cli/src/output/json-output.ts`
- Create: `apps/cli/src/output/json-output.test.ts`
- Create: `apps/cli/src/http/http-error.ts`
- Modify: `pnpm-lock.yaml` after installing dependencies

- [ ] **Step 1: Add the CLI package manifest**

Create `apps/cli/package.json` with this complete content:

```json
{
  "name": "@rag/cli",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "main": "./dist/index.js",
  "bin": {
    "rag": "./dist/index.js"
  },
  "scripts": {
    "dev": "tsx src/index.ts",
    "build": "tsc",
    "start": "node dist/index.js",
    "typecheck": "tsc --noEmit",
    "test": "vitest run"
  },
  "dependencies": {
    "commander": "^12.1.0",
    "yaml": "^2.8.1"
  },
  "devDependencies": {
    "typescript": "^5.7.0",
    "tsx": "^4.19.0",
    "vitest": "^3.0.0"
  }
}
```

- [ ] **Step 2: Add TypeScript and Vitest config**

Create `apps/cli/tsconfig.json`:

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "rootDir": "src",
    "outDir": "dist"
  },
  "include": ["src/**/*.ts"]
}
```

Create `apps/cli/vitest.config.ts`:

```ts
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
  },
});
```

- [ ] **Step 3: Install CLI dependencies and update lockfile**

Run:

```bash
cd D:/remote-agent-gateway && pnpm install
```

Expected: command exits 0 and `pnpm-lock.yaml` includes `@rag/cli`, `commander`, and `yaml` entries.

- [ ] **Step 4: Write failing config tests**

Create `apps/cli/src/config/config.test.ts`:

```ts
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { maskToken, parseKeyValueConfig, resolveConfig } from './config.js';

function tempDir(): string {
  return mkdtempSync(join(tmpdir(), 'rag-cli-config-'));
}

describe('parseKeyValueConfig', () => {
  it('parses env-style key value files and strips quotes', () => {
    expect(parseKeyValueConfig('RAG_SERVER_URL="http://localhost:3000"\nRAG_AGENT_TOKEN=abc\n# ignored')).toEqual({
      RAG_SERVER_URL: 'http://localhost:3000',
      RAG_AGENT_TOKEN: 'abc',
    });
  });
});

describe('maskToken', () => {
  it('does not reveal full tokens', () => {
    expect(maskToken('')).toBe('(empty)');
    expect(maskToken('short')).toBe('sho...');
    expect(maskToken('test_agent_token_123456')).toBe('test_age...3456');
  });
});

describe('resolveConfig', () => {
  it('uses CLI flags before environment variables', () => {
    const config = resolveConfig({
      cwd: tempDir(),
      argv: ['--server', 'http://flag:3000', '--token', 'flag-token', 'clients', 'list'],
      env: { RAG_SERVER_URL: 'http://env:3000', RAG_AGENT_TOKEN: 'env-token' },
    });

    expect(config.serverUrl).toBe('http://flag:3000');
    expect(config.token).toBe('flag-token');
    expect(config.commandArgs).toEqual(['clients', 'list']);
  });

  it('uses environment variables for server URL and token', () => {
    const config = resolveConfig({
      cwd: tempDir(),
      argv: ['doctor'],
      env: { RAG_SERVER_URL: 'http://env:3000/', RAG_AGENT_TOKEN: 'env-token' },
    });

    expect(config.serverUrl).toBe('http://env:3000');
    expect(config.token).toBe('env-token');
  });

  it('supports alternate token environment variables', () => {
    const config = resolveConfig({
      cwd: tempDir(),
      argv: ['doctor'],
      env: { RAG_SERVER_URL: 'http://env:3000', AGENT_API_TOKEN: 'agent-api-token' },
    });

    expect(config.token).toBe('agent-api-token');
  });

  it('uses .ragrc before .env', () => {
    const dir = tempDir();
    writeFileSync(join(dir, '.ragrc'), 'RAG_SERVER_URL=http://ragrc:3000\nRAG_AGENT_TOKEN=ragrc-token\n');
    writeFileSync(join(dir, '.env'), 'RAG_SERVER_URL=http://envfile:3000\nRAG_AGENT_TOKEN=envfile-token\n');

    const config = resolveConfig({ cwd: dir, argv: ['doctor'], env: {} });

    expect(config.serverUrl).toBe('http://ragrc:3000');
    expect(config.token).toBe('ragrc-token');
  });

  it('uses server.config.yaml when no higher priority config exists', () => {
    const dir = tempDir();
    writeFileSync(join(dir, 'server.config.yaml'), 'server:\n  host: 0.0.0.0\n  port: 3333\nauth:\n  agentApiToken: yaml-agent-token\n');

    const config = resolveConfig({ cwd: dir, argv: ['doctor'], env: {} });

    expect(config.serverUrl).toBe('http://localhost:3333');
    expect(config.token).toBe('yaml-agent-token');
  });

  it('finds config files in ancestor directories', () => {
    const dir = tempDir();
    const child = join(dir, 'nested', 'project');
    mkdirSync(child, { recursive: true });
    writeFileSync(join(dir, '.ragrc'), 'RAG_SERVER_URL=http://parent:3000\nRAG_AGENT_TOKEN=parent-token\n');

    const config = resolveConfig({ cwd: child, argv: ['doctor'], env: {} });

    expect(config.serverUrl).toBe('http://parent:3000');
    expect(config.token).toBe('parent-token');
  });
});
```

- [ ] **Step 5: Run config tests and verify they fail**

Run:

```bash
cd D:/remote-agent-gateway && pnpm --filter @rag/cli test -- config.test.ts
```

Expected: FAIL because `apps/cli/src/config/config.ts` does not exist yet.

- [ ] **Step 6: Implement config resolution**

Create `apps/cli/src/config/config.ts`:

```ts
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
```

- [ ] **Step 7: Write failing output/error tests**

Create `apps/cli/src/output/json-output.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { CliError } from '../http/http-error.js';
import { errorEnvelope, successEnvelope } from './json-output.js';

describe('json output envelopes', () => {
  it('wraps success data', () => {
    expect(successEnvelope({ id: 'client-1' })).toEqual({ ok: true, data: { id: 'client-1' } });
  });

  it('wraps typed errors without leaking tokens', () => {
    const envelope = errorEnvelope(new CliError('HTTP_ERROR', 'Request failed with token secret-token', 500));
    expect(envelope.ok).toBe(false);
    expect(envelope.error.code).toBe('HTTP_ERROR');
    expect(envelope.error.status).toBe(500);
    expect(envelope.error.message).toContain('[redacted]');
    expect(envelope.error.message).not.toContain('secret-token');
  });

  it('wraps generic errors as NETWORK_ERROR', () => {
    expect(errorEnvelope(new Error('connection refused')).error.code).toBe('NETWORK_ERROR');
  });
});
```

- [ ] **Step 8: Run output tests and verify they fail**

Run:

```bash
cd D:/remote-agent-gateway && pnpm --filter @rag/cli test -- json-output.test.ts
```

Expected: FAIL because output and error modules do not exist yet.

- [ ] **Step 9: Implement CLI error and JSON output helpers**

Create `apps/cli/src/http/http-error.ts`:

```ts
export type CliErrorCode =
  | 'CONFIG_ERROR'
  | 'ARGUMENT_ERROR'
  | 'HTTP_ERROR'
  | 'NETWORK_ERROR'
  | 'CLIENT_DISCOVERY_ERROR'
  | 'IO_ERROR'
  | 'PARSE_ERROR';

export class CliError extends Error {
  constructor(
    public readonly code: CliErrorCode,
    message: string,
    public readonly status?: number,
  ) {
    super(message);
    this.name = 'CliError';
  }
}

export function normalizeError(error: unknown): CliError {
  if (error instanceof CliError) return error;
  if (error instanceof Error) return new CliError('NETWORK_ERROR', error.message);
  return new CliError('NETWORK_ERROR', String(error));
}
```

Create `apps/cli/src/output/json-output.ts`:

```ts
import { CliError, normalizeError } from '../http/http-error.js';

export interface SuccessEnvelope<T> {
  ok: true;
  data: T;
}

export interface ErrorEnvelope {
  ok: false;
  error: {
    code: string;
    message: string;
    status?: number;
  };
}

function redactSecrets(message: string): string {
  return message
    .replace(/token\s+[^\s"']+/gi, 'token [redacted]')
    .replace(/Bearer\s+[^\s"']+/gi, 'Bearer [redacted]')
    .replace(/secret-token/g, '[redacted]');
}

export function successEnvelope<T>(data: T): SuccessEnvelope<T> {
  return { ok: true, data };
}

export function errorEnvelope(error: unknown): ErrorEnvelope {
  const normalized = normalizeError(error);
  return {
    ok: false,
    error: {
      code: normalized.code,
      message: redactSecrets(normalized.message),
      ...(normalized.status === undefined ? {} : { status: normalized.status }),
    },
  };
}

export function writeJson(value: unknown, stream: NodeJS.WritableStream = process.stdout): void {
  stream.write(`${JSON.stringify(value, null, 2)}\n`);
}

export function writeJsonLine(value: unknown, stream: NodeJS.WritableStream = process.stdout): void {
  stream.write(`${JSON.stringify(value)}\n`);
}

export function exitCodeFor(error: unknown): number {
  return error instanceof CliError && error.code === 'ARGUMENT_ERROR' ? 2 : 1;
}
```

- [ ] **Step 10: Run Task 1 tests and verify they pass**

Run:

```bash
cd D:/remote-agent-gateway && pnpm --filter @rag/cli test -- config.test.ts json-output.test.ts
```

Expected: PASS for all tests in `config.test.ts` and `json-output.test.ts`.

- [ ] **Step 11: Run typecheck for the CLI package**

Run:

```bash
cd D:/remote-agent-gateway && pnpm --filter @rag/cli typecheck
```

Expected: exit 0.

- [ ] **Step 12: Commit Task 1**

Run:

```bash
cd D:/remote-agent-gateway && git add apps/cli pnpm-lock.yaml && git commit -m "feat(cli): scaffold config and json output primitives"
```

Expected: commit succeeds.

---

## Task 2: Implement server/client HTTP clients with discovery

**Files:**
- Create: `apps/cli/src/http/server-api.ts`
- Create: `apps/cli/src/http/client-http.ts`
- Create: `apps/cli/src/http/http.test.ts`

- [ ] **Step 1: Write failing HTTP tests**

Create `apps/cli/src/http/http.test.ts`:

```ts
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { CliError } from './http-error.js';
import { ClientHttpApi } from './client-http.js';
import { ServerApi } from './server-api.js';

const fetchMock = vi.fn();

describe('ServerApi', () => {
  beforeEach(() => {
    fetchMock.mockReset();
    globalThis.fetch = fetchMock as any;
  });

  it('lists clients with bearer auth', async () => {
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify([{ id: 'client-1' }]), { status: 200 }));
    const api = new ServerApi({ serverUrl: 'http://server:3000', token: 'agent-token' });

    await expect(api.listClients()).resolves.toEqual([{ id: 'client-1' }]);
    expect(fetchMock).toHaveBeenCalledWith('http://server:3000/api/clients', expect.objectContaining({
      method: 'GET',
      headers: expect.objectContaining({ Authorization: 'Bearer agent-token' }),
    }));
  });

  it('gets client HTTP connection details', async () => {
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({ id: 'client-1', clientHttpBaseUrl: 'http://client:20000', clientHttpToken: 'client-token', httpReady: true }), { status: 200 }));
    const api = new ServerApi({ serverUrl: 'http://server:3000', token: 'agent-token' });

    await expect(api.getClient('client-1')).resolves.toEqual({ id: 'client-1', clientHttpBaseUrl: 'http://client:20000', clientHttpToken: 'client-token', httpReady: true });
  });

  it('throws HTTP_ERROR for non-2xx responses', async () => {
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({ error: 'Client not found' }), { status: 404 }));
    const api = new ServerApi({ serverUrl: 'http://server:3000', token: 'agent-token' });

    await expect(api.getClient('missing')).rejects.toMatchObject({ code: 'HTTP_ERROR', status: 404, message: 'Client not found' });
  });

  it('discovers ready client HTTP details', async () => {
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({ id: 'client-1', clientHttpBaseUrl: 'http://client:20000', clientHttpToken: 'client-token', httpReady: true }), { status: 200 }));
    const api = new ServerApi({ serverUrl: 'http://server:3000', token: 'agent-token' });

    await expect(api.discoverClientHttp('client-1')).resolves.toEqual({ baseUrl: 'http://client:20000', token: 'client-token', client: { id: 'client-1', clientHttpBaseUrl: 'http://client:20000', clientHttpToken: 'client-token', httpReady: true } });
  });

  it('throws CLIENT_DISCOVERY_ERROR when client HTTP token is absent', async () => {
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({ id: 'client-1', clientHttpBaseUrl: 'http://client:20000', httpReady: false }), { status: 200 }));
    const api = new ServerApi({ serverUrl: 'http://server:3000', token: 'agent-token' });

    await expect(api.discoverClientHttp('client-1')).rejects.toMatchObject({ code: 'CLIENT_DISCOVERY_ERROR' });
  });

  it('lists task history with query filters', async () => {
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({ items: [], total: 0, page: 1, pageSize: 20 }), { status: 200 }));
    const api = new ServerApi({ serverUrl: 'http://server:3000', token: 'agent-token' });

    await api.listTasks({ clientId: 'client-1', actionType: 'file.write', pageSize: 10 });

    expect(fetchMock).toHaveBeenCalledWith('http://server:3000/api/tasks?clientId=client-1&actionType=file.write&pageSize=10', expect.any(Object));
  });
});

describe('ClientHttpApi', () => {
  beforeEach(() => {
    fetchMock.mockReset();
    globalThis.fetch = fetchMock as any;
  });

  it('calls client health with client token', async () => {
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({ status: 'ready' }), { status: 200 }));
    const api = new ClientHttpApi({ baseUrl: 'http://client:20000', token: 'client-token' });

    await expect(api.health()).resolves.toEqual({ status: 'ready' });
    expect(fetchMock).toHaveBeenCalledWith('http://client:20000/health', expect.objectContaining({
      method: 'GET',
      headers: expect.objectContaining({ Authorization: 'Bearer client-token' }),
    }));
  });

  it('creates command jobs', async () => {
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({ jobId: 'job_1', status: 'queued' }), { status: 200 }));
    const api = new ClientHttpApi({ baseUrl: 'http://client:20000', token: 'client-token' });

    await expect(api.createCommandJob({ command: 'node', args: ['-v'] })).resolves.toEqual({ jobId: 'job_1', status: 'queued' });
  });

  it('reads text files as raw text', async () => {
    fetchMock.mockResolvedValueOnce(new Response('hello', { status: 200, headers: { 'Content-Type': 'text/plain' } }));
    const api = new ClientHttpApi({ baseUrl: 'http://client:20000', token: 'client-token' });

    await expect(api.readFile('root-0', 'README.md')).resolves.toBe('hello');
  });

  it('downloads binary files as Uint8Array', async () => {
    fetchMock.mockResolvedValueOnce(new Response(new Uint8Array([1, 2, 3]), { status: 200 }));
    const api = new ClientHttpApi({ baseUrl: 'http://client:20000', token: 'client-token' });

    const bytes = await api.downloadFile('root-0', 'a.bin');
    expect(Array.from(bytes)).toEqual([1, 2, 3]);
  });
});
```

- [ ] **Step 2: Run HTTP tests and verify they fail**

Run:

```bash
cd D:/remote-agent-gateway && pnpm --filter @rag/cli test -- http.test.ts
```

Expected: FAIL because `server-api.ts` and `client-http.ts` do not exist yet.

- [ ] **Step 3: Implement server API client**

Create `apps/cli/src/http/server-api.ts`:

```ts
import { CliError } from './http-error.js';

export interface ServerApiConfig {
  serverUrl: string;
  token: string;
}

export interface DiscoveredClientHttp {
  baseUrl: string;
  token: string;
  client: Record<string, unknown>;
}

export class ServerApi {
  constructor(private readonly config: ServerApiConfig) {}

  async listClients(): Promise<unknown> {
    return this.request('GET', '/api/clients');
  }

  async getClient(clientId: string): Promise<Record<string, unknown>> {
    return this.request('GET', `/api/clients/${encodeURIComponent(clientId)}`) as Promise<Record<string, unknown>>;
  }

  async discoverClientHttp(clientId: string): Promise<DiscoveredClientHttp> {
    const client = await this.getClient(clientId);
    const baseUrl = typeof client.clientHttpBaseUrl === 'string' ? client.clientHttpBaseUrl : '';
    const token = typeof client.clientHttpToken === 'string' ? client.clientHttpToken : '';
    if (!baseUrl || !token) {
      throw new CliError('CLIENT_DISCOVERY_ERROR', `Client ${clientId} is missing ready clientHttpBaseUrl/clientHttpToken`);
    }
    return { baseUrl: baseUrl.replace(/\/+$/, ''), token, client };
  }

  async listTasks(query: Record<string, string | number | undefined> = {}): Promise<unknown> {
    const search = new URLSearchParams();
    for (const [key, value] of Object.entries(query)) {
      if (value !== undefined && value !== '') search.set(key, String(value));
    }
    const suffix = search.size ? `?${search.toString()}` : '';
    return this.request('GET', `/api/tasks${suffix}`);
  }

  async getTaskRecord(recordId: string): Promise<unknown> {
    return this.request('GET', `/api/tasks/${encodeURIComponent(recordId)}`);
  }

  private async request(method: string, path: string, body?: unknown): Promise<unknown> {
    let response: Response;
    try {
      response = await fetch(`${this.config.serverUrl}${path}`, {
        method,
        headers: {
          Authorization: `Bearer ${this.config.token}`,
          ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
        },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
    } catch (error) {
      throw new CliError('NETWORK_ERROR', error instanceof Error ? error.message : String(error));
    }
    return readResponse(response);
  }
}

export async function readResponse(response: Response, mode: 'json' | 'text' | 'bytes' = 'json'): Promise<unknown> {
  if (!response.ok) {
    const text = await response.text();
    let message = text;
    try {
      const parsed = JSON.parse(text) as { error?: string; message?: string };
      message = parsed.error ?? parsed.message ?? text;
    } catch {}
    throw new CliError('HTTP_ERROR', message, response.status);
  }

  if (mode === 'text') return response.text();
  if (mode === 'bytes') return new Uint8Array(await response.arrayBuffer());

  const text = await response.text();
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch (error) {
    throw new CliError('PARSE_ERROR', error instanceof Error ? error.message : String(error));
  }
}
```

- [ ] **Step 4: Implement client HTTP API client**

Create `apps/cli/src/http/client-http.ts`:

```ts
import { CliError } from './http-error.js';
import { readResponse } from './server-api.js';

export interface ClientHttpApiConfig {
  baseUrl: string;
  token: string;
}

export interface CommandJobPayload {
  command: string;
  args?: string[];
  cwd?: string;
  timeoutMs?: number;
  env?: Record<string, string>;
}

export interface ScriptJobPayload {
  runtime?: 'node' | 'python' | 'bash' | 'powershell';
  script: string;
  cwd?: string;
  timeoutMs?: number;
  env?: Record<string, string>;
}

export interface FrpCreatePayload {
  name: string;
  type: 'tcp' | 'http' | 'https';
  localHost?: string;
  localPort: number;
  remotePort?: number | null;
  customDomain?: string;
}

export class ClientHttpApi {
  constructor(private readonly config: ClientHttpApiConfig) {}

  health(): Promise<unknown> { return this.request('GET', '/health'); }
  createCommandJob(payload: CommandJobPayload): Promise<unknown> { return this.request('POST', '/jobs/command', payload); }
  createScriptJob(payload: ScriptJobPayload): Promise<unknown> { return this.request('POST', '/jobs/script', payload); }
  getJob(jobId: string): Promise<unknown> { return this.request('GET', `/jobs/${encodeURIComponent(jobId)}`); }
  getJobLogs(jobId: string, sinceSeq = 0, limit = 500): Promise<unknown> { return this.request('GET', `/jobs/${encodeURIComponent(jobId)}/logs?${new URLSearchParams({ sinceSeq: String(sinceSeq), limit: String(limit) })}`); }
  cancelJob(jobId: string): Promise<unknown> { return this.request('POST', `/jobs/${encodeURIComponent(jobId)}/cancel`, {}); }
  roots(): Promise<unknown> { return this.request('GET', '/files/roots'); }
  listFiles(rootId: string, path: string): Promise<unknown> { return this.request('GET', `/files?${this.pathQuery(rootId, path)}`); }
  statFile(rootId: string, path: string): Promise<unknown> { return this.request('GET', `/files/stat?${this.pathQuery(rootId, path)}`); }
  readFile(rootId: string, path: string): Promise<string> { return this.request('GET', `/files/read?${this.pathQuery(rootId, path)}`, undefined, 'text') as Promise<string>; }
  downloadFile(rootId: string, path: string): Promise<Uint8Array> { return this.request('GET', `/files/download?${this.pathQuery(rootId, path)}`, undefined, 'bytes') as Promise<Uint8Array>; }
  writeFile(rootId: string, path: string, body: string | Uint8Array): Promise<unknown> { return this.request('PUT', `/files/write?${this.pathQuery(rootId, path)}`, body, 'json', 'application/octet-stream'); }
  uploadFile(rootId: string, path: string, filename: string, body: Uint8Array): Promise<unknown> { return this.request('POST', `/files/upload?${this.uploadQuery(rootId, path, filename)}`, body, 'json', 'application/octet-stream'); }
  mkdir(rootId: string, path: string, recursive: boolean): Promise<unknown> { return this.request('POST', '/files/mkdir', { rootId, path, recursive }); }
  deleteFile(rootId: string, path: string, recursive: boolean): Promise<unknown> { return this.request('DELETE', `/files?${this.deleteQuery(rootId, path, recursive)}`); }
  move(rootId: string, from: string, to: string, overwrite: boolean): Promise<unknown> { return this.request('POST', '/files/move', { rootId, from, to, overwrite }); }
  copy(rootId: string, from: string, to: string, overwrite: boolean): Promise<unknown> { return this.request('POST', '/files/copy', { rootId, from, to, overwrite }); }
  listMappings(): Promise<unknown> { return this.request('GET', '/frp/mappings'); }
  createMapping(payload: FrpCreatePayload): Promise<unknown> { return this.request('POST', '/frp/mappings', payload); }
  deleteMapping(mappingId: string): Promise<unknown> { return this.request('DELETE', `/frp/mappings/${encodeURIComponent(mappingId)}`); }

  async *events(jobId: string): AsyncGenerator<unknown> {
    const response = await fetch(`${this.config.baseUrl}/jobs/${encodeURIComponent(jobId)}/events`, {
      method: 'GET',
      headers: { Authorization: `Bearer ${this.config.token}` },
    });
    if (!response.ok) await readResponse(response);
    const reader = response.body?.getReader();
    if (!reader) throw new CliError('PARSE_ERROR', 'SSE response has no readable body');
    const decoder = new TextDecoder();
    let buffer = '';
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let index;
      while ((index = buffer.indexOf('\n\n')) >= 0) {
        const frame = buffer.slice(0, index);
        buffer = buffer.slice(index + 2);
        const parsed = parseSseFrame(frame);
        if (parsed) yield parsed;
      }
    }
  }

  private pathQuery(rootId: string, path: string): string {
    return new URLSearchParams({ rootId, path }).toString();
  }

  private uploadQuery(rootId: string, path: string, filename: string): string {
    return new URLSearchParams({ rootId, path, filename }).toString();
  }

  private deleteQuery(rootId: string, path: string, recursive: boolean): string {
    return new URLSearchParams({ rootId, path, recursive: String(recursive) }).toString();
  }

  private async request(method: string, path: string, body?: unknown, mode: 'json' | 'text' | 'bytes' = 'json', contentType = 'application/json'): Promise<unknown> {
    let response: Response;
    try {
      response = await fetch(`${this.config.baseUrl}${path}`, {
        method,
        headers: {
          Authorization: `Bearer ${this.config.token}`,
          ...(body === undefined ? {} : { 'Content-Type': contentType }),
        },
        body: body === undefined ? undefined : contentType === 'application/json' ? JSON.stringify(body) : body as BodyInit,
      });
    } catch (error) {
      throw new CliError('NETWORK_ERROR', error instanceof Error ? error.message : String(error));
    }
    return readResponse(response, mode);
  }
}

function parseSseFrame(frame: string): unknown | null {
  let event = 'message';
  let data = '';
  for (const line of frame.split(/\r?\n/)) {
    if (line.startsWith('event:')) event = line.slice('event:'.length).trim();
    if (line.startsWith('data:')) data += line.slice('data:'.length).trim();
  }
  if (!data) return null;
  try {
    return { event, data: JSON.parse(data) };
  } catch {
    return { event, data };
  }
}
```

- [ ] **Step 5: Run HTTP tests and typecheck**

Run:

```bash
cd D:/remote-agent-gateway && pnpm --filter @rag/cli test -- http.test.ts && pnpm --filter @rag/cli typecheck
```

Expected: tests PASS and typecheck exits 0.

- [ ] **Step 6: Commit Task 2**

Run:

```bash
cd D:/remote-agent-gateway && git add apps/cli/src/http && git commit -m "feat(cli): add server and client http clients"
```

Expected: commit succeeds.

---

## Task 3: Implement CLI entrypoint plus config, clients, tasks, and doctor commands

**Files:**
- Create: `apps/cli/src/index.ts`
- Create: `apps/cli/src/commands/clients.ts`
- Create: `apps/cli/src/commands/tasks.ts`
- Create: `apps/cli/src/commands/doctor.ts`
- Create: `apps/cli/src/commands/commands.test.ts`
- Create: `apps/cli/src/util/args.ts`

- [ ] **Step 1: Write failing command tests for read-only commands**

Create `apps/cli/src/commands/commands.test.ts`:

```ts
import { Command } from 'commander';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { registerClientsCommands } from './clients.js';
import { registerDoctorCommand } from './doctor.js';
import { registerTasksCommands } from './tasks.js';

const serverApi = {
  listClients: vi.fn(),
  getClient: vi.fn(),
  discoverClientHttp: vi.fn(),
  listTasks: vi.fn(),
  getTaskRecord: vi.fn(),
};

const clientHttpFactory = vi.fn();

function createProgram(write: (value: unknown) => void): Command {
  const program = new Command();
  program.exitOverride();
  program.configureOutput({ writeOut: () => undefined, writeErr: () => undefined });
  program.option('--server <url>');
  program.option('--token <token>');
  registerClientsCommands(program, { serverApi: serverApi as any, write });
  registerTasksCommands(program, { serverApi: serverApi as any, write });
  registerDoctorCommand(program, { serverApi: serverApi as any, clientHttpFactory, write });
  return program;
}

describe('read-only CLI commands', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('runs clients list', async () => {
    const outputs: unknown[] = [];
    serverApi.listClients.mockResolvedValueOnce([{ id: 'client-1' }]);
    const program = createProgram((value) => outputs.push(value));

    await program.parseAsync(['clients', 'list'], { from: 'user' });

    expect(outputs).toEqual([{ ok: true, data: [{ id: 'client-1' }] }]);
  });

  it('requires --client for clients get', async () => {
    const program = createProgram(() => undefined);

    await expect(program.parseAsync(['clients', 'get'], { from: 'user' })).rejects.toThrow();
  });

  it('runs clients get', async () => {
    const outputs: unknown[] = [];
    serverApi.getClient.mockResolvedValueOnce({ id: 'client-1' });
    const program = createProgram((value) => outputs.push(value));

    await program.parseAsync(['clients', 'get', '--client', 'client-1'], { from: 'user' });

    expect(serverApi.getClient).toHaveBeenCalledWith('client-1');
    expect(outputs[0]).toEqual({ ok: true, data: { id: 'client-1' } });
  });

  it('runs tasks list with filters', async () => {
    const outputs: unknown[] = [];
    serverApi.listTasks.mockResolvedValueOnce({ items: [], total: 0 });
    const program = createProgram((value) => outputs.push(value));

    await program.parseAsync(['tasks', 'list', '--client', 'client-1', '--action', 'file.write', '--page-size', '10'], { from: 'user' });

    expect(serverApi.listTasks).toHaveBeenCalledWith({ clientId: 'client-1', actionType: 'file.write', pageSize: 10, status: undefined, resourceType: undefined, sourceType: undefined, keyword: undefined, page: undefined });
    expect(outputs[0]).toEqual({ ok: true, data: { items: [], total: 0 } });
  });

  it('runs doctor without client', async () => {
    const outputs: unknown[] = [];
    serverApi.listClients.mockResolvedValueOnce([{ id: 'client-1' }]);
    const program = createProgram((value) => outputs.push(value));

    await program.parseAsync(['doctor'], { from: 'user' });

    expect(outputs[0]).toEqual({ ok: true, data: { server: { reachable: true }, clients: { reachable: true, count: 1 } } });
  });

  it('runs doctor with client HTTP checks', async () => {
    const outputs: unknown[] = [];
    const clientHttp = { health: vi.fn().mockResolvedValue({ status: 'ready' }), roots: vi.fn().mockResolvedValue({ roots: [{ id: 'root-0' }] }), listMappings: vi.fn().mockResolvedValue({ mappings: [] }) };
    serverApi.discoverClientHttp.mockResolvedValueOnce({ baseUrl: 'http://client', token: 'client-token', client: { id: 'client-1', online: true } });
    clientHttpFactory.mockReturnValueOnce(clientHttp);
    const program = createProgram((value) => outputs.push(value));

    await program.parseAsync(['doctor', '--client', 'client-1'], { from: 'user' });

    expect(outputs[0]).toEqual({ ok: true, data: expect.objectContaining({ clientHttp: { reachable: true }, files: { rootsCount: 1 }, frp: { mappingsCount: 0 } }) });
  });
});
```

- [ ] **Step 2: Run command tests and verify they fail**

Run:

```bash
cd D:/remote-agent-gateway && pnpm --filter @rag/cli test -- commands.test.ts
```

Expected: FAIL because command modules do not exist.

- [ ] **Step 3: Add shared argument helpers**

Create `apps/cli/src/util/args.ts`:

```ts
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
```

- [ ] **Step 4: Implement clients commands**

Create `apps/cli/src/commands/clients.ts`:

```ts
import type { Command } from 'commander';
import { successEnvelope } from '../output/json-output.js';
import { requiredString } from '../util/args.js';

interface ClientsDeps {
  serverApi: {
    listClients(): Promise<unknown>;
    getClient(clientId: string): Promise<unknown>;
  };
  write(value: unknown): void;
}

export function registerClientsCommands(program: Command, deps: ClientsDeps): void {
  const clients = program.command('clients').description('List and inspect registered clients');

  clients.command('list')
    .description('List all clients')
    .action(async () => {
      deps.write(successEnvelope(await deps.serverApi.listClients()));
    });

  clients.command('get')
    .description('Get one client and include client HTTP discovery details when ready')
    .requiredOption('--client <clientId>', 'Client ID')
    .action(async (options: { client?: string }) => {
      deps.write(successEnvelope(await deps.serverApi.getClient(requiredString(options.client, '--client'))));
    });
}
```

- [ ] **Step 5: Implement tasks commands**

Create `apps/cli/src/commands/tasks.ts`:

```ts
import type { Command } from 'commander';
import { successEnvelope } from '../output/json-output.js';
import { optionalNumber, requiredString } from '../util/args.js';

interface TasksDeps {
  serverApi: {
    listTasks(query: Record<string, string | number | undefined>): Promise<unknown>;
    getTaskRecord(recordId: string): Promise<unknown>;
  };
  write(value: unknown): void;
}

export function registerTasksCommands(program: Command, deps: TasksDeps): void {
  const tasks = program.command('tasks').description('Inspect server-side task audit history');

  tasks.command('list')
    .description('List task audit history records')
    .option('--client <clientId>', 'Filter by client ID')
    .option('--action <actionType>', 'Filter by action type')
    .option('--status <status>', 'Filter by status')
    .option('--resource <resourceType>', 'Filter by resource type')
    .option('--source <sourceType>', 'Filter by source type')
    .option('--keyword <keyword>', 'Keyword search')
    .option('--page <page>', 'Page number')
    .option('--page-size <pageSize>', 'Page size')
    .action(async (options: Record<string, string | undefined>) => {
      deps.write(successEnvelope(await deps.serverApi.listTasks({
        clientId: options.client,
        actionType: options.action,
        status: options.status,
        resourceType: options.resource,
        sourceType: options.source,
        keyword: options.keyword,
        page: optionalNumber(options.page, '--page'),
        pageSize: optionalNumber(options.pageSize, '--page-size'),
      })));
    });

  tasks.command('get')
    .description('Get one task audit history record')
    .requiredOption('--record <recordId>', 'Record ID')
    .action(async (options: { record?: string }) => {
      deps.write(successEnvelope(await deps.serverApi.getTaskRecord(requiredString(options.record, '--record'))));
    });
}
```

- [ ] **Step 6: Implement doctor command**

Create `apps/cli/src/commands/doctor.ts`:

```ts
import type { Command } from 'commander';
import { ClientHttpApi } from '../http/client-http.js';
import { successEnvelope } from '../output/json-output.js';

interface DoctorDeps {
  serverApi: {
    listClients(): Promise<unknown>;
    discoverClientHttp(clientId: string): Promise<{ baseUrl: string; token: string; client: Record<string, unknown> }>;
  };
  clientHttpFactory?: (input: { baseUrl: string; token: string }) => Pick<ClientHttpApi, 'health' | 'roots' | 'listMappings'>;
  write(value: unknown): void;
}

export function registerDoctorCommand(program: Command, deps: DoctorDeps): void {
  program.command('doctor')
    .description('Check RAG server and optional client HTTP connectivity')
    .option('--client <clientId>', 'Client ID to check')
    .action(async (options: { client?: string }) => {
      if (!options.client) {
        const clients = await deps.serverApi.listClients() as unknown[];
        deps.write(successEnvelope({ server: { reachable: true }, clients: { reachable: true, count: Array.isArray(clients) ? clients.length : null } }));
        return;
      }

      const discovered = await deps.serverApi.discoverClientHttp(options.client);
      const factory = deps.clientHttpFactory ?? ((input) => new ClientHttpApi(input));
      const clientHttp = factory({ baseUrl: discovered.baseUrl, token: discovered.token });
      const [health, roots, mappings] = await Promise.all([
        clientHttp.health(),
        clientHttp.roots(),
        clientHttp.listMappings(),
      ]);

      deps.write(successEnvelope({
        server: { reachable: true },
        client: discovered.client,
        clientHttp: { reachable: true, health },
        files: { rootsCount: Array.isArray((roots as any).roots) ? (roots as any).roots.length : null },
        frp: { mappingsCount: Array.isArray((mappings as any).mappings) ? (mappings as any).mappings.length : null },
      }));
    });
}
```

- [ ] **Step 7: Implement CLI entrypoint**

Create `apps/cli/src/index.ts`:

```ts
#!/usr/bin/env node
import { Command } from 'commander';
import { resolveConfig, maskToken } from './config/config.js';
import { ServerApi } from './http/server-api.js';
import { errorEnvelope, exitCodeFor, successEnvelope, writeJson } from './output/json-output.js';
import { registerClientsCommands } from './commands/clients.js';
import { registerDoctorCommand } from './commands/doctor.js';
import { registerTasksCommands } from './commands/tasks.js';
import { CliError } from './http/http-error.js';

const VERSION = '0.1.0';

export function buildProgram(input: { argv?: string[]; env?: Record<string, string | undefined>; cwd?: string; write?: (value: unknown) => void } = {}): Command {
  const config = resolveConfig({ argv: input.argv ?? process.argv.slice(2), env: input.env ?? process.env, cwd: input.cwd ?? process.cwd() });
  const write = input.write ?? writeJson;
  const program = new Command();
  program
    .name('rag')
    .description('Remote Agent Gateway AI-agent-first CLI')
    .version(VERSION)
    .option('--server <url>', 'RAG server URL')
    .option('--token <token>', 'RAG API token')
    .option('--config <path>', 'Path to .ragrc-style config file');

  program.command('config')
    .description('Configuration commands')
    .command('show')
    .description('Show resolved configuration with masked token')
    .action(() => {
      write(successEnvelope({ serverUrl: config.serverUrl || null, token: maskToken(config.token), sources: config.sources }));
    });

  let cachedServerApi: ServerApi | undefined;
  function requireServerApi(): ServerApi {
    if (!config.serverUrl) throw new CliError('CONFIG_ERROR', 'RAG server URL is missing. Set RAG_SERVER_URL or pass --server.');
    if (!config.token) throw new CliError('CONFIG_ERROR', 'RAG token is missing. Set RAG_AGENT_TOKEN or pass --token.');
    cachedServerApi ??= new ServerApi({ serverUrl: config.serverUrl, token: config.token });
    return cachedServerApi;
  }

  const deps = {
    serverApi: {
      listClients: () => requireServerApi().listClients(),
      getClient: (clientId: string) => requireServerApi().getClient(clientId),
      discoverClientHttp: (clientId: string) => requireServerApi().discoverClientHttp(clientId),
      listTasks: (query: Record<string, string | number | undefined>) => requireServerApi().listTasks(query),
      getTaskRecord: (recordId: string) => requireServerApi().getTaskRecord(recordId),
    },
    write,
  };
  registerClientsCommands(program, deps);
  registerTasksCommands(program, deps);
  registerDoctorCommand(program, deps);

  return program;
}

export async function run(argv = process.argv.slice(2)): Promise<void> {
  try {
    await buildProgram({ argv }).parseAsync(argv, { from: 'user' });
  } catch (error) {
    writeJson(errorEnvelope(error), process.stderr);
    process.exitCode = exitCodeFor(error);
  }
}

if (import.meta.url === `file://${process.argv[1]?.replace(/\\/g, '/')}` || process.argv[1]?.endsWith('/index.js') || process.argv[1]?.endsWith('\\index.js')) {
  await run();
}
```

- [ ] **Step 8: Run read-only command tests and typecheck**

Run:

```bash
cd D:/remote-agent-gateway && pnpm --filter @rag/cli test -- commands.test.ts && pnpm --filter @rag/cli typecheck
```

Expected: tests PASS and typecheck exits 0. `config show` must work without server URL/token because the entrypoint creates `ServerApi` lazily only when a server-backed command runs.

- [ ] **Step 9: Commit Task 3**

Run:

```bash
cd D:/remote-agent-gateway && git add apps/cli/src/index.ts apps/cli/src/commands apps/cli/src/util && git commit -m "feat(cli): add clients tasks and doctor commands"
```

Expected: commit succeeds.

---

## Task 4: Implement jobs, files, and FRP command groups

**Files:**
- Create: `apps/cli/src/commands/jobs.ts`
- Create: `apps/cli/src/commands/files.ts`
- Create: `apps/cli/src/commands/frp.ts`
- Modify: `apps/cli/src/index.ts`
- Modify: `apps/cli/src/commands/commands.test.ts`

- [ ] **Step 1: Extend command tests for jobs, files, and FRP**

Update the import block at the top of `apps/cli/src/commands/commands.test.ts` so it includes the new command modules:

```ts
import { Command } from 'commander';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { registerClientsCommands } from './clients.js';
import { registerDoctorCommand } from './doctor.js';
import { registerFilesCommands } from './files.js';
import { registerFrpCommands } from './frp.js';
import { registerJobsCommands } from './jobs.js';
import { registerTasksCommands } from './tasks.js';
```

Then append these tests inside `apps/cli/src/commands/commands.test.ts` after the existing read-only command `describe` block:

```ts
describe('client direct command groups', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('runs jobs run with -- command args', async () => {
    const outputs: unknown[] = [];
    const clientHttp = { createCommandJob: vi.fn().mockResolvedValue({ jobId: 'job_1', status: 'queued' }) };
    const program = new Command();
    program.exitOverride();
    registerJobsCommands(program, { discoverClientHttp: async () => clientHttp as any, write: (value) => outputs.push(value) });

    await program.parseAsync(['jobs', 'run', '--client', 'client-1', '--', 'node', '-v'], { from: 'user' });

    expect(clientHttp.createCommandJob).toHaveBeenCalledWith({ command: 'node', args: ['-v'] });
    expect(outputs[0]).toEqual({ ok: true, data: { jobId: 'job_1', status: 'queued' } });
  });

  it('runs files read with JSON content by default', async () => {
    const outputs: unknown[] = [];
    const clientHttp = { readFile: vi.fn().mockResolvedValue('hello') };
    const program = new Command();
    program.exitOverride();
    registerFilesCommands(program, { discoverClientHttp: async () => clientHttp as any, write: (value) => outputs.push(value), writeRaw: (value) => outputs.push(value) });

    await program.parseAsync(['files', 'read', '--client', 'client-1', '--root', 'root-0', '--path', 'README.md'], { from: 'user' });

    expect(outputs[0]).toEqual({ ok: true, data: { rootId: 'root-0', path: 'README.md', content: 'hello' } });
  });

  it('runs files read --raw as raw output', async () => {
    const outputs: unknown[] = [];
    const clientHttp = { readFile: vi.fn().mockResolvedValue('hello') };
    const program = new Command();
    program.exitOverride();
    registerFilesCommands(program, { discoverClientHttp: async () => clientHttp as any, write: (value) => outputs.push(value), writeRaw: (value) => outputs.push(value) });

    await program.parseAsync(['files', 'read', '--client', 'client-1', '--root', 'root-0', '--path', 'README.md', '--raw'], { from: 'user' });

    expect(outputs[0]).toBe('hello');
  });

  it('runs frp create', async () => {
    const outputs: unknown[] = [];
    const clientHttp = { createMapping: vi.fn().mockResolvedValue({ id: 'pm_1' }) };
    const program = new Command();
    program.exitOverride();
    registerFrpCommands(program, { discoverClientHttp: async () => clientHttp as any, write: (value) => outputs.push(value) });

    await program.parseAsync(['frp', 'create', '--client', 'client-1', '--name', 'web', '--type', 'tcp', '--local-port', '3000'], { from: 'user' });

    expect(clientHttp.createMapping).toHaveBeenCalledWith({ name: 'web', type: 'tcp', localHost: '127.0.0.1', localPort: 3000, remotePort: undefined, customDomain: undefined });
    expect(outputs[0]).toEqual({ ok: true, data: { id: 'pm_1' } });
  });
});
```

- [ ] **Step 2: Run command tests and verify they fail**

Run:

```bash
cd D:/remote-agent-gateway && pnpm --filter @rag/cli test -- commands.test.ts
```

Expected: FAIL because jobs/files/frp command modules are missing.

- [ ] **Step 3: Implement jobs commands**

Create `apps/cli/src/commands/jobs.ts`:

```ts
import { readFile } from 'node:fs/promises';
import type { Command } from 'commander';
import type { ClientHttpApi } from '../http/client-http.js';
import { CliError } from '../http/http-error.js';
import { successEnvelope, writeJsonLine } from '../output/json-output.js';
import { optionalNumber, requiredString } from '../util/args.js';

interface JobsDeps {
  discoverClientHttp(clientId: string): Promise<ClientHttpApi>;
  write(value: unknown): void;
}

export function registerJobsCommands(program: Command, deps: JobsDeps): void {
  const jobs = program.command('jobs').description('Create and inspect live client HTTP jobs');

  jobs.command('run')
    .description('Run a command job on a client')
    .requiredOption('--client <clientId>', 'Client ID')
    .allowUnknownOption(true)
    .allowExcessArguments(true)
    .argument('[cmd...]', 'Command after --')
    .action(async (cmd: string[], options: { client?: string }) => {
      if (!cmd.length) throw new CliError('ARGUMENT_ERROR', 'Command after -- is required');
      const client = await deps.discoverClientHttp(requiredString(options.client, '--client'));
      deps.write(successEnvelope(await client.createCommandJob({ command: cmd[0], args: cmd.slice(1) })));
    });

  jobs.command('script')
    .description('Run an inline or file-backed script job on a client')
    .requiredOption('--client <clientId>', 'Client ID')
    .option('--file <file>', 'Local script file')
    .option('--inline <script>', 'Inline script content')
    .option('--runtime <runtime>', 'node, python, bash, or powershell', 'node')
    .option('--cwd <cwd>', 'Remote working directory')
    .option('--timeout-ms <timeoutMs>', 'Timeout in milliseconds')
    .action(async (options: { client?: string; file?: string; inline?: string; runtime?: any; cwd?: string; timeoutMs?: string }) => {
      const script = options.inline ?? (options.file ? await readFile(options.file, 'utf8') : undefined);
      if (!script) throw new Error('--inline or --file is required');
      const client = await deps.discoverClientHttp(requiredString(options.client, '--client'));
      deps.write(successEnvelope(await client.createScriptJob({ runtime: options.runtime, script, cwd: options.cwd, timeoutMs: optionalNumber(options.timeoutMs, '--timeout-ms') })));
    });

  jobs.command('get')
    .requiredOption('--client <clientId>', 'Client ID')
    .requiredOption('--job <jobId>', 'Job ID')
    .action(async (options: { client?: string; job?: string }) => {
      const client = await deps.discoverClientHttp(requiredString(options.client, '--client'));
      deps.write(successEnvelope(await client.getJob(requiredString(options.job, '--job'))));
    });

  jobs.command('logs')
    .requiredOption('--client <clientId>', 'Client ID')
    .requiredOption('--job <jobId>', 'Job ID')
    .option('--since-seq <sinceSeq>', 'First sequence after this value', '0')
    .option('--limit <limit>', 'Maximum log entries', '500')
    .action(async (options: { client?: string; job?: string; sinceSeq?: string; limit?: string }) => {
      const client = await deps.discoverClientHttp(requiredString(options.client, '--client'));
      deps.write(successEnvelope(await client.getJobLogs(requiredString(options.job, '--job'), Number(options.sinceSeq ?? 0), Number(options.limit ?? 500))));
    });

  jobs.command('events')
    .requiredOption('--client <clientId>', 'Client ID')
    .requiredOption('--job <jobId>', 'Job ID')
    .action(async (options: { client?: string; job?: string }) => {
      const client = await deps.discoverClientHttp(requiredString(options.client, '--client'));
      for await (const event of client.events(requiredString(options.job, '--job'))) {
        writeJsonLine({ ok: true, ...(event as Record<string, unknown>) });
      }
    });

  jobs.command('cancel')
    .requiredOption('--client <clientId>', 'Client ID')
    .requiredOption('--job <jobId>', 'Job ID')
    .action(async (options: { client?: string; job?: string }) => {
      const client = await deps.discoverClientHttp(requiredString(options.client, '--client'));
      deps.write(successEnvelope(await client.cancelJob(requiredString(options.job, '--job'))));
    });
}
```

- [ ] **Step 4: Implement files commands**

Create `apps/cli/src/commands/files.ts` with commands matching the spec. Use this exact implementation pattern:

```ts
import { readFile, writeFile } from 'node:fs/promises';
import type { Command } from 'commander';
import type { ClientHttpApi } from '../http/client-http.js';
import { successEnvelope } from '../output/json-output.js';
import { requiredString } from '../util/args.js';

interface FilesDeps {
  discoverClientHttp(clientId: string): Promise<ClientHttpApi>;
  write(value: unknown): void;
  writeRaw?: (value: string | Uint8Array) => void;
}

function rawWriter(value: string | Uint8Array): void {
  process.stdout.write(value);
  if (typeof value === 'string' && !value.endsWith('\n')) process.stdout.write('\n');
}

export function registerFilesCommands(program: Command, deps: FilesDeps): void {
  const files = program.command('files').description('Operate client files through client HTTP');
  const writeRaw = deps.writeRaw ?? rawWriter;

  files.command('roots').requiredOption('--client <clientId>').action(async (options: { client?: string }) => {
    const client = await deps.discoverClientHttp(requiredString(options.client, '--client'));
    deps.write(successEnvelope(await client.roots()));
  });

  files.command('list').requiredOption('--client <clientId>').requiredOption('--root <rootId>').requiredOption('--path <path>').action(async (options: any) => {
    const client = await deps.discoverClientHttp(requiredString(options.client, '--client'));
    deps.write(successEnvelope(await client.listFiles(options.root, options.path)));
  });

  files.command('stat').requiredOption('--client <clientId>').requiredOption('--root <rootId>').requiredOption('--path <path>').action(async (options: any) => {
    const client = await deps.discoverClientHttp(requiredString(options.client, '--client'));
    deps.write(successEnvelope(await client.statFile(options.root, options.path)));
  });

  files.command('read').requiredOption('--client <clientId>').requiredOption('--root <rootId>').requiredOption('--path <path>').option('--raw').action(async (options: any) => {
    const client = await deps.discoverClientHttp(requiredString(options.client, '--client'));
    const content = await client.readFile(options.root, options.path);
    if (options.raw) writeRaw(content);
    else deps.write(successEnvelope({ rootId: options.root, path: options.path, content }));
  });

  files.command('write').requiredOption('--client <clientId>').requiredOption('--root <rootId>').requiredOption('--path <path>').option('--content <content>').option('--stdin').action(async (options: any) => {
    const client = await deps.discoverClientHttp(requiredString(options.client, '--client'));
    const content = options.stdin ? await readStdinText() : requiredString(options.content, '--content or --stdin');
    deps.write(successEnvelope(await client.writeFile(options.root, options.path, content)));
  });

  files.command('upload').requiredOption('--client <clientId>').requiredOption('--root <rootId>').requiredOption('--path <path>').requiredOption('--file <file>').option('--filename <filename>').action(async (options: any) => {
    const client = await deps.discoverClientHttp(requiredString(options.client, '--client'));
    const bytes = await readFile(options.file);
    const filename = options.filename ?? options.file.split(/[\\/]/).pop();
    deps.write(successEnvelope(await client.uploadFile(options.root, options.path, filename, bytes)));
  });

  files.command('download').requiredOption('--client <clientId>').requiredOption('--root <rootId>').requiredOption('--path <path>').requiredOption('--output <output>').action(async (options: any) => {
    const client = await deps.discoverClientHttp(requiredString(options.client, '--client'));
    const bytes = await client.downloadFile(options.root, options.path);
    await writeFile(options.output, bytes);
    deps.write(successEnvelope({ rootId: options.root, path: options.path, output: options.output, size: bytes.length }));
  });

  files.command('mkdir').requiredOption('--client <clientId>').requiredOption('--root <rootId>').requiredOption('--path <path>').option('--recursive').action(async (options: any) => {
    const client = await deps.discoverClientHttp(requiredString(options.client, '--client'));
    deps.write(successEnvelope(await client.mkdir(options.root, options.path, options.recursive !== false)));
  });

  files.command('delete').requiredOption('--client <clientId>').requiredOption('--root <rootId>').requiredOption('--path <path>').option('--recursive').action(async (options: any) => {
    const client = await deps.discoverClientHttp(requiredString(options.client, '--client'));
    deps.write(successEnvelope(await client.deleteFile(options.root, options.path, options.recursive === true)));
  });

  files.command('move').requiredOption('--client <clientId>').requiredOption('--root <rootId>').requiredOption('--from <from>').requiredOption('--to <to>').option('--overwrite').action(async (options: any) => {
    const client = await deps.discoverClientHttp(requiredString(options.client, '--client'));
    deps.write(successEnvelope(await client.move(options.root, options.from, options.to, options.overwrite === true)));
  });

  files.command('copy').requiredOption('--client <clientId>').requiredOption('--root <rootId>').requiredOption('--from <from>').requiredOption('--to <to>').option('--overwrite').action(async (options: any) => {
    const client = await deps.discoverClientHttp(requiredString(options.client, '--client'));
    deps.write(successEnvelope(await client.copy(options.root, options.from, options.to, options.overwrite === true)));
  });
}

async function readStdinText(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  return Buffer.concat(chunks).toString('utf8');
}
```

- [ ] **Step 5: Implement FRP commands**

Create `apps/cli/src/commands/frp.ts`:

```ts
import type { Command } from 'commander';
import type { ClientHttpApi, FrpCreatePayload } from '../http/client-http.js';
import { successEnvelope } from '../output/json-output.js';
import { requiredNumber, requiredString } from '../util/args.js';

interface FrpDeps {
  discoverClientHttp(clientId: string): Promise<ClientHttpApi>;
  write(value: unknown): void;
}

export function registerFrpCommands(program: Command, deps: FrpDeps): void {
  const frp = program.command('frp').description('Manage client FRP mappings');

  frp.command('list').requiredOption('--client <clientId>').action(async (options: { client?: string }) => {
    const client = await deps.discoverClientHttp(requiredString(options.client, '--client'));
    deps.write(successEnvelope(await client.listMappings()));
  });

  frp.command('create')
    .requiredOption('--client <clientId>')
    .requiredOption('--name <name>')
    .requiredOption('--type <type>')
    .option('--local-host <localHost>', 'Local host', '127.0.0.1')
    .requiredOption('--local-port <localPort>')
    .option('--remote-port <remotePort>')
    .option('--custom-domain <customDomain>')
    .action(async (options: any) => {
      const type = requiredString(options.type, '--type') as FrpCreatePayload['type'];
      const payload: FrpCreatePayload = {
        name: requiredString(options.name, '--name'),
        type,
        localHost: options.localHost ?? '127.0.0.1',
        localPort: requiredNumber(options.localPort, '--local-port'),
        remotePort: options.remotePort === undefined ? undefined : requiredNumber(options.remotePort, '--remote-port'),
        customDomain: options.customDomain,
      };
      const client = await deps.discoverClientHttp(requiredString(options.client, '--client'));
      deps.write(successEnvelope(await client.createMapping(payload)));
    });

  frp.command('delete').requiredOption('--client <clientId>').requiredOption('--mapping <mappingId>').action(async (options: any) => {
    const client = await deps.discoverClientHttp(requiredString(options.client, '--client'));
    deps.write(successEnvelope(await client.deleteMapping(requiredString(options.mapping, '--mapping'))));
  });
}
```

- [ ] **Step 6: Wire new commands into entrypoint**

Modify `apps/cli/src/index.ts` imports and registration:

```ts
import { ClientHttpApi } from './http/client-http.js';
import { registerJobsCommands } from './commands/jobs.js';
import { registerFilesCommands } from './commands/files.js';
import { registerFrpCommands } from './commands/frp.js';
```

After existing command registrations, add:

```ts
async function discoverClientHttp(clientId: string): Promise<ClientHttpApi> {
  const discovered = await deps.serverApi.discoverClientHttp(clientId);
  return new ClientHttpApi({ baseUrl: discovered.baseUrl, token: discovered.token });
}

registerJobsCommands(program, { discoverClientHttp, write });
registerFilesCommands(program, { discoverClientHttp, write });
registerFrpCommands(program, { discoverClientHttp, write });
```

- [ ] **Step 7: Run tests and typecheck**

Run:

```bash
cd D:/remote-agent-gateway && pnpm --filter @rag/cli test -- commands.test.ts http.test.ts && pnpm --filter @rag/cli typecheck
```

Expected: tests PASS and typecheck exits 0. The `jobs run --client client-1 -- node -v` test proves commander passes `node` as the command and `-v` as its first argument.

- [ ] **Step 8: Commit Task 4**

Run:

```bash
cd D:/remote-agent-gateway && git add apps/cli/src && git commit -m "feat(cli): add jobs files and frp commands"
```

Expected: commit succeeds.

---

## Task 5: Add project-owned skill and Pi skill copy installer

**Files:**
- Create: `skills/rag-agent/SKILL.md`
- Create: `skills/rag-agent/references/cli.md`
- Create: `skills/rag-agent/references/workflows.md`
- Create: `skills/rag-agent/references/api-map.md`
- Create: `scripts/install-pi-skill.ts`
- Create: `scripts/install-pi-skill.test.ts`
- Modify: `package.json`

- [ ] **Step 1: Write failing installer tests**

Create `scripts/install-pi-skill.test.ts`:

```ts
import { mkdtempSync, writeFileSync, existsSync, readFileSync, mkdirSync } from 'node:fs';
import { rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { installPiSkill } from './install-pi-skill.js';

const tempDirs: string[] = [];

function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'rag-skill-install-'));
  tempDirs.push(dir);
  return dir;
}

afterEach(async () => {
  for (const dir of tempDirs.splice(0)) await rm(dir, { recursive: true, force: true });
});

describe('installPiSkill', () => {
  it('copies project skill to target and replaces stale files', async () => {
    const root = tempDir();
    const source = join(root, 'skills', 'rag-agent');
    const target = join(root, 'home', '.pi', 'agent', 'skills', 'rag-agent');
    mkdirSync(source, { recursive: true });
    mkdirSync(target, { recursive: true });
    writeFileSync(join(source, 'SKILL.md'), 'new skill');
    writeFileSync(join(target, 'stale.txt'), 'stale');

    const result = await installPiSkill({ source, target });

    expect(result.source).toBe(source);
    expect(result.target).toBe(target);
    expect(readFileSync(join(target, 'SKILL.md'), 'utf8')).toBe('new skill');
    expect(existsSync(join(target, 'stale.txt'))).toBe(false);
  });
});
```

- [ ] **Step 2: Run installer test and verify it fails**

Run:

```bash
cd D:/remote-agent-gateway && npx vitest run scripts/install-pi-skill.test.ts
```

Expected: FAIL because `scripts/install-pi-skill.ts` does not exist.

- [ ] **Step 3: Implement Node/TypeScript copy installer**

Create `scripts/install-pi-skill.ts`:

```ts
import { cp, mkdir, rm, stat } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export interface InstallPiSkillOptions {
  source?: string;
  target?: string;
}

export interface InstallPiSkillResult {
  source: string;
  target: string;
}

export async function installPiSkill(options: InstallPiSkillOptions = {}): Promise<InstallPiSkillResult> {
  const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
  const source = options.source ?? join(repoRoot, 'skills', 'rag-agent');
  const target = options.target ?? join(homedir(), '.pi', 'agent', 'skills', 'rag-agent');

  const sourceStat = await stat(source);
  if (!sourceStat.isDirectory()) throw new Error(`Skill source is not a directory: ${source}`);

  await rm(target, { recursive: true, force: true });
  await mkdir(dirname(target), { recursive: true });
  await cp(source, target, { recursive: true });
  return { source, target };
}

async function main(): Promise<void> {
  const result = await installPiSkill();
  console.log(`Installed rag-agent skill to ${result.target}`);
  console.log('Restart Pi Agent or reload skills to use /skill:rag-agent.');
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
```

- [ ] **Step 4: Add project skill files**

Create `skills/rag-agent/SKILL.md`:

```markdown
---
name: rag-agent
description: Control remote machines through Remote Agent Gateway using the bundled AI-agent-first CLI. Use when the user wants to list remote clients, run commands or scripts, read/write/upload/download files, manage FRP tunnels, inspect job status, or review remote operation audit history.
---

# Remote Agent Gateway Agent Skill

Use the bundled `rag` CLI first. Do not hand-write curl unless the CLI is unavailable or broken.

## First Steps

Always start with diagnostics and discovery:

```bash
rag doctor
rag clients list
```

If server configuration is missing, ask the user for the server URL and token, or use environment variables:

```text
RAG_SERVER_URL=http://your-server:3000
RAG_AGENT_TOKEN=your-agent-token
```

## Operating Rules

- Every client operation must explicitly pass `--client <clientId>`.
- Parse CLI output as JSON: check `ok`; then read `data` or `error`.
- Use `jobs` for live command/script execution.
- Use `tasks` for server-side audit history.
- Ask for user confirmation before destructive operations:
  - `rag files delete ...`
  - `rag files write ...` when overwriting important files
  - `rag frp delete ...`
  - `rag jobs cancel ...`

## Common Commands

```bash
rag clients list
rag clients get --client <clientId>
rag jobs run --client <clientId> -- node -v
rag files roots --client <clientId>
rag files read --client <clientId> --root root-0 --path README.md
rag frp list --client <clientId>
rag tasks list --client <clientId>
```

## References

- Full CLI reference: `references/cli.md`
- Common workflows: `references/workflows.md`
- API mapping: `references/api-map.md`
```

Create `skills/rag-agent/references/cli.md`:

```markdown
# RAG CLI Reference

## Global Configuration

```bash
rag --server <url> --token <token> <command>
rag --config <path> <command>
```

Environment variables:

```text
RAG_SERVER_URL=http://your-server:3000
RAG_AGENT_TOKEN=your-agent-token
```

## Output

Success:

```json
{"ok":true,"data":{}}
```

Error:

```json
{"ok":false,"error":{"code":"HTTP_ERROR","message":"Client not found","status":404}}
```

## Commands

```bash
rag config show
rag doctor
rag doctor --client <clientId>
rag clients list
rag clients get --client <clientId>
rag jobs run --client <clientId> -- <command> [args...]
rag jobs script --client <clientId> --file ./script.js
rag jobs script --client <clientId> --inline "console.log(1)"
rag jobs get --client <clientId> --job <jobId>
rag jobs logs --client <clientId> --job <jobId> --since-seq 0 --limit 500
rag jobs events --client <clientId> --job <jobId>
rag jobs cancel --client <clientId> --job <jobId>
rag files roots --client <clientId>
rag files list --client <clientId> --root root-0 --path .
rag files stat --client <clientId> --root root-0 --path README.md
rag files read --client <clientId> --root root-0 --path README.md
rag files read --client <clientId> --root root-0 --path README.md --raw
rag files write --client <clientId> --root root-0 --path out.txt --content "hello"
rag files upload --client <clientId> --root root-0 --path . --file ./local.zip
rag files download --client <clientId> --root root-0 --path remote.zip --output ./remote.zip
rag files mkdir --client <clientId> --root root-0 --path logs --recursive
rag files delete --client <clientId> --root root-0 --path logs --recursive
rag files move --client <clientId> --root root-0 --from a.txt --to b.txt --overwrite
rag files copy --client <clientId> --root root-0 --from a.txt --to b.txt --overwrite
rag frp list --client <clientId>
rag frp create --client <clientId> --name web --type tcp --local-port 3000
rag frp delete --client <clientId> --mapping <mappingId>
rag tasks list --client <clientId>
rag tasks get --record <recordId>
```
```

Create `skills/rag-agent/references/workflows.md`:

```markdown
# RAG Agent Workflows

## Discover Clients

```bash
rag doctor
rag clients list
rag clients get --client <clientId>
```

## Execute a Remote Command

```bash
rag jobs run --client <clientId> -- node -v
rag jobs get --client <clientId> --job <jobId>
rag jobs logs --client <clientId> --job <jobId>
```

## Read a Remote File

```bash
rag files roots --client <clientId>
rag files read --client <clientId> --root root-0 --path README.md
```

## Upload and Run a Script

```bash
rag files upload --client <clientId> --root root-0 --path . --file ./deploy.ps1 --filename deploy.ps1
rag jobs run --client <clientId> -- powershell -File deploy.ps1
```

## Expose a Service

```bash
rag frp create --client <clientId> --name web --type tcp --local-port 3000
rag frp delete --client <clientId> --mapping <mappingId>
```

## Review Audit History

```bash
rag tasks list --client <clientId>
rag tasks get --record <recordId>
```
```

Create `skills/rag-agent/references/api-map.md`:

```markdown
# CLI to API Map

```text
rag clients list
  -> GET /api/clients

rag clients get --client <id>
  -> GET /api/clients/:id

rag jobs run
  -> GET /api/clients/:id
  -> POST {clientHttpBaseUrl}/jobs/command

rag jobs script
  -> GET /api/clients/:id
  -> POST {clientHttpBaseUrl}/jobs/script

rag files read
  -> GET /api/clients/:id
  -> GET {clientHttpBaseUrl}/files/read?rootId=...&path=...

rag files write
  -> GET /api/clients/:id
  -> PUT {clientHttpBaseUrl}/files/write?rootId=...&path=...

rag frp create
  -> GET /api/clients/:id
  -> POST {clientHttpBaseUrl}/frp/mappings

rag tasks list
  -> GET /api/tasks
```

Do not use old `/api/agent/*` routes as the primary interface.
```

- [ ] **Step 5: Add package script for skill installer**

Modify root `package.json` scripts to include:

```json
"dev:cli": "pnpm --filter @rag/cli dev",
"build:cli": "pnpm --filter @rag/cli build",
"install:pi-skill": "tsx scripts/install-pi-skill.ts"
```

Keep existing scripts unchanged.

- [ ] **Step 6: Run installer tests and install smoke test**

Run:

```bash
cd D:/remote-agent-gateway && npx vitest run scripts/install-pi-skill.test.ts && pnpm install:pi-skill
```

Expected: test PASS; install command prints `Installed rag-agent skill to ...\.pi\agent\skills\rag-agent` on Windows or `.../.pi/agent/skills/rag-agent` on Unix.

- [ ] **Step 7: Commit Task 5**

Run:

```bash
cd D:/remote-agent-gateway && git add skills/rag-agent scripts/install-pi-skill.ts scripts/install-pi-skill.test.ts package.json && git commit -m "feat(skill): add project rag-agent skill installer"
```

Expected: commit succeeds.

---

## Task 6: Replace wrappers, update docs, remove stale skill, and run full validation

**Files:**
- Modify: `bin/rag`
- Modify: `bin/rag.bat`
- Modify: `README.md`
- Modify: `docs/TESTING.md`
- Remove: `.claude/skills/rag-agent/`

- [ ] **Step 1: Build CLI before wrapper replacement**

Run:

```bash
cd D:/remote-agent-gateway && pnpm --filter @rag/cli build
```

Expected: exit 0 and `apps/cli/dist/index.js` exists.

- [ ] **Step 2: Replace `bin/rag` wrapper**

Replace `bin/rag` complete content with:

```js
#!/usr/bin/env node
import { run } from '../apps/cli/dist/index.js';

await run();
```

- [ ] **Step 3: Replace `bin/rag.bat` wrapper**

Replace `bin/rag.bat` complete content with:

```bat
@echo off
setlocal
set SCRIPT_DIR=%~dp0
node "%SCRIPT_DIR%..\apps\cli\dist\index.js" %*
```

- [ ] **Step 4: Smoke test wrappers**

Run:

```bash
cd D:/remote-agent-gateway && node bin/rag --help
```

Expected: output contains `Remote Agent Gateway AI-agent-first CLI` and command groups `clients`, `jobs`, `files`, `frp`, `tasks`, `doctor`.

On Windows, also run:

```bat
cd D:\remote-agent-gateway && bin\rag.bat --help
```

Expected: same help output.

- [ ] **Step 5: Remove stale `.claude/skills/rag-agent`**

Run:

```bash
cd D:/remote-agent-gateway && rm -rf .claude/skills/rag-agent
```

Expected: directory no longer exists. Do not remove other `.claude/skills/*` directories.

- [ ] **Step 6: Update README CLI section**

Modify `README.md` to add this section near the development commands or AI Agent usage area:

```markdown
## AI Agent CLI

The repository includes an AI-agent-first CLI in `apps/cli`.

Configuration can be supplied with environment variables:

```text
RAG_SERVER_URL=http://your-server:3000
RAG_AGENT_TOKEN=your-agent-token
```

Common commands:

```bash
pnpm build:cli
node bin/rag doctor
node bin/rag clients list
node bin/rag clients get --client <clientId>
node bin/rag jobs run --client <clientId> -- node -v
node bin/rag files roots --client <clientId>
node bin/rag files read --client <clientId> --root root-0 --path README.md
node bin/rag frp list --client <clientId>
node bin/rag tasks list --client <clientId>
```

All structured output is JSON. Client operations must explicitly pass `--client <clientId>`.
```

Also add project skill installation:

```markdown
## Project Skill for Pi Agent

The project-owned skill source lives at `skills/rag-agent/`.

Install it into Pi Agent user skills with:

```bash
pnpm install:pi-skill
```

This copies the skill to `~/.pi/agent/skills/rag-agent`. Restart Pi Agent or reload skills after installing.
```

- [ ] **Step 7: Update testing docs**

Append this section to `docs/TESTING.md`:

```markdown
## CLI and Skill Validation

```bash
pnpm --filter @rag/cli test
pnpm --filter @rag/cli typecheck
pnpm --filter @rag/cli build
node bin/rag --help
pnpm install:pi-skill
```

On Windows, verify the batch wrapper:

```bat
bin\rag.bat --help
```

Expected: CLI tests pass, typecheck passes, build succeeds, wrapper help prints command groups, and the skill installer copies `skills/rag-agent` to the Pi user skill directory.
```

- [ ] **Step 8: Run full validation**

Run:

```bash
cd D:/remote-agent-gateway && pnpm --filter @rag/cli test && pnpm --filter @rag/cli typecheck && pnpm --filter @rag/cli build && pnpm build && pnpm test && pnpm typecheck && pnpm install:pi-skill
```

Expected:

- `@rag/cli` tests pass.
- `@rag/cli` typecheck exits 0.
- `@rag/cli` build exits 0.
- Workspace build exits 0.
- Workspace tests pass.
- Workspace typecheck exits 0.
- Skill installer prints installed path.

- [ ] **Step 9: Commit Task 6**

Run:

```bash
cd D:/remote-agent-gateway && git add bin/rag bin/rag.bat README.md docs/TESTING.md .claude/skills/rag-agent apps/cli package.json pnpm-lock.yaml && git commit -m "docs(cli): document agent cli and project skill"
```

Expected: commit succeeds. If `.claude/skills/rag-agent` was already absent, remove that path from `git add`.

---

## Final Verification Checklist

Run these commands after all tasks are complete:

```bash
cd D:/remote-agent-gateway
pnpm --filter @rag/cli test
pnpm --filter @rag/cli typecheck
pnpm --filter @rag/cli build
node bin/rag --help
pnpm build
pnpm test
pnpm typecheck
pnpm install:pi-skill
```

Expected final evidence:

- CLI test suite passes.
- CLI typecheck passes.
- CLI build creates `apps/cli/dist/index.js`.
- `node bin/rag --help` shows the new command groups.
- Workspace build, test, and typecheck pass.
- Skill installer copies `skills/rag-agent` into the Pi Agent user skills directory.

## Implementation Notes

- Keep all CLI output JSON by default except `files read --raw` and downloaded file bytes.
- Do not add old command aliases.
- Do not reintroduce `/api/agent/*` into the skill or CLI docs.
- Never print unmasked tokens.
- Use `--client` explicitly for every client-direct command.
- Current API payloads are defined by `apps/client/src/runtime/control-http/*` and `apps/server/src/modules/*`; use those files as the authority and never copy payload shapes from the old CLI.
