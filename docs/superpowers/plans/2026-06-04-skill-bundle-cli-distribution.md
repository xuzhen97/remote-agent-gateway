# Skill Bundle + Single-File CLI Distribution Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make `skills/rag-agent/` the complete distributable unit by bundling the CLI into `skills/rag-agent/dist/rag.js`, auto-building it during `install:pi-skill`, and rewriting documentation around the bundled entrypoint.

**Architecture:** Keep multi-file source code in `apps/cli/` for maintainability and testing, but add a distribution build pipeline that bundles `apps/cli/src/index.ts` into one Node-targeted file at `skills/rag-agent/dist/rag.js`. Repository wrappers (`bin/rag`, `bin/rag.bat`) remain for local development, while all skill/distribution docs and installation flows move to `node ./dist/rag.js ...`.

**Tech Stack:** Node.js 22+, TypeScript ESM, esbuild, tsx, Vitest, pnpm workspace.

---

## File Structure and Responsibilities

### New file

| File | Responsibility |
|---|---|
| `scripts/build-skill-cli.ts` | Bundle `apps/cli/src/index.ts` into `skills/rag-agent/dist/rag.js` as a single-file Node CLI artifact. |

### Files to modify

| File | Responsibility |
|---|---|
| `package.json` | Add `build:skill` and keep `install:pi-skill`; preserve existing developer scripts. |
| `scripts/install-pi-skill.ts` | Build the bundled CLI before copying the skill; verify the artifact exists. |
| `scripts/install-pi-skill.test.ts` | Cover auto-build + copy behavior with temp directories and an injected build hook. |
| `README.md` | Separate repository-local developer usage from distributable skill usage. |
| `skills/rag-agent/SKILL.md` | Make `node ./dist/rag.js ...` the canonical skill entrypoint. |
| `skills/rag-agent/references/cli.md` | Rewrite installation and usage docs around bundled `dist/rag.js`. |
| `skills/rag-agent/references/workflows.md` | Rewrite all command examples around the bundled CLI. |
| `skills/rag-agent/references/api-map.md` | Keep API semantics but frame examples around `node ./dist/rag.js ...`. |

### Files intentionally kept as-is in role (but not promoted)

| File | Role after migration |
|---|---|
| `apps/cli/*` | Source code and developer build output only |
| `bin/rag` | Repository-local developer wrapper |
| `bin/rag.bat` | Repository-local developer wrapper |

---

## Task 1: Add single-file skill bundle build pipeline

**Files:**
- Create: `scripts/build-skill-cli.ts`
- Modify: `package.json`

- [ ] **Step 1: Write the failing build script smoke test by using the shell contract**

Run this command before the build script exists:

```bash
cd D:/remote-agent-gateway && pnpm build:skill
```

Expected: FAIL because `build:skill` is not yet defined in `package.json`.

- [ ] **Step 2: Add the `build:skill` script to root `package.json`**

Modify the root `package.json` scripts block so it includes:

```json
"build:cli": "pnpm --filter @rag/cli build",
"build:skill": "tsx scripts/build-skill-cli.ts",
"install:pi-skill": "tsx scripts/install-pi-skill.ts"
```

Keep all other existing scripts unchanged.

- [ ] **Step 3: Create `scripts/build-skill-cli.ts`**

Create this complete file:

```ts
import * as esbuild from 'esbuild';
import * as fs from 'node:fs';
import * as path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..');
const SKILL_DIST = path.join(ROOT, 'skills', 'rag-agent', 'dist');
const OUTFILE = path.join(SKILL_DIST, 'rag.js');

fs.mkdirSync(SKILL_DIST, { recursive: true });

for (const file of fs.readdirSync(SKILL_DIST)) {
  if (file === 'rag.js' || file === 'rag.js.map') {
    fs.rmSync(path.join(SKILL_DIST, file), { force: true });
  }
}

await esbuild.build({
  entryPoints: [path.join(ROOT, 'apps', 'cli', 'src', 'index.ts')],
  bundle: true,
  platform: 'node',
  target: 'node22',
  format: 'esm',
  outfile: OUTFILE,
  minify: false,
  sourcemap: false,
  external: [],
  banner: {
    js: '#!/usr/bin/env node',
  },
});

console.log(`Bundled skill CLI: ${path.relative(ROOT, OUTFILE)}`);
```

- [ ] **Step 4: Run the new build pipeline**

Run:

```bash
cd D:/remote-agent-gateway && pnpm build:skill
```

Expected:
- exit 0
- console output includes `Bundled skill CLI: skills/rag-agent/dist/rag.js`
- file `skills/rag-agent/dist/rag.js` exists

- [ ] **Step 5: Verify the bundled artifact is actually executable with Node**

Run:

```bash
cd D:/remote-agent-gateway && node skills/rag-agent/dist/rag.js --help
```

Expected: help output contains `Remote Agent Gateway AI-agent-first CLI` and command groups `config`, `clients`, `jobs`, `files`, `frp`, `tasks`, `doctor`.

- [ ] **Step 6: Commit Task 1**

Run:

```bash
cd D:/remote-agent-gateway && git add package.json scripts/build-skill-cli.ts skills/rag-agent/dist/rag.js && git commit -m "feat(skill): add bundled single-file cli build"
```

---

## Task 2: Upgrade `install:pi-skill` from copy-only to build-then-copy

**Files:**
- Modify: `scripts/install-pi-skill.ts`
- Modify: `scripts/install-pi-skill.test.ts`

- [ ] **Step 1: Replace the installer test with build-aware behavior**

Replace `scripts/install-pi-skill.test.ts` with this complete content:

```ts
import { mkdtempSync, writeFileSync, existsSync, readFileSync, mkdirSync } from 'node:fs';
import { rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
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
  it('builds first, then copies the whole skill and replaces stale files', async () => {
    const root = tempDir();
    const source = join(root, 'skills', 'rag-agent');
    const dist = join(source, 'dist');
    const target = join(root, 'home', '.pi', 'agent', 'skills', 'rag-agent');
    mkdirSync(dist, { recursive: true });
    mkdirSync(target, { recursive: true });
    writeFileSync(join(source, 'SKILL.md'), 'skill content');
    writeFileSync(join(source, 'references.md'), 'ref content');
    writeFileSync(join(target, 'stale.txt'), 'stale');

    const buildSkillCli = vi.fn(async () => {
      writeFileSync(join(dist, 'rag.js'), '#!/usr/bin/env node\nconsole.log("ok")\n');
    });

    const result = await installPiSkill({ source, target, buildSkillCli });

    expect(buildSkillCli).toHaveBeenCalledTimes(1);
    expect(result.source).toBe(source);
    expect(result.target).toBe(target);
    expect(readFileSync(join(target, 'SKILL.md'), 'utf8')).toBe('skill content');
    expect(readFileSync(join(target, 'dist', 'rag.js'), 'utf8')).toContain('console.log("ok")');
    expect(existsSync(join(target, 'stale.txt'))).toBe(false);
  });
});
```

- [ ] **Step 2: Run the installer test to verify it fails first**

Run:

```bash
cd D:/remote-agent-gateway && npx vitest run scripts/install-pi-skill.test.ts
```

Expected: FAIL because `installPiSkill()` does not yet support `buildSkillCli` injection and does not verify `dist/rag.js`.

- [ ] **Step 3: Rewrite `scripts/install-pi-skill.ts`**

Replace the file with this complete content:

```ts
import { cp, mkdir, rm, stat } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export interface InstallPiSkillOptions {
  source?: string;
  target?: string;
  buildSkillCli?: () => Promise<void>;
}

export interface InstallPiSkillResult {
  source: string;
  target: string;
}

async function defaultBuildSkillCli(): Promise<void> {
  const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
  const script = join(repoRoot, 'scripts', 'build-skill-cli.ts');
  await import(`${pathToFileUrl(script)}?t=${Date.now()}`);
}

function pathToFileUrl(filePath: string): string {
  return new URL(`file://${filePath.replace(/\\/g, '/')}`).href;
}

export async function installPiSkill(options: InstallPiSkillOptions = {}): Promise<InstallPiSkillResult> {
  const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
  const source = options.source ?? join(repoRoot, 'skills', 'rag-agent');
  const target = options.target ?? join(homedir(), '.pi', 'agent', 'skills', 'rag-agent');
  const buildSkillCli = options.buildSkillCli ?? defaultBuildSkillCli;

  await buildSkillCli();

  const sourceStat = await stat(source);
  if (!sourceStat.isDirectory()) throw new Error(`Skill source is not a directory: ${source}`);

  const bundledCli = join(source, 'dist', 'rag.js');
  const bundledCliStat = await stat(bundledCli).catch(() => null);
  if (!bundledCliStat || !bundledCliStat.isFile()) {
    throw new Error(`Bundled skill CLI is missing: ${bundledCli}`);
  }

  await rm(target, { recursive: true, force: true });
  await mkdir(dirname(target), { recursive: true });
  await cp(source, target, { recursive: true });
  return { source, target };
}

async function main(): Promise<void> {
  const result = await installPiSkill();
  console.log(`Installed rag-agent skill to ${result.target}`);
  console.log('Bundled CLI entrypoint: node ./dist/rag.js --help');
  console.log('Restart Pi Agent or reload skills to use /skill:rag-agent.');
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
```

- [ ] **Step 4: Re-run the installer test**

Run:

```bash
cd D:/remote-agent-gateway && npx vitest run scripts/install-pi-skill.test.ts
```

Expected: PASS.

- [ ] **Step 5: Run the real install flow**

Run:

```bash
cd D:/remote-agent-gateway && pnpm install:pi-skill
```

Expected:
- it builds `skills/rag-agent/dist/rag.js`
- it installs `skills/rag-agent/` into `C:\Users\xuzhe\.pi\agent\skills\rag-agent`
- console output includes `Bundled CLI entrypoint: node ./dist/rag.js --help`

- [ ] **Step 6: Commit Task 2**

Run:

```bash
cd D:/remote-agent-gateway && git add scripts/install-pi-skill.ts scripts/install-pi-skill.test.ts skills/rag-agent/dist/rag.js && git commit -m "feat(skill): build bundled cli during skill install"
```

---

## Task 3: Rewrite skill-facing documentation around `node ./dist/rag.js`

**Files:**
- Modify: `skills/rag-agent/SKILL.md`
- Modify: `skills/rag-agent/references/cli.md`
- Modify: `skills/rag-agent/references/workflows.md`
- Modify: `skills/rag-agent/references/api-map.md`

- [ ] **Step 1: Rewrite `skills/rag-agent/SKILL.md`**

Replace the file with this complete content:

```markdown
---
name: rag-agent
description: Control remote machines through Remote Agent Gateway using the bundled AI-agent-first CLI. Use when the user wants to list remote clients, run commands or scripts, read/write/upload/download files, manage FRP tunnels, inspect job status, or review remote operation audit history.
---

# Remote Agent Gateway Agent Skill

Use the bundled CLI first. The canonical entrypoint is:

```bash
node ./dist/rag.js --help
```

Do not assume the original `remote-agent-gateway` repository exists. Do not assume `rag` is on PATH. The distributed skill bundle must work with only Node.js.

## CLI Availability Check

Before any operation:

```bash
node ./dist/rag.js --help
```

If `./dist/rag.js` is missing, the skill installation is incomplete. Ask the user to rebuild or reinstall the skill.

If the user also has a separate `rag` command on PATH, that is optional convenience only. The bundled CLI remains the canonical execution path.

## Configuration

The bundled CLI needs a server URL and token. Recommended configuration:

```text
RAG_SERVER_URL=http://your-server:3000
RAG_AGENT_TOKEN=your-agent-token
```

Run:

```bash
node ./dist/rag.js config show
```

to confirm the resolved configuration. Tokens are masked in output.

## First Steps

Always start with diagnostics and discovery:

```bash
node ./dist/rag.js doctor
node ./dist/rag.js clients list
```

## Operating Rules

- Every client operation must explicitly pass `--client <clientId>`.
- Parse CLI output as JSON: check `ok`; then read `data` or `error`.
- Use `jobs` for live command/script execution.
- Use `tasks` for server-side audit history.
- Ask for user confirmation before destructive operations:
  - `node ./dist/rag.js files delete ...`
  - `node ./dist/rag.js files write ...` when overwriting important files
  - `node ./dist/rag.js frp delete ...`
  - `node ./dist/rag.js jobs cancel ...`

## Common Commands

```bash
node ./dist/rag.js clients list
node ./dist/rag.js clients get --client <clientId>
node ./dist/rag.js jobs run --client <clientId> -- node -v
node ./dist/rag.js files roots --client <clientId>
node ./dist/rag.js files read --client <clientId> --root root-0 --path README.md
node ./dist/rag.js frp list --client <clientId>
node ./dist/rag.js tasks list --client <clientId>
```

Full command reference: `references/cli.md`  
Workflow examples: `references/workflows.md`  
API mapping: `references/api-map.md`
```

- [ ] **Step 2: Rewrite `skills/rag-agent/references/cli.md`**

Key requirements for the new content:
- Treat `node ./dist/rag.js ...` as the canonical distributed entrypoint
- Move repository-local `node bin/rag ...` under a separate “developer usage” note
- Remove `pnpm link --global` as a recommended path; keep it only as optional/future note if needed
- Keep environment variable configuration examples
- Keep JSON success/error examples
- Update all command examples to `node ./dist/rag.js ...`

Use this header section exactly at the top:

```markdown
# RAG CLI Reference

## Distribution Model

The distributed skill bundle includes its own bundled CLI artifact:

```text
skills/rag-agent/
├── SKILL.md
├── references/
└── dist/
    └── rag.js
```

Canonical entrypoint for distributed usage:

```bash
node ./dist/rag.js --help
```

This works after the skill is copied into another repository or installed into Pi, as long as Node.js is available.

## Developer Usage

Repository-local development can still use:

```bash
node bin/rag --help
```

but that is not the canonical distributed entrypoint.
```

Then keep the existing configuration, output, and command sections, but rewrite all command examples to use `node ./dist/rag.js ...`.

- [ ] **Step 3: Rewrite `skills/rag-agent/references/workflows.md`**

Rewrite all workflow commands from `rag ...` to `node ./dist/rag.js ...`.

The first block must become:

```markdown
# RAG Agent Workflows

## 1. Discover Clients

```bash
node ./dist/rag.js doctor
node ./dist/rag.js clients list
node ./dist/rag.js clients get --client <clientId>
```
```

Apply the same conversion to all workflow sections.

- [ ] **Step 4: Rewrite `skills/rag-agent/references/api-map.md`**

Keep the API semantics, but add this introductory block at the top:

```markdown
# CLI to Server/Client HTTP API Map

All examples below refer to the bundled distributed CLI:

```bash
node ./dist/rag.js ...
```

Client-targeting commands still follow the same two-step flow:
1. server discovery via `/api/clients/:clientId`
2. direct client HTTP operation via `clientHttpBaseUrl + clientHttpToken`
```

Then rewrite each command example from `rag ...` to `node ./dist/rag.js ...`.

- [ ] **Step 5: Run the installer again to refresh the installed skill docs**

Run:

```bash
cd D:/remote-agent-gateway && pnpm install:pi-skill
```

Expected: installed `C:\Users\xuzhe\.pi\agent\skills\rag-agent\SKILL.md` and `references/*.md` reflect the new bundled-CLI wording.

- [ ] **Step 6: Commit Task 3**

Run:

```bash
cd D:/remote-agent-gateway && git add skills/rag-agent && git commit -m "docs(skill): rewrite usage around bundled cli entrypoint"
```

---

## Task 4: Rewrite README around dual-mode usage

**Files:**
- Modify: `README.md`

- [ ] **Step 1: Replace the current CLI/skill docs section in `README.md`**

Rewrite the current CLI-related README content so it explicitly distinguishes:

### Mode 1: Repository-local developer usage

Must include exactly this example:

```markdown
## Repository-local Developer CLI Usage

For maintainers and contributors working inside this repository:

```bash
pnpm build:cli
node bin/rag doctor
node bin/rag clients list
```

This path depends on the repository layout and is intended for local development only.
```

### Mode 2: Distributed skill bundle usage

Must include exactly this example:

```markdown
## Distributed Skill Bundle Usage

Build the portable bundled CLI artifact into the skill directory:

```bash
pnpm build:skill
```

This produces:

```text
skills/rag-agent/
├── SKILL.md
├── references/
└── dist/
    └── rag.js
```

The canonical distributed entrypoint is:

```bash
node ./dist/rag.js doctor
node ./dist/rag.js clients list
```
```

Also include this exact explanatory paragraph:

```markdown
`skills/rag-agent/` is the distributable unit. After build, it contains its own bundled CLI artifact at `dist/rag.js` and can be copied into another repository or Pi skill directory without depending on the original monorepo layout.
```

### Pi installation subsection

Add:

```markdown
## Install the Skill into Pi

```bash
pnpm install:pi-skill
```

This command:
1. builds `skills/rag-agent/dist/rag.js`
2. verifies the bundled CLI exists
3. copies the whole `skills/rag-agent/` directory into `~/.pi/agent/skills/rag-agent/`

After installation, the installed skill remains self-contained and depends only on Node.js at runtime.
```

- [ ] **Step 2: Verify the new README text exists**

Run:

```bash
cd D:/remote-agent-gateway && grep -n "Repository-local Developer CLI Usage\|Distributed Skill Bundle Usage\|Install the Skill into Pi\|dist/rag.js" README.md
```

Expected: grep finds all four phrases.

- [ ] **Step 3: Commit Task 4**

Run:

```bash
cd D:/remote-agent-gateway && git add README.md && git commit -m "docs: separate developer cli usage from distributed skill usage"
```

---

## Task 5: Full validation for the new distribution model

**Files:**
- Verify: `skills/rag-agent/dist/rag.js`
- Verify: installed Pi skill directory

- [ ] **Step 1: Run CLI package tests**

Run:

```bash
cd D:/remote-agent-gateway && pnpm --filter @rag/cli test
```

Expected: all CLI tests pass.

- [ ] **Step 2: Run CLI typecheck and both build modes**

Run:

```bash
cd D:/remote-agent-gateway && pnpm --filter @rag/cli typecheck && pnpm build:cli && pnpm build:skill
```

Expected:
- typecheck exits 0
- `apps/cli/dist/index.js` exists
- `skills/rag-agent/dist/rag.js` exists

- [ ] **Step 3: Verify bundled artifact help output**

Run:

```bash
cd D:/remote-agent-gateway/skills/rag-agent && node ./dist/rag.js --help
```

Expected: help output shows `Remote Agent Gateway AI-agent-first CLI` and all command groups.

- [ ] **Step 4: Run install flow and verify installed artifact**

Run:

```bash
cd D:/remote-agent-gateway && pnpm install:pi-skill
```

Then verify:

```bash
node C:/Users/xuzhe/.pi/agent/skills/rag-agent/dist/rag.js --help
```

Expected: installed bundled CLI runs successfully with only Node.

- [ ] **Step 5: Run workspace validation**

Run:

```bash
cd D:/remote-agent-gateway && pnpm test && pnpm typecheck
```

Expected: workspace tests and typechecks pass.

- [ ] **Step 6: Commit Task 5**

Run:

```bash
cd D:/remote-agent-gateway && git add skills/rag-agent/dist/rag.js README.md scripts/build-skill-cli.ts scripts/install-pi-skill.ts scripts/install-pi-skill.test.ts skills/rag-agent && git commit -m "build(skill): bundle cli into distributable skill package"
```

---

## Final Verification Checklist

Run these commands after all tasks are complete:

```bash
cd D:/remote-agent-gateway
pnpm --filter @rag/cli test
pnpm --filter @rag/cli typecheck
pnpm build:cli
pnpm build:skill
node skills/rag-agent/dist/rag.js --help
pnpm install:pi-skill
node C:/Users/xuzhe/.pi/agent/skills/rag-agent/dist/rag.js --help
pnpm test
pnpm typecheck
```

Expected final evidence:

- `apps/cli` remains the multi-file source tree.
- `skills/rag-agent/dist/rag.js` exists and is runnable with Node.
- `install:pi-skill` builds before copying.
- Installed skill contains `dist/rag.js`.
- Skill docs and README treat `node ./dist/rag.js ...` as the canonical distributed entrypoint.
- Workspace tests and typechecks still pass.

## Implementation Notes

- Keep repository-local wrappers (`bin/rag`, `bin/rag.bat`) for development only.
- Do not remove `apps/cli/dist/` developer build output.
- Do not make PATH-based `rag` or `pnpm link --global` the primary distribution story.
- All distributed docs must assume only Node.js is available in the destination environment.
- The distributed unit is the full `skills/rag-agent/` directory, not `apps/cli/` and not root `bin/`.
