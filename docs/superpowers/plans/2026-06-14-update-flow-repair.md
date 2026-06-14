# Remote Agent Gateway Update Flow Repair Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the update system meaningful end-to-end by connecting Web release/campaign management, Server artifact/status orchestration, Client self-update execution, `dist/` packaging, `start-client.*`, and `ecosystem.config.cjs` into one coherent update flow.

**Architecture:** Use a stable client launcher as the single process entrypoint for both manual scripts and PM2. Generate explicit client/server update artifacts and manifests from `dist/`, persist update status on the server, and implement client download/verify/extract/switch/restart/rollback incrementally. Server self-update remains disabled or explicit until a dedicated server launcher is implemented.

**Tech Stack:** TypeScript, Node.js 22+, esbuild CJS bundles, Fastify, WebSocket, sql.js, React + Ant Design, Vitest, PM2 ecosystem config, Windows `.bat`, Linux `.sh`.

---

## Current Gap Summary

### Web
- `apps/web/src/pages/UpdatesPage.tsx` provides release upload and campaign operations, but manifest fields are incomplete and campaign discovery/status observation is thin.
- `apps/web/src/api/updates.ts` lacks list-campaigns and attempts APIs.
- Artifact metadata is inferred by server filename heuristics rather than a strict contract.

### Server
- `apps/server/src/modules/updates/campaign-executor.ts` marks server update as succeeded even though server update is a placeholder.
- `apps/server/src/ws/ws-handlers.ts` only logs `client.update.status`; it does not update targets, attempts, campaign status, or save DB.
- `batchSize` and `maxConcurrency` are stored but not honored.
- `dispatched` is treated as a done state, so campaigns can complete immediately after dispatch.
- `baseUrl` for artifact download is derived from `SERVER_HOST`, which may be unreachable by clients.

### Client
- `apps/client/src/main.ts` wires `createClientUpdater()` to placeholder deps, so updates cannot really run.
- Client update handler only reports `downloading`, not final success/failure phases.
- Client main still has `0.1.0` hardcoded in log/currentVersion.
- No real download, sha256 verification, extraction, current pointer switch, restart, or rollback.

### dist / Package / PM2
- `scripts/build-all.ts` generates `start-client.bat/.sh` that run `client.bundle.cjs` directly.
- `ecosystem.config.cjs` runs `client.bundle.cjs` directly, bypassing any future launcher.
- `scripts/package.ts` creates full `rag-v<version>-win.zip` / `rag-v<version>-linux.tar.gz`, not update-specific client/server artifacts.
- `pnpm build` does not refresh `DEPLOY.txt`; stale `dist/DEPLOY.txt` can remain.

---

## Implementation Strategy

The work is split into safe milestones. Each milestone must be independently testable and should be committed separately.

1. **Entrypoint unification first** — add a minimal client launcher and make `start-client.*` plus `ecosystem.config.cjs` prefer it, with fallback to `client.bundle.cjs`.
2. **Stop fake success** — persist update status, remove hardcoded versions, and prevent server self-update from pretending to work.
3. **Define artifact contract** — strict manifest schema and package output that matches server selection logic.
4. **Implement client install path** — download, verify, extract, write pending state, report phases.
5. **Implement launcher switch/rollback** — restart into pending version, confirm ready, rollback on failure.
6. **Improve Web visibility** — campaign list, target errors, attempt timeline, polling.
7. **Only then consider server self-update** — via separate server launcher/supervisor strategy.

---

## File Structure Map

### New files
- `apps/client/src/launcher.ts` — stable launcher process for manual and PM2 startup.
- `apps/client/src/runtime/updates/current-version.ts` — read/write current, pending, previous version state.
- `apps/client/src/runtime/updates/download.ts` — artifact downloader.
- `apps/client/src/runtime/updates/verify.ts` — file size and sha256 verifier.
- `apps/client/src/runtime/updates/extract.ts` — archive extraction into staging/version directory.
- `apps/client/src/runtime/updates/update-deps.ts` — real `UpdaterDeps` factory used by `main.ts`.
- `packages/shared/src/update-schemas.ts` — Zod schemas for release manifest and update status/command payloads.
- `scripts/release-artifacts.ts` or added helpers in `scripts/package.ts` — build update artifacts and manifest.

### Existing files to modify
- `apps/client/src/main.ts` — use `CLIENT_VERSION`, real update deps, ready marker.
- `apps/client/src/runtime/updates/client-updater.ts` — phase callbacks and better failure states.
- `apps/client/src/runtime/updates/update-ws-handler.ts` — send full phase lifecycle.
- `apps/client/src/runtime/updates/version-layout.ts` — include deploy root and client/server namespacing if needed.
- `apps/client/src/config/client.config.ts` — optional updater config / deploy root derivation.
- `apps/server/src/main.ts` — use `SERVER_VERSION`, update public base URL config, disable fake server updater.
- `apps/server/src/ws/ws-handlers.ts` — persist `client.update.status`.
- `apps/server/src/modules/updates/update-repository.ts` — target/attempt/campaign persistence helpers.
- `apps/server/src/modules/updates/campaign-executor.ts` — attempt creation, dispatch semantics, no fake completion.
- `apps/server/src/modules/updates/campaign.service.ts` — target current version and capability filtering.
- `apps/server/src/modules/updates/release-manifest.ts` — strict schema validation.
- `apps/server/src/modules/updates/release.routes.ts` — path safety, artifact consistency validation.
- `apps/server/src/modules/updates/campaign.routes.ts` — list campaigns and attempts.
- `apps/web/src/api/updates.ts` — new APIs and richer types.
- `apps/web/src/pages/UpdatesPage.tsx` — campaign list, polling, errors, attempts.
- `scripts/build-all.ts` — build launcher, update launcher scripts, refresh `DEPLOY.txt`.
- `scripts/build-client.ts` — build launcher with client bundle.
- `scripts/package.ts` — include launcher and produce update artifacts/manifest.
- `ecosystem.config.cjs` — prefer `client-launcher.cjs`, fallback to `client.bundle.cjs`, set `RAG_DEPLOY_ROOT`.
- `scripts/ecosystem-config-layout-policy.test.cjs` — assert launcher-aware PM2 config.
- `scripts/package-scripts.test.cjs` and build policy tests as needed.
- `README.md` and `dist/DEPLOY.txt` generation text.

---

# Milestone 1: Unify Client Entrypoints

## Task 1.1: Add a minimal client launcher

**Files:**
- Create: `apps/client/src/launcher.ts`
- Test: `apps/client/src/launcher.test.ts`
- Modify: `apps/client/package.json` only if test/build script needs no change; otherwise avoid.

- [ ] **Step 1: Write failing launcher behavior tests**

Create `apps/client/src/launcher.test.ts` with tests covering:

```ts
import { describe, expect, it } from 'vitest';
import { resolveClientEntrypoint } from './launcher.js';

const root = process.platform === 'win32' ? 'C:/rag' : '/opt/rag';

describe('client launcher entrypoint resolution', () => {
  it('uses current-version entrypoint when state exists', () => {
    const result = resolveClientEntrypoint({
      deployRoot: root,
      currentVersion: { version: '1.0.1', entrypoint: 'versions/client/1.0.1/client.bundle.cjs' },
      bundleExists: () => true,
    });

    expect(result.version).toBe('1.0.1');
    expect(result.entrypoint).toContain('versions');
    expect(result.entrypoint).toContain('client.bundle.cjs');
  });

  it('falls back to root client.bundle.cjs for legacy deployments', () => {
    const result = resolveClientEntrypoint({
      deployRoot: root,
      currentVersion: null,
      bundleExists: (file) => file.endsWith('client.bundle.cjs'),
    });

    expect(result.version).toBe('bootstrap');
    expect(result.entrypoint).toContain('client.bundle.cjs');
  });
});
```

- [ ] **Step 2: Run failing test**

Run:

```bash
pnpm --filter @rag/client test -- launcher.test.ts
```

Expected: fail because `apps/client/src/launcher.ts` does not exist.

- [ ] **Step 3: Implement minimal launcher module**

Create `apps/client/src/launcher.ts` with:

```ts
import { existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { spawn } from 'node:child_process';

export interface CurrentVersionState {
  version: string;
  entrypoint: string;
}

export interface EntrypointResolutionInput {
  deployRoot: string;
  currentVersion: CurrentVersionState | null;
  bundleExists: (file: string) => boolean;
}

export interface EntrypointResolution {
  version: string;
  entrypoint: string;
}

export function readCurrentVersionState(deployRoot: string): CurrentVersionState | null {
  const file = join(deployRoot, 'state', 'client-current-version.json');
  if (!existsSync(file)) return null;
  const parsed = JSON.parse(readFileSync(file, 'utf8')) as CurrentVersionState;
  if (!parsed.version || !parsed.entrypoint) return null;
  return parsed;
}

export function resolveClientEntrypoint(input: EntrypointResolutionInput): EntrypointResolution {
  if (input.currentVersion) {
    const resolved = resolve(input.deployRoot, input.currentVersion.entrypoint);
    if (input.bundleExists(resolved)) {
      return { version: input.currentVersion.version, entrypoint: resolved };
    }
  }

  const legacy = join(input.deployRoot, 'client.bundle.cjs');
  if (input.bundleExists(legacy)) {
    return { version: 'bootstrap', entrypoint: legacy };
  }

  throw new Error(`No client bundle found under ${input.deployRoot}`);
}

export async function runLauncher(): Promise<void> {
  const deployRoot = resolve(process.env.RAG_DEPLOY_ROOT ?? process.cwd());
  const currentVersion = readCurrentVersionState(deployRoot);
  const resolved = resolveClientEntrypoint({
    deployRoot,
    currentVersion,
    bundleExists: existsSync,
  });

  console.log(`[launcher] starting client ${resolved.version}: ${resolved.entrypoint}`);
  const child = spawn(process.execPath, [resolved.entrypoint], {
    cwd: deployRoot,
    stdio: 'inherit',
    env: {
      ...process.env,
      RAG_DEPLOY_ROOT: deployRoot,
    },
  });

  child.on('exit', (code, signal) => {
    if (signal) process.kill(process.pid, signal);
    process.exit(code ?? 0);
  });
}

if (require.main === module) {
  runLauncher().catch((err) => {
    console.error('[launcher] fatal:', err instanceof Error ? err.message : err);
    process.exit(1);
  });
}
```

- [ ] **Step 4: Run test to pass**

Run:

```bash
pnpm --filter @rag/client test -- launcher.test.ts
```

Expected: pass.

- [ ] **Step 5: Commit**

```bash
git add apps/client/src/launcher.ts apps/client/src/launcher.test.ts
git commit -m "feat(client): add launcher entrypoint"
```

## Task 1.2: Build `client-launcher.cjs`

**Files:**
- Modify: `scripts/build-all.ts`
- Modify: `scripts/build-client.ts`
- Test: `scripts/build-script-policy.test.cjs` or new `scripts/client-launcher-build-policy.test.cjs`

- [ ] **Step 1: Write policy test**

Create `scripts/client-launcher-build-policy.test.cjs`:

```js
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert');

const root = path.join(__dirname, '..');
const buildAll = fs.readFileSync(path.join(root, 'scripts/build-all.ts'), 'utf8');
const buildClient = fs.readFileSync(path.join(root, 'scripts/build-client.ts'), 'utf8');

for (const [name, source] of [['build-all.ts', buildAll], ['build-client.ts', buildClient]]) {
  assert.ok(source.includes('apps/client/src/launcher.ts'), `${name} should build client launcher entrypoint`);
  assert.ok(source.includes('client-launcher.cjs'), `${name} should output client-launcher.cjs`);
  assert.ok(source.includes('process.env.RAG_BUILD_VERSION'), `${name} should inject build version into launcher`);
}

console.log('client launcher build policy is correct');
```

- [ ] **Step 2: Run failing policy test**

```bash
node scripts/client-launcher-build-policy.test.cjs
```

Expected: fail.

- [ ] **Step 3: Modify build scripts**

In `scripts/build-all.ts`, after client bundle build, add an esbuild build for:

```ts
await esbuild.build({
  entryPoints: [path.join(ROOT, 'apps/client/src/launcher.ts')],
  bundle: true,
  platform: 'node',
  target: 'node22',
  format: 'cjs',
  outfile: path.join(DIST, 'client-launcher.cjs'),
  minify: false,
  sourcemap: true,
  external: [],
  define: {
    'process.env.RAG_BUILD_VERSION': BUILD_VERSION,
  },
});
```

Do the same in `scripts/build-client.ts`.

- [ ] **Step 4: Run policy and build**

```bash
node scripts/client-launcher-build-policy.test.cjs
pnpm build
```

Expected:

```text
client launcher build policy is correct
...
client-launcher.cjs ready
```

- [ ] **Step 5: Commit**

```bash
git add scripts/build-all.ts scripts/build-client.ts scripts/client-launcher-build-policy.test.cjs
git commit -m "build: emit client launcher bundle"
```

## Task 1.3: Make manual startup scripts prefer launcher

**Files:**
- Modify: `scripts/build-all.ts`
- Test: `scripts/build-script-policy.test.cjs` or new `scripts/client-startup-policy.test.cjs`

- [ ] **Step 1: Write policy test**

Create `scripts/client-startup-policy.test.cjs`:

```js
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert');

const root = path.join(__dirname, '..');
const source = fs.readFileSync(path.join(root, 'scripts/build-all.ts'), 'utf8');

assert.ok(source.includes('client-launcher.cjs'), 'start-client scripts should mention client-launcher.cjs');
assert.ok(source.includes('node client-launcher.cjs'), 'start-client scripts should run launcher when present');
assert.ok(source.includes('node client.bundle.cjs'), 'start-client scripts should keep legacy bundle fallback');

console.log('client startup script policy is correct');
```

- [ ] **Step 2: Run failing test**

```bash
node scripts/client-startup-policy.test.cjs
```

Expected: fail until script generation is changed.

- [ ] **Step 3: Update generated `start-client.bat`**

Change `scripts/build-all.ts` generated BAT content to:

```bat
@echo off
title Remote Agent Gateway - Client
echo Starting client agent...
if not exist client.config.yaml echo Missing client.config.yaml. Create it before starting. && pause && exit /b 1
if exist client-launcher.cjs (
  node client-launcher.cjs
) else (
  node client.bundle.cjs
)
pause
```

- [ ] **Step 4: Update generated `start-client.sh`**

Change generated shell content to:

```sh
#!/bin/bash
echo "Starting Remote Agent Gateway Client..."
[ ! -f client.config.yaml ] && echo "Missing client.config.yaml. Create it before starting." && exit 1
if [ -f client-launcher.cjs ]; then
  node client-launcher.cjs
else
  node client.bundle.cjs
fi
```

- [ ] **Step 5: Validate**

```bash
node scripts/client-startup-policy.test.cjs
pnpm build
```

Then inspect:

```bash
rg -n "client-launcher|client.bundle" dist/start-client.bat dist/start-client.sh
```

Expected: both launcher and fallback are present.

- [ ] **Step 6: Commit**

```bash
git add scripts/build-all.ts scripts/client-startup-policy.test.cjs dist/start-client.bat dist/start-client.sh
git commit -m "build: route client startup scripts through launcher"
```

## Task 1.4: Make PM2 ecosystem prefer launcher

**Files:**
- Modify: `ecosystem.config.cjs`
- Modify: `scripts/ecosystem-config-layout-policy.test.cjs`

- [ ] **Step 1: Update policy test first**

Extend `scripts/ecosystem-config-layout-policy.test.cjs` with:

```js
assert.ok(source.includes('client-launcher.cjs'), 'ecosystem.config.cjs should know about client launcher');
assert.ok(source.includes('CLIENT_LAUNCHER'), 'ecosystem.config.cjs should define CLIENT_LAUNCHER');
assert.ok(source.includes('fs.existsSync(CLIENT_LAUNCHER)'), 'ecosystem.config.cjs should prefer launcher when present');
assert.ok(source.includes('RAG_DEPLOY_ROOT'), 'ecosystem.config.cjs should expose deployment root to launcher/updater');
```

- [ ] **Step 2: Run failing policy test**

```bash
node scripts/ecosystem-config-layout-policy.test.cjs
```

Expected: fail.

- [ ] **Step 3: Modify `ecosystem.config.cjs`**

Replace:

```js
const SERVER_SCRIPT = path.join(DIST_DIR, 'server.bundle.cjs');
const CLIENT_SCRIPT = path.join(DIST_DIR, 'client.bundle.cjs');
```

With:

```js
const SERVER_SCRIPT = path.join(DIST_DIR, 'server.bundle.cjs');
const CLIENT_LAUNCHER = path.join(DIST_DIR, 'client-launcher.cjs');
const CLIENT_BUNDLE = path.join(DIST_DIR, 'client.bundle.cjs');
const CLIENT_SCRIPT = fs.existsSync(CLIENT_LAUNCHER) ? CLIENT_LAUNCHER : CLIENT_BUNDLE;
```

Add to both server and client env if useful, at minimum client env:

```js
RAG_DEPLOY_ROOT: DIST_DIR,
```

Client env becomes:

```js
env: {
  NODE_ENV: 'production',
  RAG_CLIENT_CONFIG: path.join(DIST_DIR, 'client.config.yaml'),
  RAG_DEPLOY_ROOT: DIST_DIR,
},
```

- [ ] **Step 4: Validate**

```bash
node scripts/ecosystem-config-layout-policy.test.cjs
pnpm build
rg -n "client-launcher|RAG_DEPLOY_ROOT|CLIENT_SCRIPT" dist/ecosystem.config.cjs
```

Expected: copied `dist/ecosystem.config.cjs` includes launcher-aware logic.

- [ ] **Step 5: Commit**

```bash
git add ecosystem.config.cjs scripts/ecosystem-config-layout-policy.test.cjs dist/ecosystem.config.cjs
git commit -m "chore: make pm2 client entrypoint launcher-aware"
```

---

# Milestone 2: Stop Fake Update Success and Fix Version/Deploy Basics

## Task 2.1: Remove client version hardcoding in update flow

**Files:**
- Modify: `apps/client/src/main.ts`
- Test: `apps/client/src/main-version-policy.test.ts` or policy test under `scripts/`

- [ ] **Step 1: Write policy test**

Create `scripts/client-main-version-policy.test.cjs`:

```js
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert');

const root = path.join(__dirname, '..');
const source = fs.readFileSync(path.join(root, 'apps/client/src/main.ts'), 'utf8');

assert.ok(source.includes('CLIENT_VERSION'), 'client main should use CLIENT_VERSION');
assert.ok(!source.includes("currentVersion: '0.1.0'"), 'client update currentVersion must not be hardcoded');
assert.ok(!source.includes('客户端 Agent v0.1.0'), 'client startup log must not hardcode 0.1.0');

console.log('client main version policy is correct');
```

- [ ] **Step 2: Run failing policy test**

```bash
node scripts/client-main-version-policy.test.cjs
```

Expected: fail.

- [ ] **Step 3: Modify `apps/client/src/main.ts`**

Add import:

```ts
import { CLIENT_VERSION } from './version.js';
```

Change log to:

```ts
console.log(`Remote Agent Gateway - 客户端 Agent v${CLIENT_VERSION}`);
```

Change update handler context to:

```ts
currentVersion: CLIENT_VERSION,
```

- [ ] **Step 4: Validate**

```bash
node scripts/client-main-version-policy.test.cjs
pnpm --filter @rag/client typecheck
pnpm --filter @rag/client test
```

- [ ] **Step 5: Commit**

```bash
git add apps/client/src/main.ts scripts/client-main-version-policy.test.cjs
git commit -m "fix(client): use injected version in update flow"
```

## Task 2.2: Stop pretending server self-update works

**Files:**
- Modify: `apps/server/src/modules/updates/campaign-executor.ts`
- Modify: `apps/server/src/main.ts`
- Test: `apps/server/src/modules/updates/campaign-executor.test.ts`

- [ ] **Step 1: Write failing test**

Create `apps/server/src/modules/updates/campaign-executor.test.ts`:

```ts
import { describe, expect, it, vi } from 'vitest';
import { createCampaignExecutor } from './campaign-executor.js';

describe('campaign executor', () => {
  it('rejects server self-update until server updater is implemented', async () => {
    const executor = createCampaignExecutor({
      repo: {
        getCampaign: () => ({ id: 'camp_1', targetVersion: '1.0.1', status: 'draft', includeServer: true }),
        listTargets: () => [{ id: 'camp_1_server', campaignId: 'camp_1', targetType: 'server', phase: 'queued' }],
        updateCampaignStatus: vi.fn(),
        updateTargetPhase: vi.fn(),
      },
      releaseService: { resolveArtifact: vi.fn() },
      baseUrl: 'http://server:3000',
      allowServerSelfUpdate: false,
    } as any);

    await expect(executor.start('camp_1')).rejects.toThrow('Server self-update is not implemented');
  });
});
```

- [ ] **Step 2: Run failing test**

```bash
pnpm --filter @rag/server test -- campaign-executor.test.ts
```

Expected: fail until executor supports `allowServerSelfUpdate` guard.

- [ ] **Step 3: Modify `campaign-executor.ts`**

Extend deps:

```ts
allowServerSelfUpdate?: boolean;
```

At start of `includeServer` branch:

```ts
if (campaign.includeServer && !deps.allowServerSelfUpdate) {
  throw new Error('Server self-update is not implemented yet. Start a client-only campaign or deploy the server manually.');
}
```

Do not mark server target as succeeded unless a real server updater exists.

- [ ] **Step 4: Modify `main.ts`**

Pass:

```ts
allowServerSelfUpdate: false,
```

And change campaign runner version check:

```ts
verifyServerVersion: () => SERVER_VERSION,
```

- [ ] **Step 5: Validate**

```bash
pnpm --filter @rag/server test -- campaign-executor.test.ts campaign-runner.test.ts
pnpm --filter @rag/server typecheck
```

- [ ] **Step 6: Commit**

```bash
git add apps/server/src/modules/updates/campaign-executor.ts apps/server/src/modules/updates/campaign-executor.test.ts apps/server/src/main.ts
git commit -m "fix(server): block placeholder server self update"
```

## Task 2.3: Do not complete campaign at dispatched phase

**Files:**
- Modify: `apps/server/src/modules/updates/campaign-executor.ts`
- Test: `apps/server/src/modules/updates/campaign-executor.test.ts`

- [ ] **Step 1: Add failing test**

Append to `campaign-executor.test.ts`:

```ts
it('does not mark campaign completed while client targets are only dispatched', async () => {
  const updateCampaignStatus = vi.fn();
  const updateTargetPhase = vi.fn();
  const executor = createCampaignExecutor({
    repo: {
      getCampaign: () => ({ id: 'camp_1', targetVersion: '1.0.1', status: 'draft', includeServer: false }),
      listTargets: () => [{ id: 'target_1', campaignId: 'camp_1', targetType: 'client', clientId: 'client-1', phase: 'queued', platform: 'windows' }],
      updateCampaignStatus,
      updateTargetPhase,
      createAttempt: vi.fn(),
    },
    releaseService: { resolveArtifact: () => ({ fileName: 'rag-client-v1.0.1-windows-x64.zip', sha256: 'abc', size: 10 }) },
    baseUrl: 'http://server:3000',
    connectionManager: {
      getOnlineClientIds: () => ['client-1'],
      sendToClient: () => true,
    },
  } as any);

  const result = await executor.start('camp_1');

  expect(result.phase).toBe('client_updating');
  expect(updateCampaignStatus).toHaveBeenCalledWith('camp_1', 'client_updating');
  expect(updateCampaignStatus).not.toHaveBeenCalledWith('camp_1', 'completed');
});
```

- [ ] **Step 2: Refactor executor for injectable connection manager**

Currently it imports global `connectionManager`. For testability, update deps:

```ts
connectionManager?: {
  getOnlineClientIds(): string[];
  sendToClient(clientId: string, message: unknown): boolean;
};
```

Use:

```ts
const connections = deps.connectionManager ?? connectionManager;
```

- [ ] **Step 3: Fix done-state logic**

Only terminal phases count as done:

```ts
const terminal = new Set(['succeeded', 'failed', 'rolled_back', 'offline_skipped', 'cancelled']);
const allDone = updatedTargets.every((t) => terminal.has(t.phase));
```

If not all done, status remains `client_updating`.

- [ ] **Step 4: Validate**

```bash
pnpm --filter @rag/server test -- campaign-executor.test.ts
```

- [ ] **Step 5: Commit**

```bash
git add apps/server/src/modules/updates/campaign-executor.ts apps/server/src/modules/updates/campaign-executor.test.ts
git commit -m "fix(server): keep campaigns active after dispatch"
```

## Task 2.4: Refresh `DEPLOY.txt` during build

**Files:**
- Modify: `scripts/build-all.ts`
- Test: `scripts/build-deploy-version-policy.test.cjs`

- [ ] **Step 1: Write policy test**

Create `scripts/build-deploy-version-policy.test.cjs`:

```js
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert');

const root = path.join(__dirname, '..');
const source = fs.readFileSync(path.join(root, 'scripts/build-all.ts'), 'utf8');

assert.ok(source.includes('DEPLOY.txt'), 'build-all.ts should write DEPLOY.txt');
assert.ok(source.includes('Version:'), 'DEPLOY.txt content should include Version');
assert.ok(source.includes('BUILD_VERSION'), 'DEPLOY.txt should use root package build version');

console.log('build deploy version policy is correct');
```

- [ ] **Step 2: Run failing test**

```bash
node scripts/build-deploy-version-policy.test.cjs
```

- [ ] **Step 3: Add deploy text generation to `build-all.ts`**

After launcher scripts and before summary, write `dist/DEPLOY.txt` from root version.

Use unquoted value for display:

```ts
const DISPLAY_VERSION = ROOT_PACKAGE.version ?? '0.0.0';
```

Write content with:

```ts
`Version: ${DISPLAY_VERSION}`
```

- [ ] **Step 4: Validate**

```bash
node scripts/build-deploy-version-policy.test.cjs
pnpm build
rg -n "Version: 1.0.0" dist/DEPLOY.txt
```

- [ ] **Step 5: Commit**

```bash
git add scripts/build-all.ts scripts/build-deploy-version-policy.test.cjs dist/DEPLOY.txt
git commit -m "build: refresh deploy guide during dist build"
```

---

# Milestone 3: Strict Release Manifest and Artifact Contract

## Task 3.1: Add shared update schemas

**Files:**
- Create: `packages/shared/src/update-schemas.ts`
- Modify: `packages/shared/src/index.ts`
- Test: `packages/shared/src/__tests__/update-schemas.test.ts`

- [ ] **Step 1: Write schema tests**

Create tests validating:

```ts
import { describe, expect, it } from 'vitest';
import { ReleaseManifestSchema, ClientUpdateStatusPayloadSchema } from '../update-schemas.js';

describe('update schemas', () => {
  it('accepts a complete release manifest', () => {
    const result = ReleaseManifestSchema.safeParse({
      version: '1.0.1',
      releaseTime: '2026-06-14T00:00:00.000Z',
      notes: 'test release',
      minUpdaterVersion: '1.0.0',
      channel: 'stable',
      compatibleFrom: ['1.0.0'],
      artifacts: [{
        targetType: 'client',
        platform: 'windows',
        arch: 'x64',
        fileName: 'rag-client-v1.0.1-windows-x64.zip',
        downloadPath: '/updates/artifacts/1.0.1/rag-client-v1.0.1-windows-x64.zip',
        sha256: 'a'.repeat(64),
        size: 123,
        entrypoint: 'client.bundle.cjs',
        installerType: 'archive',
        enabled: true,
      }],
    });

    expect(result.success).toBe(true);
  });

  it('rejects incomplete manifests', () => {
    const result = ReleaseManifestSchema.safeParse({ version: '1.0.1', artifacts: [] });
    expect(result.success).toBe(false);
  });

  it('accepts client update status payload', () => {
    const result = ClientUpdateStatusPayloadSchema.safeParse({
      campaignId: 'camp_1',
      targetId: 'target_1',
      attemptId: 'attempt_1',
      phase: 'downloading',
      currentVersion: '1.0.0',
      targetVersion: '1.0.1',
    });
    expect(result.success).toBe(true);
  });
});
```

- [ ] **Step 2: Implement schemas**

Use Zod and export:

```ts
export const ReleaseArtifactSchema = z.object({ ... });
export const ReleaseManifestSchema = z.object({ ... });
export const ClientUpdateCommandPayloadSchema = z.object({ ... });
export const ClientUpdateStatusPayloadSchema = z.object({ ... });
```

- [ ] **Step 3: Export from shared index**

Add to `packages/shared/src/index.ts`:

```ts
export * from './update-schemas.js';
```

- [ ] **Step 4: Validate**

```bash
pnpm --filter @rag/shared test -- update-schemas.test.ts
pnpm --filter @rag/shared typecheck
```

- [ ] **Step 5: Commit**

```bash
git add packages/shared/src/update-schemas.ts packages/shared/src/__tests__/update-schemas.test.ts packages/shared/src/index.ts
git commit -m "feat(shared): add update protocol schemas"
```

## Task 3.2: Use strict manifest validation on server

**Files:**
- Modify: `apps/server/src/modules/updates/release-manifest.ts`
- Test: `apps/server/src/modules/updates/release.service.test.ts`

- [ ] **Step 1: Update tests to expect strict rejection**

Add test:

```ts
it('rejects manifests missing required release metadata', () => {
  const service = createReleaseService({
    repo: {
      saveRelease: () => undefined,
      getRelease: () => undefined,
      listReleases: () => [],
    },
    now: () => 1,
  } as any);

  expect(() => service.registerRelease(JSON.stringify({ version: '1.0.1', artifacts: [] }))).toThrow('Invalid release manifest');
});
```

- [ ] **Step 2: Implement strict parser**

In `release-manifest.ts`:

```ts
import { ReleaseManifestSchema } from '@rag/shared';

export function parseReleaseManifest(input: string): ReleaseManifest {
  const parsed = ReleaseManifestSchema.safeParse(JSON.parse(input));
  if (!parsed.success) {
    throw new Error(`Invalid release manifest: ${parsed.error.message}`);
  }
  return parsed.data;
}
```

- [ ] **Step 3: Validate**

```bash
pnpm --filter @rag/server test -- release.service.test.ts update-state.test.ts
pnpm --filter @rag/server typecheck
```

- [ ] **Step 4: Commit**

```bash
git add apps/server/src/modules/updates/release-manifest.ts apps/server/src/modules/updates/release.service.test.ts
git commit -m "fix(server): enforce release manifest schema"
```

---

# Milestone 4: Server Status Persistence

## Task 4.1: Add repository helpers for status and attempts

**Files:**
- Modify: `apps/server/src/modules/updates/update-repository.ts`
- Test: `apps/server/src/modules/updates/update-repository.test.ts`

- [ ] **Step 1: Write failing tests**

Add tests for:

- updating target phase with error fields
- incrementing attempt count
- creating/updating attempt timeline
- listing campaigns

Example:

```ts
it('updates target phase and persists error details', () => {
  repo.updateTargetPhase('target_1', 'failed', 'INSTALL_FAILED', 'boom');
  const target = repo.getTarget('target_1');
  expect(target?.phase).toBe('failed');
  expect(target?.lastErrorCode).toBe('INSTALL_FAILED');
  expect(target?.lastErrorMessage).toBe('boom');
});
```

- [ ] **Step 2: Implement helpers**

Add methods:

```ts
listCampaigns(): UpdateCampaignRecord[];
incrementTargetAttempt(id: string): void;
upsertAttemptPhase(input: { attemptId: string; targetId: string; phase: string; payload: unknown; terminal: boolean; errorCode?: string | null; errorMessage?: string | null }): void;
```

Use `phase_timeline_json` as JSON array of:

```ts
{ phase: string; at: number; payload: unknown }
```

- [ ] **Step 3: Validate**

```bash
pnpm --filter @rag/server test -- update-repository.test.ts
```

- [ ] **Step 4: Commit**

```bash
git add apps/server/src/modules/updates/update-repository.ts apps/server/src/modules/updates/update-repository.test.ts
git commit -m "feat(server): persist update target attempts"
```

## Task 4.2: Handle `client.update.status` in WebSocket server

**Files:**
- Modify: `apps/server/src/ws/ws-handlers.ts`
- Test: `apps/server/src/ws/ws-handlers.test.ts`

- [ ] **Step 1: Write failing WS test**

Add a test that sends:

```json
{
  "type": "client.update.status",
  "payload": {
    "campaignId": "camp_1",
    "targetId": "target_1",
    "attemptId": "attempt_1",
    "phase": "failed",
    "currentVersion": "1.0.0",
    "targetVersion": "1.0.1",
    "errorCode": "INSTALL_FAILED",
    "errorMessage": "boom"
  }
}
```

Assert repository helper is called to update phase/attempt. If current `ws-handlers.ts` uses singletons, first introduce injectable update status handler in a separate module.

- [ ] **Step 2: Extract update status handling module**

Create `apps/server/src/modules/updates/update-status-handler.ts`:

```ts
import { ClientUpdateStatusPayloadSchema } from '@rag/shared';
import { summarizeTargets, transitionCampaignStatus } from './update-state.js';

export function createUpdateStatusHandler(deps: { repo: any; saveDb: () => void }) {
  return {
    handle(payload: unknown) {
      const parsed = ClientUpdateStatusPayloadSchema.parse(payload);
      deps.repo.updateTargetPhase(parsed.targetId, parsed.phase, parsed.errorCode ?? null, parsed.errorMessage ?? null);
      deps.repo.upsertAttemptPhase({
        attemptId: parsed.attemptId,
        targetId: parsed.targetId,
        phase: parsed.phase,
        payload: parsed,
        terminal: ['succeeded', 'failed', 'rolled_back', 'cancelled'].includes(parsed.phase),
        errorCode: parsed.errorCode ?? null,
        errorMessage: parsed.errorMessage ?? null,
      });

      const targets = deps.repo.listTargets(parsed.campaignId);
      const terminal = new Set(['succeeded', 'failed', 'rolled_back', 'offline_skipped', 'cancelled']);
      if (targets.length > 0 && targets.every((t: { phase: string }) => terminal.has(t.phase))) {
        deps.repo.updateCampaignStatus(parsed.campaignId, transitionCampaignStatus(summarizeTargets(targets)));
      }
      deps.saveDb();
    },
  };
}
```

- [ ] **Step 3: Wire into `ws-handlers.ts`**

Replace console-only branch with handler call. Avoid circular imports by initializing handler with `createUpdateRepository(getDb())` lazily or by exporting a singleton from an updates module.

- [ ] **Step 4: Validate**

```bash
pnpm --filter @rag/server test -- ws-handlers.test.ts update-state.test.ts
pnpm --filter @rag/server typecheck
```

- [ ] **Step 5: Commit**

```bash
git add apps/server/src/ws/ws-handlers.ts apps/server/src/ws/ws-handlers.test.ts apps/server/src/modules/updates/update-status-handler.ts
git commit -m "feat(server): persist client update status"
```

---

# Milestone 5: Package Update Artifacts and Manifest

## Task 5.1: Generate client/server update artifacts

**Files:**
- Modify: `scripts/package.ts`
- Test: `scripts/package-artifacts-policy.test.cjs`

- [ ] **Step 1: Write policy test**

Check package script includes four artifact names:

```js
assert.ok(source.includes('rag-client-v'), 'package should generate client artifacts');
assert.ok(source.includes('rag-server-v'), 'package should generate server artifacts');
assert.ok(source.includes('release-manifest.json'), 'package should generate release manifest');
assert.ok(source.includes('sha256'), 'package should calculate sha256');
```

- [ ] **Step 2: Refactor package output**

Keep full package if desired, but add update artifacts:

```text
release/rag-client-v<version>-windows-x64.zip
release/rag-client-v<version>-linux-x64.tar.gz
release/rag-server-v<version>-windows-x64.zip
release/rag-server-v<version>-linux-x64.tar.gz
release/release-manifest.json
```

Client artifact contents:

```text
client.bundle.cjs
client.config.example.yaml
download-frp.bat / download-frp.sh
```

Server artifact contents:

```text
server.bundle.cjs
server.config.example.yaml
sql-wasm.wasm
web/
```

Bootstrap/full artifact can still contain everything.

- [ ] **Step 3: Generate manifest**

Use real file size and SHA256. Manifest artifact entries must match `ReleaseManifestSchema`.

- [ ] **Step 4: Validate**

```bash
node scripts/package-artifacts-policy.test.cjs
pnpm package
ls release
node -e "const fs=require('fs'); JSON.parse(fs.readFileSync('release/release-manifest.json','utf8')); console.log('manifest ok')"
```

- [ ] **Step 5: Commit**

```bash
git add scripts/package.ts scripts/package-artifacts-policy.test.cjs
git commit -m "build: generate update artifacts and manifest"
```

---

# Milestone 6: Client Download, Verify, Extract, Pending State

## Task 6.1: Implement downloader and verifier

**Files:**
- Create: `apps/client/src/runtime/updates/download.ts`
- Create: `apps/client/src/runtime/updates/verify.ts`
- Tests: corresponding `.test.ts`

- [ ] **Step 1: Write tests**

Downloader test should use a local HTTP server or mocked fetch stream. Verifier test should write temp file and verify sha/size.

- [ ] **Step 2: Implement streaming download**

Write to:

```text
<deployRoot>/downloads/<artifactName>.download
```

Rename to final only after success.

- [ ] **Step 3: Implement sha256 verifier**

Use `createHash('sha256')` and `createReadStream`.

- [ ] **Step 4: Validate**

```bash
pnpm --filter @rag/client test -- download.test.ts verify.test.ts
```

- [ ] **Step 5: Commit**

```bash
git add apps/client/src/runtime/updates/download.ts apps/client/src/runtime/updates/download.test.ts apps/client/src/runtime/updates/verify.ts apps/client/src/runtime/updates/verify.test.ts
git commit -m "feat(client): download and verify update artifacts"
```

## Task 6.2: Implement archive extraction into staging

**Files:**
- Create: `apps/client/src/runtime/updates/extract.ts`
- Test: `apps/client/src/runtime/updates/extract.test.ts`

- [ ] **Step 1: Write tests**

Test that extraction creates:

```text
versions/client/<version>/client.bundle.cjs
```

and rejects archive without `client.bundle.cjs`.

- [ ] **Step 2: Implement extraction**

For Windows zip, first version can call PowerShell:

```ts
spawnSync('powershell', ['-NoProfile', '-Command', `Expand-Archive -Path ...`])
```

For Linux tar.gz:

```ts
spawnSync('tar', ['-xzf', archive, '-C', staging])
```

Use staging directory:

```text
versions/client/<version>.staging
```

Then rename to:

```text
versions/client/<version>
```

- [ ] **Step 3: Validate**

```bash
pnpm --filter @rag/client test -- extract.test.ts
```

- [ ] **Step 4: Commit**

```bash
git add apps/client/src/runtime/updates/extract.ts apps/client/src/runtime/updates/extract.test.ts
git commit -m "feat(client): extract update artifacts into version directory"
```

## Task 6.3: Wire real update deps into client main

**Files:**
- Create: `apps/client/src/runtime/updates/update-deps.ts`
- Modify: `apps/client/src/main.ts`
- Modify: `apps/client/src/runtime/updates/client-updater.ts`
- Modify: `apps/client/src/runtime/updates/update-ws-handler.ts`
- Tests: `client-updater.test.ts`, `update-ws-handler.test.ts`

- [ ] **Step 1: Extend updater with phase callback**

Change `createClientUpdater(deps)` to accept optional:

```ts
onPhase?: (phase: ClientUpdatePhase, extra?: Record<string, unknown>) => void | Promise<void>;
```

Call for:

- downloading
- downloaded
- installing
- installed
- restarting
- failed

- [ ] **Step 2: Update handler to send all phases**

`update-ws-handler.ts` should construct updater with `onPhase` or pass a callback so each phase sends `client.update.status`.

- [ ] **Step 3: Implement `createUpdateDeps(config)`**

Deps should use:

```ts
const deployRoot = process.env.RAG_DEPLOY_ROOT ?? path.dirname(config.source?.path ?? process.cwd());
```

Implement:

- `download`
- `verify`
- `extract`
- `switchCurrent` writes pending state initially
- `startNew` initially no-op until launcher switch milestone
- `rollback` deletes staging/download temporary files

- [ ] **Step 4: Wire into main**

Replace placeholder deps with:

```ts
updater: createClientUpdater(createUpdateDeps(config)),
```

- [ ] **Step 5: Validate**

```bash
pnpm --filter @rag/client test -- client-updater.test.ts update-ws-handler.test.ts
pnpm --filter @rag/client typecheck
```

- [ ] **Step 6: Commit**

```bash
git add apps/client/src/main.ts apps/client/src/runtime/updates/update-deps.ts apps/client/src/runtime/updates/client-updater.ts apps/client/src/runtime/updates/update-ws-handler.ts apps/client/src/runtime/updates/*.test.ts
git commit -m "feat(client): wire real update install dependencies"
```

---

# Milestone 7: Launcher Switch and Rollback

## Task 7.1: Add pending/current/previous version state utilities

**Files:**
- Create: `apps/client/src/runtime/updates/current-version.ts`
- Test: `apps/client/src/runtime/updates/current-version.test.ts`

- [ ] **Step 1: Write tests**

Cover:

- write pending
- promote pending to current
- preserve previous
- rollback previous to current

- [ ] **Step 2: Implement atomic writes**

Write JSON through temp file then rename:

```ts
writeFileSync(`${file}.tmp`, JSON.stringify(data, null, 2));
renameSync(`${file}.tmp`, file);
```

- [ ] **Step 3: Validate**

```bash
pnpm --filter @rag/client test -- current-version.test.ts
```

- [ ] **Step 4: Commit**

```bash
git add apps/client/src/runtime/updates/current-version.ts apps/client/src/runtime/updates/current-version.test.ts
git commit -m "feat(client): manage update version state"
```

## Task 7.2: Teach launcher to restart into pending version

**Files:**
- Modify: `apps/client/src/launcher.ts`
- Test: `apps/client/src/launcher.test.ts`

- [ ] **Step 1: Define exit codes**

In launcher module export:

```ts
export const CLIENT_EXIT_UPDATE_RESTART = 20;
export const CLIENT_EXIT_ROLLBACK = 21;
```

- [ ] **Step 2: Add tests**

Test launcher decision function:

```ts
export function decideNextLaunch(input: { exitCode: number | null; hasPending: boolean; verificationFailed: boolean }): 'exit' | 'promote-pending' | 'rollback' | 'restart-current'
```

Expected:

- exit 20 + pending => promote-pending
- nonzero during pending verification => rollback
- normal 0 => exit

- [ ] **Step 3: Implement restart loop**

Launcher should:

1. Start current entrypoint.
2. If child exits 20, read pending and launch it.
3. Wait until ready marker exists or child survives configured grace period.
4. Promote pending to current.
5. If pending child exits before ready, rollback previous.

- [ ] **Step 4: Add ready marker from client main**

After successful register in `apps/client/src/main.ts`, write:

```text
state/client-ready.json
```

with version and timestamp when `RAG_DEPLOY_ROOT` exists.

- [ ] **Step 5: Validate**

```bash
pnpm --filter @rag/client test -- launcher.test.ts current-version.test.ts
pnpm --filter @rag/client typecheck
```

- [ ] **Step 6: Commit**

```bash
git add apps/client/src/launcher.ts apps/client/src/launcher.test.ts apps/client/src/main.ts
git commit -m "feat(client): restart launcher into pending version"
```

---

# Milestone 8: Web Visibility and Control

## Task 8.1: Add campaign list and attempts APIs

**Files:**
- Modify: `apps/server/src/modules/updates/campaign.routes.ts`
- Modify: `apps/server/src/modules/updates/campaign.service.ts`
- Modify: `apps/server/src/modules/updates/update-repository.ts`
- Tests: `campaign.routes.test.ts`, `campaign.service.test.ts`

- [ ] **Step 1: Add tests for routes**

Routes:

```text
GET /admin/updates/campaigns
GET /admin/updates/targets/:targetId/attempts
```

- [ ] **Step 2: Implement service/repository methods**

Methods:

```ts
listCampaigns(): UpdateCampaignRecord[];
listAttempts(targetId: string): UpdateAttemptRecord[];
```

- [ ] **Step 3: Validate**

```bash
pnpm --filter @rag/server test -- campaign.routes.test.ts campaign.service.test.ts
```

- [ ] **Step 4: Commit**

```bash
git add apps/server/src/modules/updates/campaign.routes.ts apps/server/src/modules/updates/campaign.service.ts apps/server/src/modules/updates/update-repository.ts apps/server/src/modules/updates/*.test.ts
git commit -m "feat(server): expose update campaign history"
```

## Task 8.2: Improve UpdatesPage status UX

**Files:**
- Modify: `apps/web/src/api/updates.ts`
- Modify: `apps/web/src/pages/UpdatesPage.tsx`
- Tests: `apps/web/src/pages/UpdatesPage.test.tsx` if existing test patterns support it.

- [ ] **Step 1: Add API helpers**

```ts
export async function listCampaigns(api: Api): Promise<CampaignRecord[]>;
export async function listTargetAttempts(api: Api, targetId: string): Promise<AttemptRecord[]>;
```

- [ ] **Step 2: Add campaign table**

Show:

- id
- version
- status
- includeServer
- createdAt
- actions: view/start/retry

- [ ] **Step 3: Add target error fields**

Add columns:

- currentVersion
- targetVersion
- lastErrorCode
- lastErrorMessage
- finishedAt

- [ ] **Step 4: Add polling while selected campaign is active**

Every 3 seconds when status in:

```ts
['server_updating', 'client_updating']
```

- [ ] **Step 5: Validate**

```bash
pnpm --filter @rag/web typecheck
pnpm --filter @rag/web test
```

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/api/updates.ts apps/web/src/pages/UpdatesPage.tsx apps/web/src/pages/UpdatesPage.test.tsx
git commit -m "feat(web): show update campaign progress"
```

---

# Milestone 9: Final Integration Verification

## Task 9.1: Add policy/E2E-ish verification script

**Files:**
- Create: `scripts/update-flow-policy.test.cjs`

- [ ] **Step 1: Add policy checks**

Check:

- `ecosystem.config.cjs` prefers launcher
- `scripts/build-all.ts` builds launcher
- `start-client.bat` generation prefers launcher
- `package.ts` produces update manifest
- server does not contain placeholder fake server update success
- client main does not contain placeholder updater deps

- [ ] **Step 2: Run validation**

```bash
node scripts/update-flow-policy.test.cjs
pnpm typecheck
pnpm -r test
pnpm build
pnpm package
```

- [ ] **Step 3: Manual artifact sanity**

```bash
ls release
node -e "const fs=require('fs'); const m=JSON.parse(fs.readFileSync('release/release-manifest.json','utf8')); console.log(m.version, m.artifacts.map(a=>a.fileName))"
rg -n "client-launcher" dist/start-client.bat dist/start-client.sh dist/ecosystem.config.cjs
```

- [ ] **Step 4: Commit**

```bash
git add scripts/update-flow-policy.test.cjs
git commit -m "test: add update flow integration policy"
```

---

# Explicit Non-Goals for This Plan

1. **Server self-update full implementation** is not included. This plan blocks fake server self-update and leaves real server update for a separate server-launcher/supervisor design.
2. **Delta updates** are not included. All updates are archive-based full bundle replacement.
3. **Cryptographic signing** is not included. This plan uses sha256 integrity only; signing can be added later.
4. **Multi-server distributed update coordination** is not included.
5. **Automatic launcher self-update** is not included. The launcher is treated as stable bootstrap code.

---

# Verification Commands Before Claiming Completion

Run all of these after the final milestone:

```bash
node scripts/ecosystem-config-layout-policy.test.cjs
node scripts/client-launcher-build-policy.test.cjs
node scripts/client-startup-policy.test.cjs
node scripts/build-deploy-version-policy.test.cjs
node scripts/package-artifacts-policy.test.cjs
node scripts/update-flow-policy.test.cjs
pnpm typecheck
pnpm -r test
pnpm build
pnpm package
```

Expected:

- All policy tests pass.
- All package tests pass.
- `dist/client-launcher.cjs` exists.
- `dist/start-client.bat` and `dist/start-client.sh` prefer launcher.
- `dist/ecosystem.config.cjs` prefers launcher and sets `RAG_DEPLOY_ROOT`.
- `release/release-manifest.json` exists and validates.
- Release artifacts include client/server platform-specific archives.

---

# Self-Review Notes

- The plan intentionally starts with launcher entrypoint unification because both `start-client.bat` and PM2 must enter the same update path.
- The plan blocks fake server self-update before implementing real client update, avoiding misleading success states.
- The plan connects `dist/`, package artifacts, manifest registration, server dispatch, client install, and launcher restart.
- The plan keeps server self-update out of scope because it needs a separate supervisor-safe design.
- No task relies on changing a target machine directly; all work is local code/test/build changes.
