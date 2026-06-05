# Unified YAML Config Model Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the current mixed `.env` + `config.json` setup with a unified YAML-based configuration model for server and client, while preserving backward compatibility during the migration period.

**Architecture:** Keep two runtime-specific config files—`server.config.yaml` and `client.config.yaml`—but make both loaders follow the same lifecycle: locate config file, parse YAML, validate with Zod, normalize to the existing runtime shape, and optionally fall back to the legacy format. Most business code keeps using the existing flat runtime config shape, so the main refactor stays isolated inside the config layer, build/distribution scripts, and docs/tests.

**Tech Stack:** Node.js 22, TypeScript, Zod, YAML parser (`yaml`), Fastify, WebSocket `ws`, SQLite via `sql.js`, Vitest, existing dist/E2E scripts.

---

## File Structure

### Root templates and docs

- Create: `server.config.example.yaml`
  - New primary server configuration template.
- Create: `apps/client/client.config.example.yaml`
  - New primary client configuration template in source tree.
- Modify: `README.md`
  - Replace `.env`/`config.json` onboarding with YAML-first instructions.
- Modify: `docs/TESTING.md`
  - Update test harness config expectations to YAML.

### Server config layer

- Create: `apps/server/src/config/server.config.ts`
  - YAML loader, path discovery, env override, legacy `.env` fallback, typed result.
- Create: `apps/server/src/config/server.config.test.ts`
  - Unit tests for YAML-first and legacy fallback behavior.
- Modify: `apps/server/src/config/env.ts`
  - Thin compatibility wrapper exporting the current `env` shape from the new loader.
- Modify: `apps/server/src/main.ts`
  - Log the resolved config source path once at startup.

### Client config layer

- Modify: `apps/client/src/config/client.config.ts`
  - YAML loader, path discovery, env override, legacy `config.json` fallback, normalization to current `ClientConfig` shape.
- Modify: `apps/client/src/config/client.config.test.ts`
  - Unit tests for YAML-first, override behavior, legacy fallback, and frpc path resolution.
- Modify: `apps/client/src/main.ts`
  - Log the resolved client config path once at startup.

### Build/distribution/test scripts

- Modify: `scripts/build-all.ts`
  - Copy YAML templates/configs into `dist/`, update launcher scripts.
- Modify: `scripts/package.ts`
  - Package YAML templates and update deployment instructions.
- Modify: `scripts/e2e-test.ts`
  - Write `server.config.yaml` and `client.config.yaml` into `dist/`.
- Modify: `scripts/test-frp.ts`
  - Read/write YAML configs instead of `.env` + `config.json`.

### Package metadata

- Modify: `apps/server/package.json`
  - Add `yaml` runtime dependency.
- Modify: `apps/client/package.json`
  - Add `yaml` runtime dependency.

---

## Task 1: Implement the server YAML config loader with legacy `.env` fallback

**Files:**
- Create: `apps/server/src/config/server.config.ts`
- Create: `apps/server/src/config/server.config.test.ts`
- Modify: `apps/server/src/config/env.ts`
- Modify: `apps/server/src/main.ts`
- Modify: `apps/server/package.json`

- [ ] **Step 1: Write the failing server config tests**

Create `apps/server/src/config/server.config.test.ts`:

```ts
import { afterEach, describe, expect, it } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { loadServerConfig } from './server.config.js';

describe('loadServerConfig', () => {
  const originalArgv = [...process.argv];
  const originalEnv = { ...process.env };

  afterEach(() => {
    process.argv = [...originalArgv];
    process.env = { ...originalEnv };
  });

  it('loads server.config.yaml from an explicit path and applies env overrides', () => {
    const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), 'rag-server-config-'));
    const configPath = path.join(rootDir, 'server.config.yaml');
    fs.writeFileSync(configPath, `
server:
  host: 0.0.0.0
  port: 3000
auth:
  adminToken: yaml-admin
  agentApiToken: yaml-agent
storage:
  dbPath: ./storage/db.sqlite
  filesDir: ./storage/files
frp:
  mode: builtin
  host: ""
  port: 7000
  token: yaml-frp
  dashboardPort: 7500
  binPath: ./bin/frps
  portRange:
    start: 20000
    end: 25000
`);

    process.env.RAG_SERVER_PORT = '3300';

    const config = loadServerConfig(configPath);

    expect(config.source.format).toBe('yaml');
    expect(config.server.port).toBe(3300);
    expect(config.auth.adminToken).toBe('yaml-admin');
  });

  it('falls back to legacy .env when yaml config does not exist', () => {
    const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), 'rag-server-legacy-'));
    const envPath = path.join(rootDir, '.env');
    fs.writeFileSync(envPath, `SERVER_PORT=3001\nSERVER_HOST=127.0.0.1\nADMIN_TOKEN=legacy-admin\nAGENT_API_TOKEN=legacy-agent\nDB_PATH=./db.sqlite\nSTORAGE_DIR=./files\nFRP_MODE=remote\nFRPS_HOST=frps.example.com\nFRPS_PORT=7000\nFRPS_TOKEN=legacy-frp\nFRPS_DASHBOARD_PORT=7500\nFRPS_BIN_PATH=./bin/frps\nFRP_PORT_RANGE_START=21000\nFRP_PORT_RANGE_END=21050\n`);

    const config = loadServerConfig(undefined, { cwd: rootDir });

    expect(config.source.format).toBe('env');
    expect(config.server.host).toBe('127.0.0.1');
    expect(config.frp.host).toBe('frps.example.com');
  });

  it('rejects remote frp mode without host', () => {
    const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), 'rag-server-invalid-'));
    const configPath = path.join(rootDir, 'server.config.yaml');
    fs.writeFileSync(configPath, `
server:
  host: 0.0.0.0
  port: 3000
auth:
  adminToken: yaml-admin
  agentApiToken: yaml-agent
storage:
  dbPath: ./storage/db.sqlite
  filesDir: ./storage/files
frp:
  mode: remote
  host: ""
  port: 7000
  token: yaml-frp
  dashboardPort: 7500
  binPath: ./bin/frps
  portRange:
    start: 20000
    end: 25000
`);

    expect(() => loadServerConfig(configPath)).toThrow('frp.host is required when frp.mode=remote');
  });
});
```

- [ ] **Step 2: Run the server config tests and verify failure**

Run:

```bash
pnpm --filter @rag/server test -- server.config.test.ts
```

Expected: FAIL because `server.config.ts` does not exist yet.

- [ ] **Step 3: Add the YAML dependency to the server package**

Modify `apps/server/package.json` dependencies:

```json
{
  "dependencies": {
    "@fastify/cors": "^10.0.0",
    "@fastify/multipart": "^9.0.0",
    "@fastify/websocket": "^11.0.0",
    "@rag/shared": "workspace:*",
    "dotenv": "^16.4.0",
    "fastify": "^5.2.0",
    "pino": "^9.6.0",
    "pino-pretty": "^13.0.0",
    "sql.js": "^1.12.0",
    "uuid": "^11.0.0",
    "ws": "^8.18.0",
    "yaml": "^2.8.1",
    "zod": "^3.24.0"
  }
}
```

- [ ] **Step 4: Implement the server YAML loader**

Create `apps/server/src/config/server.config.ts`:

```ts
import { z } from 'zod';
import { config as loadDotenv } from 'dotenv';
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
    host: z.string().default(''),
    port: z.coerce.number().int().default(7000),
    token: z.string().default('change_me_frp_token'),
    dashboardPort: z.coerce.number().int().default(7500),
    binPath: z.string().default('./bin/frps'),
    portRange: z.object({
      start: z.coerce.number().int().default(20000),
      end: z.coerce.number().int().default(25000),
    }),
  }),
});

export type ServerConfig = z.infer<typeof ServerConfigSchema> & {
  source: { format: 'yaml' | 'env'; path: string };
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
  if (selected) {
    return path.resolve(cwd, selected);
  }
  return findUpward('server.config.yaml', cwd);
}

function readLegacyEnv(cwd = process.cwd()): ServerConfig | null {
  const envPath = findUpward('.env', cwd);
  if (!envPath) return null;

  loadDotenv({ path: envPath, override: true });

  const legacySchema = z.object({
    SERVER_PORT: z.coerce.number().int().positive().default(3000),
    SERVER_HOST: z.string().default('0.0.0.0'),
    ADMIN_TOKEN: z.string().min(1),
    AGENT_API_TOKEN: z.string().min(1),
    DB_PATH: z.string().default('./storage/db.sqlite'),
    STORAGE_DIR: z.string().default('./storage/files'),
    FRP_MODE: z.enum(['builtin', 'external', 'remote']).default('remote'),
    FRPS_HOST: z.string().default(''),
    FRPS_PORT: z.coerce.number().int().default(7000),
    FRPS_TOKEN: z.string().default('change_me_frp_token'),
    FRPS_DASHBOARD_PORT: z.coerce.number().int().default(7500),
    FRPS_BIN_PATH: z.string().default('./bin/frps'),
    FRP_PORT_RANGE_START: z.coerce.number().int().default(20000),
    FRP_PORT_RANGE_END: z.coerce.number().int().default(25000),
  });

  const env = legacySchema.parse(process.env);

  return {
    server: { host: env.SERVER_HOST, port: env.SERVER_PORT },
    auth: { adminToken: env.ADMIN_TOKEN, agentApiToken: env.AGENT_API_TOKEN },
    storage: { dbPath: env.DB_PATH, filesDir: env.STORAGE_DIR },
    frp: {
      mode: env.FRP_MODE,
      host: env.FRPS_HOST,
      port: env.FRPS_PORT,
      token: env.FRPS_TOKEN,
      dashboardPort: env.FRPS_DASHBOARD_PORT,
      binPath: env.FRPS_BIN_PATH,
      portRange: { start: env.FRP_PORT_RANGE_START, end: env.FRP_PORT_RANGE_END },
    },
    source: { format: 'env', path: envPath },
  };
}

function applyOverrides(config: ServerConfig): ServerConfig {
  const next: ServerConfig = structuredClone(config);

  if (process.env.RAG_SERVER_HOST) next.server.host = process.env.RAG_SERVER_HOST;
  if (process.env.RAG_SERVER_PORT) next.server.port = Number(process.env.RAG_SERVER_PORT);
  if (process.env.RAG_ADMIN_TOKEN) next.auth.adminToken = process.env.RAG_ADMIN_TOKEN;
  if (process.env.RAG_AGENT_API_TOKEN) next.auth.agentApiToken = process.env.RAG_AGENT_API_TOKEN;
  if (process.env.RAG_FRP_TOKEN) next.frp.token = process.env.RAG_FRP_TOKEN;

  return next;
}

function validateBusinessRules(config: ServerConfig): ServerConfig {
  if (config.frp.mode === 'remote' && !config.frp.host) {
    throw new Error('frp.host is required when frp.mode=remote');
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

  const legacy = readLegacyEnv(cwd);
  if (legacy) return validateBusinessRules(applyOverrides(legacy));

  throw new Error(
    'Server config not found. Create server.config.yaml or provide a legacy .env during the migration period.'
  );
}
```

- [ ] **Step 5: Make `env.ts` a compatibility wrapper over the new loader**

Replace `apps/server/src/config/env.ts` with:

```ts
import { loadServerConfig } from './server.config.js';

const serverConfig = loadServerConfig();

export const env = {
  SERVER_PORT: serverConfig.server.port,
  SERVER_HOST: serverConfig.server.host,
  ADMIN_TOKEN: serverConfig.auth.adminToken,
  AGENT_API_TOKEN: serverConfig.auth.agentApiToken,
  DB_PATH: serverConfig.storage.dbPath,
  STORAGE_DIR: serverConfig.storage.filesDir,
  FRP_MODE: serverConfig.frp.mode,
  FRPS_HOST: serverConfig.frp.host,
  FRPS_PORT: serverConfig.frp.port,
  FRPS_TOKEN: serverConfig.frp.token,
  FRPS_DASHBOARD_PORT: serverConfig.frp.dashboardPort,
  FRPS_BIN_PATH: serverConfig.frp.binPath,
  FRP_PORT_RANGE_START: serverConfig.frp.portRange.start,
  FRP_PORT_RANGE_END: serverConfig.frp.portRange.end,
} as const;

export type Env = typeof env;
export const envSource = serverConfig.source;

export function resolveFrpsHost(): string {
  if (env.FRP_MODE === 'remote') {
    if (!env.FRPS_HOST) {
      throw new Error('FRPS_HOST is required when FRP_MODE=remote');
    }
    return env.FRPS_HOST;
  }
  return env.SERVER_HOST === '0.0.0.0' ? '127.0.0.1' : env.SERVER_HOST;
}

export function buildFrpPublicUrl(remotePort: number): string {
  const host = env.FRP_MODE === 'remote' ? env.FRPS_HOST : env.SERVER_HOST;
  return `${host}:${remotePort}`;
}
```

- [ ] **Step 6: Log the resolved server config source at startup**

Modify the imports and startup log in `apps/server/src/main.ts`:

```ts
import { env, envSource } from './config/env.js';
```

Add after database initialization:

```ts
console.log(`Server config: ${envSource.path} (${envSource.format})`);
if (envSource.format === 'env') {
  console.warn('Using legacy .env config. Please migrate to server.config.yaml.');
}
```

- [ ] **Step 7: Run the server tests and typecheck**

Run:

```bash
pnpm --filter @rag/server test -- server.config.test.ts
pnpm --filter @rag/server typecheck
```

Expected: PASS.

- [ ] **Step 8: Commit the server config layer**

```bash
git add apps/server/package.json apps/server/src/config/server.config.ts apps/server/src/config/server.config.test.ts apps/server/src/config/env.ts apps/server/src/main.ts pnpm-lock.yaml
git commit -m "feat(server): add yaml-first config loader"
```

---

## Task 2: Implement the client YAML config loader with legacy `config.json` fallback

**Files:**
- Modify: `apps/client/src/config/client.config.ts`
- Modify: `apps/client/src/config/client.config.test.ts`
- Modify: `apps/client/src/main.ts`
- Modify: `apps/client/package.json`

- [ ] **Step 1: Expand the client config tests to cover YAML-first loading**

Replace `apps/client/src/config/client.config.test.ts` with:

```ts
import { afterEach, describe, expect, it } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { loadConfig } from './client.config.js';

describe('loadConfig', () => {
  const originalArgv = [...process.argv];
  const originalEnv = { ...process.env };

  afterEach(() => {
    process.argv = [...originalArgv];
    process.env = { ...originalEnv };
  });

  it('loads client.config.yaml and applies token override', () => {
    const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), 'rag-client-config-'));
    const configPath = path.join(rootDir, 'client.config.yaml');
    fs.writeFileSync(configPath, `
client:
  id: client-1
  name: Client 1
  tags:
    - dev
server:
  wsUrl: ws://localhost:3000/ws/client
  apiBaseUrl: http://localhost:3000
  token: yaml-token
workspace:
  dir: ./workspace
  allowedRoots:
    - ./workspace
frp:
  binPath: ./bin/frpc
  workDir: ./frp
`);

    const binDir = path.join(rootDir, 'bin');
    fs.mkdirSync(binDir, { recursive: true });
    fs.writeFileSync(path.join(binDir, process.platform === 'win32' ? 'frpc.exe' : 'frpc'), '');
    process.env.RAG_CLIENT_TOKEN = 'override-token';

    const config = loadConfig(configPath);

    expect(config.clientId).toBe('client-1');
    expect(config.token).toBe('override-token');
    expect(config.allowedRoots).toEqual(['./workspace']);
  });

  it('falls back to legacy config.json when yaml is absent', () => {
    const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), 'rag-client-legacy-'));
    const configPath = path.join(rootDir, 'config.json');
    fs.writeFileSync(configPath, JSON.stringify({
      clientId: 'legacy-client',
      clientName: 'Legacy Client',
      serverUrl: 'ws://localhost:3000/ws/client',
      apiBaseUrl: 'http://localhost:3000',
      token: 'legacy-token',
      workspaceDir: './workspace',
      allowedRoots: ['./workspace'],
      tags: ['legacy'],
    }));

    const config = loadConfig(undefined, { cwd: rootDir });

    expect(config.clientId).toBe('legacy-client');
    expect(config.serverUrl).toBe('ws://localhost:3000/ws/client');
  });

  it('resolves frpcPath upward from the yaml config directory', () => {
    const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), 'rag-client-frpc-'));
    const appDir = path.join(rootDir, 'apps', 'client');
    const binDir = path.join(rootDir, 'bin');
    fs.mkdirSync(appDir, { recursive: true });
    fs.mkdirSync(binDir, { recursive: true });
    const binaryName = process.platform === 'win32' ? 'frpc.exe' : 'frpc';
    fs.writeFileSync(path.join(binDir, binaryName), '');
    fs.writeFileSync(path.join(appDir, 'client.config.yaml'), `
client:
  id: client-1
  name: Client 1
server:
  wsUrl: ws://localhost:3000/ws/client
  apiBaseUrl: http://localhost:3000
  token: tok
workspace:
  dir: ./workspace
  allowedRoots:
    - ./workspace
frp:
  binPath: ./bin/frpc
  workDir: ./frp
`);

    const config = loadConfig(path.join(appDir, 'client.config.yaml'));

    expect(config.frpcPath).toBe(path.join(binDir, binaryName));
  });
});
```

- [ ] **Step 2: Run the client config tests and verify failure**

Run:

```bash
pnpm --filter @rag/client test -- client.config.test.ts
```

Expected: FAIL because the loader still expects only `config.json`.

- [ ] **Step 3: Add the YAML dependency to the client package**

Modify `apps/client/package.json` dependencies:

```json
{
  "dependencies": {
    "@rag/shared": "workspace:*",
    "execa": "^9.5.0",
    "fs-extra": "^11.3.0",
    "pino": "^9.6.0",
    "pino-pretty": "^13.0.0",
    "systeminformation": "^5.25.0",
    "ws": "^8.18.0",
    "yaml": "^2.8.1",
    "zod": "^3.24.0"
  }
}
```

- [ ] **Step 4: Replace the client loader with a YAML-first normalized loader**

Replace `apps/client/src/config/client.config.ts` with:

```ts
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

const LegacyClientConfigSchema = z.object({
  clientId: z.string().min(1),
  clientName: z.string().min(1),
  serverUrl: z.string().url(),
  apiBaseUrl: z.string().url(),
  token: z.string().min(1),
  workspaceDir: z.string().min(1),
  allowedRoots: z.array(z.string()).optional().default([]),
  frpcPath: z.string().optional(),
  frpcWorkDir: z.string().optional(),
  tags: z.array(z.string()).default([]),
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
  source?: { format: 'yaml' | 'json'; path: string };
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
    if (path.isAbsolute(configuredPath)) candidates.push(configuredPath);
    else candidates.push(path.resolve(configDir, configuredPath));
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

  return (
    findUpward('client.config.yaml', cwd)
    ?? findUpward('apps/client/client.config.yaml', cwd)
    ?? findUpward('config.json', cwd)
  );
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

function normalizeLegacyConfig(raw: z.infer<typeof LegacyClientConfigSchema>, configPath: string): ClientConfig {
  const configDir = path.dirname(path.resolve(configPath));
  return {
    ...raw,
    serverUrl: process.env.RAG_CLIENT_WS_URL ?? raw.serverUrl,
    apiBaseUrl: process.env.RAG_CLIENT_API_BASE_URL ?? raw.apiBaseUrl,
    token: process.env.RAG_CLIENT_TOKEN ?? raw.token,
    frpcPath: resolveExecutablePath(configDir, raw.frpcPath),
    source: { format: 'json', path: configPath },
  };
}

export function loadConfig(explicitPath?: string, options?: { cwd?: string }): ClientConfig {
  const cwd = options?.cwd ?? process.cwd();
  const configPath = resolveClientConfigPath(explicitPath, cwd);

  if (!configPath || !fs.existsSync(configPath)) {
    throw new Error('Client config not found. Create client.config.yaml or provide legacy config.json during migration.');
  }

  if (configPath.endsWith('.yaml') || configPath.endsWith('.yml')) {
    const raw = parseYaml(fs.readFileSync(configPath, 'utf-8'));
    return normalizeYamlConfig(ClientYamlSchema.parse(raw), configPath);
  }

  const raw = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
  return normalizeLegacyConfig(LegacyClientConfigSchema.parse(raw), configPath);
}
```

- [ ] **Step 5: Log the resolved client config path at startup**

Modify the startup logging in `apps/client/src/main.ts`:

```ts
  console.log(`Client config: ${config.source?.path ?? 'unknown'} (${config.source?.format ?? 'unknown'})`);
  if (config.source?.format === 'json') {
    console.warn('Using legacy config.json. Please migrate to client.config.yaml.');
  }
```

Add it after `config = loadConfig();` and before `Client ID:` logging.

- [ ] **Step 6: Run the client tests and typecheck**

Run:

```bash
pnpm --filter @rag/client test -- client.config.test.ts
pnpm --filter @rag/client typecheck
```

Expected: PASS.

- [ ] **Step 7: Commit the client config layer**

```bash
git add apps/client/package.json apps/client/src/config/client.config.ts apps/client/src/config/client.config.test.ts apps/client/src/main.ts pnpm-lock.yaml
git commit -m "feat(client): add yaml-first config loader"
```

---

## Task 3: Add YAML templates and switch build/package launchers to YAML-first distribution

**Files:**
- Create: `server.config.example.yaml`
- Create: `apps/client/client.config.example.yaml`
- Modify: `scripts/build-all.ts`
- Modify: `scripts/package.ts`

- [ ] **Step 1: Write the YAML template files**

Create `server.config.example.yaml`:

```yaml
server:
  host: 0.0.0.0
  port: 3000

auth:
  adminToken: change_me_admin_token
  agentApiToken: change_me_agent_token

storage:
  dbPath: ./storage/db.sqlite
  filesDir: ./storage/files

frp:
  mode: remote
  host: ""
  port: 7000
  token: change_me_frp_token
  dashboardPort: 7500
  binPath: ./bin/frps
  portRange:
    start: 20000
    end: 25000
```

Create `apps/client/client.config.example.yaml`:

```yaml
client:
  id: dev-client-01
  name: Development Machine
  tags:
    - dev

server:
  wsUrl: ws://localhost:3000/ws/client
  apiBaseUrl: http://localhost:3000
  token: test_agent_token

workspace:
  dir: ./workspace
  allowedRoots:
    - ./workspace

frp:
  binPath: ./bin/frpc
  workDir: ./frp
```

- [ ] **Step 2: Run the build once to capture current YAML-template failure**

Run:

```bash
pnpm build:dist
```

Expected: PASS build, but `dist/` still contains `.env.example` and `config.example.json` as primary templates instead of YAML; use this as the failing behavior baseline before the script change.

- [ ] **Step 3: Update `scripts/build-all.ts` to copy YAML templates/configs and generate YAML launchers**

Apply these exact replacements in `scripts/build-all.ts`:

```ts
// Copy server YAML template (always overwrite example)
fs.existsSync(path.join(ROOT, 'server.config.example.yaml')) &&
  fs.copyFileSync(path.join(ROOT, 'server.config.example.yaml'), path.join(DIST, 'server.config.example.yaml'));

// Copy active server config only if dist doesn't already have one
if (!fs.existsSync(path.join(DIST, 'server.config.yaml')) && fs.existsSync(path.join(ROOT, 'server.config.yaml'))) {
  fs.copyFileSync(path.join(ROOT, 'server.config.yaml'), path.join(DIST, 'server.config.yaml'));
}
```

Replace the client template copy with:

```ts
fs.existsSync(path.join(ROOT, 'apps/client/client.config.example.yaml')) &&
  fs.copyFileSync(path.join(ROOT, 'apps/client/client.config.example.yaml'), path.join(DIST, 'client.config.example.yaml'));

if (!fs.existsSync(path.join(DIST, 'client.config.yaml')) && fs.existsSync(path.join(ROOT, 'apps/client/client.config.yaml'))) {
  fs.copyFileSync(path.join(ROOT, 'apps/client/client.config.yaml'), path.join(DIST, 'client.config.yaml'));
}
```

Replace the launcher script bodies with:

```ts
fs.writeFileSync(path.join(DIST, 'start-server.bat'), [
  '@echo off',
  'title Remote Agent Gateway - Server',
  'echo Starting server...',
  'if not exist server.config.yaml copy server.config.example.yaml server.config.yaml',
  'echo Edit server.config.yaml to configure host, tokens and FRP settings',
  'node server.bundle.cjs',
  'pause',
].join('\r\n'));

fs.writeFileSync(path.join(DIST, 'start-client.bat'), [
  '@echo off',
  'title Remote Agent Gateway - Client',
  'echo Starting client agent...',
  'if not exist client.config.yaml copy client.config.example.yaml client.config.yaml',
  'echo Edit client.config.yaml to configure server URLs and token',
  'node client.bundle.cjs',
  'pause',
].join('\r\n'));
```

```ts
const shServer = [
  '#!/bin/bash',
  'echo "Starting Remote Agent Gateway Server..."',
  '[ ! -f server.config.yaml ] && cp server.config.example.yaml server.config.yaml && echo "Created server.config.yaml — edit to configure"',
  'node server.bundle.cjs',
].join('\n');

const shClient = [
  '#!/bin/bash',
  'echo "Starting Remote Agent Gateway Client..."',
  '[ ! -f client.config.yaml ] && cp client.config.example.yaml client.config.yaml && echo "Created client.config.yaml — edit to configure"',
  'node client.bundle.cjs',
].join('\n');
```

- [ ] **Step 4: Update `scripts/package.ts` to keep YAML artifacts and emit YAML deployment guidance**

Replace the `keepPatterns` array with:

```ts
  const keepPatterns = [
    /^server\.bundle\.cjs$/,
    /^client\.bundle\.cjs$/,
    /^sql-wasm\.wasm$/,
    /^server\.config\.example\.yaml$/,
    /^server\.config\.yaml$/,
    /^client\.config\.example\.yaml$/,
    /^client\.config\.yaml$/,
    /^start-server\.(bat|sh)$/,
    /^start-client\.(bat|sh)$/,
    /^web$/,
  ];
```

Replace the `DEPLOY.txt` content block with:

```ts
fs.writeFileSync(path.join(DIST, 'DEPLOY.txt'), [
  'Remote Agent Gateway — Deployment Guide',
  '==========================================',
  '',
  'Requirements: Node.js 22+',
  '',
  '── Server (public machine) ──',
  '1. Copy server.config.example.yaml to server.config.yaml and edit tokens/ports',
  '2. Run: node server.bundle.cjs',
  '   Or:  ./start-server.sh  /  start-server.bat',
  '',
  '── Client (internal machine) ──',
  '1. Copy client.config.example.yaml to client.config.yaml and edit:',
  '   - server.wsUrl / server.apiBaseUrl',
  '   - server.token (same as server auth.agentApiToken)',
  '   - frp.binPath if frpc is stored outside ./bin',
  '2. Run: node client.bundle.cjs',
  '   Or:  ./start-client.sh  /  start-client.bat',
  '',
  '── Legacy compatibility ──',
  'Legacy .env and config.json are still accepted during migration, but YAML is the primary format.',
  '',
  `Version: ${version}`,
  `Build date: ${new Date().toISOString().slice(0, 10)}`,
].join('\r\n'));
```

- [ ] **Step 5: Rebuild dist and verify the YAML artifacts are present**

Run:

```bash
pnpm build:dist
ls dist
```

Expected output includes:

```text
client.config.example.yaml
server.config.example.yaml
start-client.bat
start-client.sh
start-server.bat
start-server.sh
```

- [ ] **Step 6: Commit the distribution changes**

```bash
git add server.config.example.yaml apps/client/client.config.example.yaml scripts/build-all.ts scripts/package.ts
git commit -m "build: switch dist templates to yaml config"
```

---

## Task 4: Switch the automated test harnesses to YAML configs

**Files:**
- Modify: `scripts/e2e-test.ts`
- Modify: `scripts/test-frp.ts`

- [ ] **Step 1: Capture the current test harness assumptions**

Run:

```bash
pnpm test:e2e
```

Expected: PASS on the old harness, but it writes `dist/.env` and `dist/config.json`; that behavior is the migration target to replace.

- [ ] **Step 2: Update `scripts/e2e-test.ts` to write YAML configs into `dist/`**

Replace the config-writing block in `scripts/e2e-test.ts` with:

```ts
  fs.writeFileSync(path.join(DIST, 'server.config.yaml'), `
server:
  host: ${RUN_FRP_FILE_TESTS ? '127.0.0.1' : '0.0.0.0'}
  port: ${SERVER_PORT}

auth:
  adminToken: test_admin_token
  agentApiToken: test_agent_token

storage:
  dbPath: ./db.sqlite
  filesDir: ./files

frp:
  mode: ${RUN_FRP_FILE_TESTS ? 'builtin' : 'remote'}
  host: ""
  port: ${FRPS_PORT}
  token: test_frp_token
  dashboardPort: ${FRPS_DASHBOARD_PORT}
  binPath: ${frpsPath}
  portRange:
    start: ${FRP_PORT_RANGE_START}
    end: ${FRP_PORT_RANGE_END}
`.trim() + '\n');

  fs.writeFileSync(path.join(DIST, 'client.config.yaml'), `
client:
  id: ${CLIENT_ID}
  name: E2E Test Machine
  tags:
    - test
    - e2e

server:
  wsUrl: ws://localhost:${SERVER_PORT}/ws/client
  apiBaseUrl: ${BASE_URL}
  token: ${TOKEN}

workspace:
  dir: ./workspace
  allowedRoots:
    - ./workspace

frp:
${RUN_FRP_FILE_TESTS ? `  binPath: ${frpcPath}\n  workDir: ./frp` : '  {}'}
`.replace('\n  {}', '').trim() + '\n');
```

Then add cleanup for stale legacy files near the runtime cleanup section:

```ts
  fs.rmSync(path.join(DIST, 'config.json'), { force: true });
  fs.rmSync(path.join(DIST, '.env'), { force: true });
```

- [ ] **Step 3: Update `scripts/test-frp.ts` to read/write YAML configs**

Make these concrete replacements in `scripts/test-frp.ts`:

1. Replace the `TOKEN` initialization with YAML parsing:

```ts
import { parse as parseYaml } from 'yaml';
```

```ts
const serverConfig = parseYaml(fs.readFileSync(path.join(ROOT, 'server.config.yaml'), 'utf-8')) as {
  auth: { agentApiToken: string };
  frp: { host: string; port: number; token: string; binPath: string };
};
const TOKEN = serverConfig.auth.agentApiToken;
```

2. Replace the `.env` helper block with:

```ts
const FRPS_HOST = serverConfig.frp.host;
const FRPS_PORT = serverConfig.frp.port;
const FRPS_TOKEN = serverConfig.frp.token;
```

3. Replace the `dist` config writes with:

```ts
fs.writeFileSync(path.join(DIST, 'server.config.yaml'), fs.readFileSync(path.join(ROOT, 'server.config.yaml'), 'utf-8'));
```

```ts
fs.writeFileSync(path.join(DIST, 'client.config.yaml'), `
client:
  id: ${CLIENT_ID}
  name: FRP Test Machine
  tags:
    - test
    - frp

server:
  wsUrl: ws://localhost:3000/ws/client
  apiBaseUrl: http://localhost:3000
  token: ${TOKEN}

workspace:
  dir: ./workspace
  allowedRoots:
    - ./workspace

frp:
  binPath: ${frpcPath}
  workDir: ./frp
`.trim() + '\n');
```

4. Remove any remaining `.env` / `config.json` assumptions with:

```bash
rg -n "\.env|config\.json" scripts/e2e-test.ts scripts/test-frp.ts
```

Expected after edits: no remaining production-path references except legacy-migration comments.

- [ ] **Step 4: Run the E2E and FRP harnesses**

Run:

```bash
pnpm test:e2e
pnpm test:frp -- --no-start
```

Expected:
- `pnpm test:e2e` PASS using YAML files in `dist/`
- `pnpm test:frp -- --no-start` either PASS against an already running environment or fail only on external FRP availability, not on config parsing.

- [ ] **Step 5: Commit the harness migration**

```bash
git add scripts/e2e-test.ts scripts/test-frp.ts
git commit -m "test: switch harness configs to yaml"
```

---

## Task 5: Update README and testing docs to make YAML the primary operator experience

**Files:**
- Modify: `README.md`
- Modify: `docs/TESTING.md`

- [ ] **Step 1: Update quick-start instructions in `README.md`**

Replace the development setup snippets with:

```md
# 1. 配置服务端
cp server.config.example.yaml server.config.yaml
# 编辑 server.config.yaml，至少修改 auth.adminToken 和 auth.agentApiToken

# 2. 启动服务端
pnpm dev:server

# 3. 配置客户端（另一台机器或本机）
cp apps/client/client.config.example.yaml apps/client/client.config.yaml
# 编辑 client.config.yaml，填写 server.wsUrl、server.apiBaseUrl 和 server.token

# 4. 启动客户端
pnpm dev:client
```

Update the dist deployment examples to:

```md
cp server.config.example.yaml server.config.yaml
cp client.config.example.yaml client.config.yaml
```

And replace the old client example JSON with this YAML example:

```yaml
client:
  id: dev-client-01
  name: Development Machine
  tags:
    - dev

server:
  wsUrl: ws://localhost:3000/ws/client
  apiBaseUrl: http://localhost:3000
  token: test_agent_token

workspace:
  dir: ./workspace
  allowedRoots:
    - ./workspace
    - D:/

frp:
  binPath: ./bin/frpc
  workDir: ./frp
```

Also add one migration note near the setup section:

```md
> 兼容说明：当前版本仍可读取旧 `.env`（server）和 `config.json`（client），但推荐尽快迁移到 `server.config.yaml` 与 `client.config.yaml`。
```

- [ ] **Step 2: Update `docs/TESTING.md` to describe YAML-based harness setup**

Replace the “工作原理” step 2 with:

```md
├─ 2. 写入测试用 `server.config.yaml` 和 `client.config.yaml`
```

Replace the troubleshooting rows with:

```md
| `Client failed to register` | `client.config.yaml` 中 `server.token` 与 `server.config.yaml` 中 `auth.agentApiToken` 不匹配 | 检查 `auth.agentApiToken` 与 `server.token` |
| `404 Client not found` | `client.id` 与注册时不一致 | 确认 `CLIENT_ID` 常量与 `client.config.yaml` 一致 |
```

Update the manual-debug section to:

```md
# 2. 启动服务端（终端 1）
cd dist && cp server.config.example.yaml server.config.yaml && node server.bundle.cjs

# 3. 启动客户端（终端 2）
cd dist && cp client.config.example.yaml client.config.yaml && node client.bundle.cjs
```

- [ ] **Step 3: Verify the docs no longer present old config formats as the primary path**

Run:

```bash
rg -n "\.env.example|config.example.json|config.json" README.md docs/TESTING.md
```

Expected: only compatibility notes remain; primary setup instructions now reference `server.config.yaml` and `client.config.yaml`.

- [ ] **Step 4: Run the full verification suite**

Run:

```bash
pnpm --filter @rag/server test
pnpm --filter @rag/client test
pnpm test:e2e
pnpm typecheck
```

Expected: PASS.

- [ ] **Step 5: Commit the docs and final migration polish**

```bash
git add README.md docs/TESTING.md
git commit -m "docs: make yaml config the primary workflow"
```

---

## Task 6: Final migration review and release-readiness sweep

**Files:**
- Modify: any touched file above if review finds mismatches
- Review: `apps/server/src/config/server.config.ts`
- Review: `apps/client/src/config/client.config.ts`
- Review: `scripts/build-all.ts`
- Review: `scripts/package.ts`
- Review: `scripts/e2e-test.ts`
- Review: `README.md`
- Review: `docs/TESTING.md`

- [ ] **Step 1: Search for stale primary-format references**

Run:

```bash
rg -n --glob '!dist/**' --glob '!node_modules/**' "cp \.env.example \.env|config\.example\.json|config\.json|Edit \.env|Edit config\.json" .
```

Expected: matches exist only in compatibility notes, old design docs, or historical plans—not in active startup/build/operator guidance.

- [ ] **Step 2: Rebuild release artifacts and inspect them**

Run:

```bash
pnpm build:dist
pnpm package:win
ls dist
```

Expected `dist/` contains:

```text
client.bundle.cjs
client.config.example.yaml
server.bundle.cjs
server.config.example.yaml
start-client.bat
start-client.sh
start-server.bat
start-server.sh
sql-wasm.wasm
web/
```

- [ ] **Step 3: Smoke test the generated launchers manually**

Run:

```bash
cd dist
node server.bundle.cjs --config ./server.config.yaml
node client.bundle.cjs --config ./client.config.yaml
```

Expected:
- Server logs the resolved config path/format.
- Client logs the resolved config path/format.
- If legacy files are used instead, a deprecation warning appears.

- [ ] **Step 4: Create the final integration commit**

```bash
git add .
git commit -m "feat: unify server and client config workflows"
```

---

## Self-Review

### Spec coverage

- **Unified single-file config model for both runtimes:** Covered by Tasks 1–3.
- **YAML as primary format:** Covered by Tasks 1–5.
- **Legacy `.env` / `config.json` fallback:** Covered by Tasks 1–2 and smoke-checked in Task 6.
- **Build/dist/package alignment:** Covered by Task 3.
- **E2E/FRP script migration:** Covered by Task 4.
- **README/testing docs migration:** Covered by Task 5.
- **Operator-visible path/format logging and deprecation warnings:** Covered by Tasks 1–2 and verified in Task 6.

### Placeholder scan

- No `TODO`, `TBD`, or “similar to previous task” placeholders remain in the task steps.
- All tasks list exact file paths and concrete commands.
- All testing steps specify expected outcomes.

### Type/signature consistency

- Server business code keeps using `env.*`, so downstream server modules need minimal or no type changes.
- Client runtime code keeps using the flat `ClientConfig` shape (`clientId`, `serverUrl`, `token`, etc.), so downstream modules remain stable.
- YAML shape differences are isolated inside the loaders.

