# Remove Legacy Config Fallbacks Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove legacy `.env` / `.ragrc` example files and CLI fallback loading so runtime config is YAML-only while CLI uses only flags plus system environment variables.

**Architecture:** Keep server/client runtime config on explicit YAML files, but simplify CLI config resolution to a pure in-memory merge of parsed flags and `process.env`. Update dist packaging and docs so no generated or documented path suggests legacy key-value config files remain supported.

**Tech Stack:** TypeScript, Vitest, pnpm workspace scripts, Markdown docs

---

### Task 1: Lock CLI behavior with failing tests

**Files:**
- Modify: `apps/cli/src/config/config.test.ts`
- Test: `apps/cli/src/config/config.test.ts`

- [ ] **Step 1: Write the failing test**

Replace the legacy fallback tests with assertions that only flags and environment variables are used:

```ts
  it('does not read .ragrc or .env files', () => {
    const dir = tempDir();
    writeFileSync(join(dir, '.ragrc'), 'RAG_SERVER_URL=http://ragrc:3000\nRAG_AGENT_TOKEN=ragrc-token\n');
    writeFileSync(join(dir, '.env'), 'RAG_SERVER_URL=http://envfile:3000\nRAG_AGENT_TOKEN=envfile-token\n');

    const config = resolveConfig({ cwd: dir, argv: ['doctor'], env: {} });

    expect(config.serverUrl).toBe('');
    expect(config.token).toBe('');
    expect(config.sources).toEqual({});
  });

  it('does not read server.config.yaml for CLI defaults', () => {
    const dir = tempDir();
    writeFileSync(join(dir, 'server.config.yaml'), 'server:\n  host: 0.0.0.0\n  port: 3333\nauth:\n  agentApiToken: yaml-agent-token\n');

    const config = resolveConfig({ cwd: dir, argv: ['doctor'], env: {} });

    expect(config.serverUrl).toBe('');
    expect(config.token).toBe('');
    expect(config.sources).toEqual({});
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @rag/cli test -- src/config/config.test.ts`
Expected: FAIL because current implementation still loads `.ragrc`, `.env`, and `server.config.yaml`.

- [ ] **Step 3: Commit the red test**

```bash
git add apps/cli/src/config/config.test.ts
git commit -m "test(cli): lock env-only config resolution"
```

### Task 2: Remove CLI legacy fallback implementation

**Files:**
- Modify: `apps/cli/src/config/config.ts`
- Test: `apps/cli/src/config/config.test.ts`

- [ ] **Step 1: Write minimal implementation**

Simplify `resolveConfig()` and related types/helpers so CLI only reads flags and environment variables:

```ts
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
  };
}

export function resolveConfig(input: ResolveConfigInput = {}): RagCliConfig {
  const cwd = input.cwd ?? process.cwd();
  const argv = input.argv ?? process.argv.slice(2);
  const env = input.env ?? process.env;
  const { flags, rest } = parseGlobalFlags(argv);

  const explicitConfig = flags.config ? resolve(cwd, flags.config) : undefined;

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
    sources: explicitConfig ? { explicitConfig } : {},
  };
}
```

Then remove now-unused helpers/imports for key-value parsing, YAML parsing, and upward file search.

- [ ] **Step 2: Run tests to verify they pass**

Run: `pnpm --filter @rag/cli test -- src/config/config.test.ts`
Expected: PASS with all config tests green.

- [ ] **Step 3: Commit implementation**

```bash
git add apps/cli/src/config/config.ts apps/cli/src/config/config.test.ts
git commit -m "refactor(cli): remove legacy config fallbacks"
```

### Task 3: Remove obsolete example files and dist copying behavior

**Files:**
- Delete: `.env.example`
- Delete: `.ragrc.example`
- Modify: `scripts/build-all.ts`

- [ ] **Step 1: Write the failing packaging expectation**

Add/update assertions in existing build script tests if present; if no automated coverage exists, use a targeted grep-based verification step after code change. First inspect `scripts/build-all.ts` and remove references to:

```ts
f === '.env.example'
fs.copyFileSync(path.join(ROOT, 'server.config.example.yaml'), path.join(DIST, 'server.config.example.yaml'));
fs.copyFileSync(path.join(ROOT, 'client.config.example.yaml'), path.join(DIST, 'client.config.example.yaml'));
'[ ! -f server.config.yaml ] && cp server.config.example.yaml server.config.yaml ...'
'[ ! -f client.config.yaml ] && cp client.config.example.yaml client.config.yaml ...'
```

Replace startup hints with messages that require users to provide YAML config files explicitly, instead of auto-copying example templates in dist launch scripts.

- [ ] **Step 2: Apply file deletions and script cleanup**

Delete the files:

```bash
rm .env.example .ragrc.example
```

Then edit `scripts/build-all.ts` so dist packaging no longer includes or auto-copies legacy example config files.

- [ ] **Step 3: Run verification**

Run: `git grep -n "\.env\.example\|\.ragrc\.example" -- . ':(exclude)node_modules'`
Expected: no matches outside historical plan/spec documents.

Run: `git grep -n "server.config.example.yaml\|client.config.example.yaml" scripts/build-all.ts`
Expected: no matches.

- [ ] **Step 4: Commit packaging cleanup**

```bash
git add scripts/build-all.ts .
git commit -m "build: remove legacy example config packaging"
```

### Task 4: Update user-facing docs for YAML-only runtime and env-only CLI

**Files:**
- Modify: `README.md`
- Modify: `docs/TESTING.md`
- Modify: `docs/deployment-guide.md`

- [ ] **Step 1: Edit CLI config documentation**

In `README.md`, replace the old priority table with:

```md
配置解析顺序（高优先级覆盖低优先级）：

| 优先级 | 来源 | 示例 |
|--------|------|------|
| 1 | CLI flags | `--server http://...` `--token ...` |
| 2 | 系统环境变量 | `RAG_SERVER_URL`, `RAG_AGENT_TOKEN`, `RAG_ADMIN_TOKEN`, `RAG_AGENT_API_TOKEN`, `AGENT_API_TOKEN` |
```

Also add a note that CLI does **not** read `.env`, `.ragrc`, or `server.config.yaml`.

- [ ] **Step 2: Edit runtime config setup docs**

Update `README.md`, `docs/TESTING.md`, and `docs/deployment-guide.md` examples so they instruct users to create or copy YAML configs intentionally in source/dist directories, without mentioning `.env.example`, `.ragrc.example`, or auto-generated config-on-first-run behavior.

- [ ] **Step 3: Verify docs consistency**

Run: `git grep -n "\.ragrc\|\.env 文件\|配置解析顺序\|server.config.example.yaml\|client.config.example.yaml" README.md docs/TESTING.md docs/deployment-guide.md`
Expected: only intentional YAML-template references remain; no claim that CLI reads `.env`, `.ragrc`, or `server.config.yaml`.

- [ ] **Step 4: Commit doc updates**

```bash
git add README.md docs/TESTING.md docs/deployment-guide.md
git commit -m "docs: describe yaml runtime and env-only cli config"
```

### Task 5: Final verification sweep

**Files:**
- Verify only

- [ ] **Step 1: Run focused CLI tests**

Run: `pnpm --filter @rag/cli test -- src/config/config.test.ts`
Expected: PASS.

- [ ] **Step 2: Run repository-level checks for removed legacy support**

Run: `git grep -n "findUp('.ragrc'\|findUp('.env'\|serverUrlFromServerConfig\|readYamlFile\|readKeyValueFile" apps/cli/src/config/config.ts`
Expected: no matches.

Run: `git grep -n "\.env.example\|\.ragrc.example" -- . ':(exclude)node_modules'`
Expected: matches only in historical planning/spec docs, not runtime/docs/build files.

- [ ] **Step 3: Run workspace tests relevant to touched code**

Run: `pnpm --filter @rag/cli test && pnpm --filter @rag/cli typecheck`
Expected: PASS.

- [ ] **Step 4: Manual checklist against request**

Verify all are true:
- CLI uses only flags + system environment variables
- CLI does not read `.env`
- CLI does not read `.ragrc`
- CLI does not read `server.config.yaml`
- `.env.example` removed
- `.ragrc.example` removed
- runtime YAML examples/documentation remain coherent

- [ ] **Step 5: Commit final polish if needed**

```bash
git add -A
git commit -m "chore: finalize legacy config removal"
```
