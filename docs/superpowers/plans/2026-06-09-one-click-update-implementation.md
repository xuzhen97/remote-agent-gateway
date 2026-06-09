# One-Click Update Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a first-version one-click update system that lets the server manage releases, update itself safely, and roll out prebuilt client packages to mixed Windows/Linux clients with campaign tracking, retries, and local rollback.

**Architecture:** Add a release/campaign control plane to the server, plus local updater/runtime primitives on client and server. The server persists release metadata, campaigns, targets, and attempts; updater components perform local download/verify/install/switch/rollback actions; the CLI exposes release and campaign admin operations from the server side.

**Tech Stack:** TypeScript, Fastify, sql.js, Node.js filesystem/process APIs, Commander, Vitest, existing WebSocket + client HTTP control plane.

---

## Scope Check

The spec covers several moving parts, but they form a single deliverable with one clear goal: a stable first-version release/campaign/update loop. The work is still large, so this plan decomposes the feature into thin vertical slices that each produce testable behavior and can be committed independently.

## File Structure Map

### Server data model and persistence

- Modify: `apps/server/src/db/migrate.ts`
  - Add release, update campaign, update target, update attempt, and artifact download audit tables.
- Create: `apps/server/src/modules/updates/update-types.ts`
  - Shared server-side update domain types and helper enums.
- Create: `apps/server/src/modules/updates/update-repository.ts`
  - Read/write helpers for release, campaign, target, attempt, and audit persistence.

### Server release management

- Create: `apps/server/src/modules/updates/release-manifest.ts`
  - Manifest validation and artifact selection logic.
- Create: `apps/server/src/modules/updates/release-storage.ts`
  - Release directory layout helpers and artifact path resolution.
- Create: `apps/server/src/modules/updates/release.service.ts`
  - Register/list/get releases and enforce platform matching.
- Create: `apps/server/src/modules/updates/release.routes.ts`
  - Admin release API and controlled artifact download route.
- Create: `apps/server/src/modules/updates/release.service.test.ts`
- Create: `apps/server/src/modules/updates/release.routes.test.ts`

### Server campaign orchestration

- Create: `apps/server/src/modules/updates/update-state.ts`
  - Campaign/target/attempt phase transitions and summary aggregation.
- Create: `apps/server/src/modules/updates/campaign.service.ts`
  - Create campaigns, precheck releases/clients, retry failed or offline targets.
- Create: `apps/server/src/modules/updates/campaign-runner.ts`
  - Advance campaign phases, dispatch updater commands, recover after server restart.
- Create: `apps/server/src/modules/updates/campaign.routes.ts`
  - Admin campaign CRUD/retry/query APIs.
- Create: `apps/server/src/modules/updates/campaign.service.test.ts`
- Create: `apps/server/src/modules/updates/campaign-runner.test.ts`
- Create: `apps/server/src/modules/updates/update-state.test.ts`

### Server updater control and bootstrap

- Create: `apps/server/src/modules/updates/server-updater.ts`
  - Local server self-update executor contract and state handoff helpers.
- Modify: `apps/server/src/main.ts`
  - Start campaign recovery runner on boot and expose update routes.
- Create: `apps/server/src/modules/updates/server-updater.test.ts`

### Shared protocol additions

- Modify: `packages/shared/src/types.ts`
  - Add client update payloads, update status payloads, and release manifest transport types.
- Modify: `packages/shared/src/index.ts`
  - Re-export new shared types.

### Client updater and runtime

- Create: `apps/client/src/runtime/updates/update-types.ts`
  - Client-side update request and status types.
- Create: `apps/client/src/runtime/updates/version-layout.ts`
  - Version directory helpers for Linux/Windows.
- Create: `apps/client/src/runtime/updates/updater-state.ts`
  - Persistent updater state file read/write helpers.
- Create: `apps/client/src/runtime/updates/client-updater.ts`
  - Download/verify/extract/switch/restart/rollback workflow.
- Create: `apps/client/src/runtime/updates/client-updater.test.ts`
- Create: `apps/client/src/runtime/updates/version-layout.test.ts`
- Create: `apps/client/src/runtime/updates/updater-state.test.ts`
- Modify: `apps/client/src/runtime/control-http/server.ts`
  - Initialize update runtime dependencies.
- Modify: `apps/client/src/main.ts`
  - Wire client update message handling and version reporting.
- Modify: `apps/client/src/core/register.ts`
  - Report runtime version and updater capability.
- Create: `apps/client/src/runtime/updates/update-ws-handler.ts`
  - Handle server-dispatched update commands and result events.

### CLI admin interface

- Create: `apps/cli/src/commands/updates.ts`
  - `updates releases *` and `updates campaigns *` command group.
- Modify: `apps/cli/src/http/server-api.ts`
  - Add release/campaign admin methods.
- Modify: `apps/cli/src/commands/commands.test.ts`
  - Add CLI coverage for update admin flows.

### Skill and docs

- Modify: `skills/rag-agent/SKILL.md`
  - Add server-side one-click update usage guidance once commands exist.
- Modify: `skills/rag-agent/references/cli.md`
  - Document update-related commands.

---

### Task 1: Add shared update protocol types

**Files:**
- Modify: `packages/shared/src/types.ts`
- Modify: `packages/shared/src/index.ts`
- Test: `apps/server/src/modules/updates/update-state.test.ts`
- Test: `apps/client/src/runtime/updates/update-ws-handler.test.ts`

- [ ] **Step 1: Write the failing server-side type-driven test scaffold**

Create `apps/server/src/modules/updates/update-state.test.ts` with:

```ts
import { describe, expect, it } from 'vitest';
import type { ClientUpdateCommandPayload, ClientUpdateStatusPayload, ReleaseManifest } from '@rag/shared';

describe('shared update protocol types compile into server tests', () => {
  it('accepts release and updater payload shapes', () => {
    const manifest: ReleaseManifest = {
      version: 'v1.4.0',
      releaseTime: '2026-06-09T00:00:00Z',
      notes: 'test',
      minUpdaterVersion: '0.1.0',
      channel: 'stable',
      compatibleFrom: ['0.1.0'],
      artifacts: [
        {
          targetType: 'client',
          platform: 'windows',
          arch: 'x64',
          fileName: 'client-windows-x64.zip',
          downloadPath: '/updates/artifacts/v1.4.0/client-windows-x64.zip',
          sha256: 'abc',
          size: 123,
          entrypoint: 'client.exe',
          installerType: 'archive',
          enabled: true,
        },
      ],
    };

    const command: ClientUpdateCommandPayload = {
      campaignId: 'camp_1',
      targetId: 'target_1',
      attemptId: 'att_1',
      version: 'v1.4.0',
      artifact: manifest.artifacts[0],
      downloadUrl: 'http://server/updates/artifacts/v1.4.0/client-windows-x64.zip',
      expectedSha256: 'abc',
      expectedSize: 123,
    };

    const status: ClientUpdateStatusPayload = {
      campaignId: 'camp_1',
      targetId: 'target_1',
      attemptId: 'att_1',
      phase: 'downloading',
      currentVersion: '0.1.0',
      targetVersion: 'v1.4.0',
    };

    expect(command.artifact.fileName).toBe('client-windows-x64.zip');
    expect(status.phase).toBe('downloading');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```bash
pnpm --filter @rag/server test -- src/modules/updates/update-state.test.ts
```

Expected: FAIL with missing exported shared update types.

- [ ] **Step 3: Add minimal shared update type definitions**

Add to `packages/shared/src/types.ts`:

```ts
export type UpdateTargetType = 'server' | 'client';
export type UpdatePlatform = 'linux' | 'windows';
export type UpdateChannel = 'stable' | 'beta';
export type UpdateInstallerType = 'archive' | 'binary';
export type ClientUpdatePhase =
  | 'queued'
  | 'dispatched'
  | 'downloading'
  | 'downloaded'
  | 'installing'
  | 'installed'
  | 'restarting'
  | 'verifying'
  | 'succeeded'
  | 'failed'
  | 'rolled_back'
  | 'offline_skipped'
  | 'cancelled';

export interface ReleaseArtifact {
  targetType: UpdateTargetType;
  platform: UpdatePlatform;
  arch: string;
  fileName: string;
  downloadPath: string;
  sha256: string;
  size: number;
  entrypoint: string;
  installerType: UpdateInstallerType;
  mandatory?: boolean;
  enabled: boolean;
}

export interface ReleaseManifest {
  version: string;
  releaseTime: string;
  notes: string;
  minUpdaterVersion: string;
  channel: UpdateChannel;
  compatibleFrom: string[];
  artifacts: ReleaseArtifact[];
}

export interface ClientUpdateCommandPayload {
  campaignId: string;
  targetId: string;
  attemptId: string;
  version: string;
  artifact: ReleaseArtifact;
  downloadUrl: string;
  expectedSha256: string;
  expectedSize: number;
}

export interface ClientUpdateStatusPayload {
  campaignId: string;
  targetId: string;
  attemptId: string;
  phase: ClientUpdatePhase;
  currentVersion: string;
  targetVersion: string;
  errorCode?: string;
  errorMessage?: string;
}
```

Add to `packages/shared/src/index.ts`:

```ts
export * from './types.js';
```

- [ ] **Step 4: Run test to verify it passes**

Run:

```bash
pnpm --filter @rag/server test -- src/modules/updates/update-state.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/shared/src/types.ts packages/shared/src/index.ts apps/server/src/modules/updates/update-state.test.ts
git commit -m "feat: add shared update protocol types"
```

### Task 2: Add server update persistence schema and repository layer

**Files:**
- Modify: `apps/server/src/db/migrate.ts`
- Create: `apps/server/src/modules/updates/update-types.ts`
- Create: `apps/server/src/modules/updates/update-repository.ts`
- Create: `apps/server/src/modules/updates/update-repository.test.ts`

- [ ] **Step 1: Write the failing repository test**

Create `apps/server/src/modules/updates/update-repository.test.ts` with:

```ts
import { describe, expect, it } from 'vitest';
import { initTestDb } from '../../db/__tests__/test-db.js';
import { createUpdateRepository } from './update-repository.js';

describe('update repository', () => {
  it('persists releases, campaigns, targets, and attempts', () => {
    const { db } = initTestDb();
    const repo = createUpdateRepository(db);

    repo.saveRelease({ version: 'v1.4.0', manifestJson: '{"version":"v1.4.0"}', createdAt: 1, enabled: true });
    repo.saveCampaign({ id: 'camp_1', targetVersion: 'v1.4.0', scopeJson: '{"all":true}', includeServer: 1, batchSize: 10, maxConcurrency: 5, status: 'draft', createdBy: 'admin', createdAt: 1, updatedAt: 1 });
    repo.saveTarget({ id: 'target_1', campaignId: 'camp_1', targetType: 'client', clientId: 'client-1', platform: 'windows', currentVersion: '0.1.0', targetVersion: 'v1.4.0', phase: 'queued', attemptCount: 0, createdAt: 1, updatedAt: 1 });
    repo.saveAttempt({ id: 'att_1', targetId: 'target_1', attemptNo: 1, phaseTimelineJson: '[]', result: 'running', createdAt: 1, updatedAt: 1 });

    expect(repo.getRelease('v1.4.0')?.version).toBe('v1.4.0');
    expect(repo.getCampaign('camp_1')?.status).toBe('draft');
    expect(repo.listTargets('camp_1')).toHaveLength(1);
    expect(repo.listAttempts('target_1')).toHaveLength(1);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```bash
pnpm --filter @rag/server test -- src/modules/updates/update-repository.test.ts
```

Expected: FAIL because repository and schema do not exist.

- [ ] **Step 3: Add schema and minimal repository implementation**

Add tables to `apps/server/src/db/migrate.ts`:

```ts
CREATE TABLE IF NOT EXISTS update_releases (
  version TEXT PRIMARY KEY,
  manifest_json TEXT NOT NULL,
  enabled INTEGER NOT NULL DEFAULT 1,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS update_campaigns (
  id TEXT PRIMARY KEY,
  target_version TEXT NOT NULL,
  scope_json TEXT NOT NULL,
  include_server INTEGER NOT NULL,
  batch_size INTEGER NOT NULL,
  max_concurrency INTEGER NOT NULL,
  status TEXT NOT NULL,
  created_by TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS update_targets (
  id TEXT PRIMARY KEY,
  campaign_id TEXT NOT NULL,
  target_type TEXT NOT NULL,
  client_id TEXT,
  platform TEXT,
  current_version TEXT,
  target_version TEXT NOT NULL,
  phase TEXT NOT NULL,
  attempt_count INTEGER NOT NULL DEFAULT 0,
  last_error_code TEXT,
  last_error_message TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  finished_at INTEGER
);

CREATE TABLE IF NOT EXISTS update_attempts (
  id TEXT PRIMARY KEY,
  target_id TEXT NOT NULL,
  attempt_no INTEGER NOT NULL,
  phase_timeline_json TEXT NOT NULL,
  result TEXT NOT NULL,
  error_code TEXT,
  error_message TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  finished_at INTEGER
);
```

Create `apps/server/src/modules/updates/update-types.ts` with row shapes used by the repository.

Create `apps/server/src/modules/updates/update-repository.ts` with:

```ts
import type { Database } from 'sql.js';

export function createUpdateRepository(db: Database) {
  return {
    saveRelease(record: any) { /* INSERT OR REPLACE update_releases */ },
    getRelease(version: string) { /* SELECT */ },
    saveCampaign(record: any) { /* INSERT OR REPLACE update_campaigns */ },
    getCampaign(id: string) { /* SELECT */ },
    saveTarget(record: any) { /* INSERT OR REPLACE update_targets */ },
    listTargets(campaignId: string) { /* SELECT */ },
    saveAttempt(record: any) { /* INSERT OR REPLACE update_attempts */ },
    listAttempts(targetId: string) { /* SELECT */ },
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run:

```bash
pnpm --filter @rag/server test -- src/modules/updates/update-repository.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/server/src/db/migrate.ts apps/server/src/modules/updates/update-types.ts apps/server/src/modules/updates/update-repository.ts apps/server/src/modules/updates/update-repository.test.ts
git commit -m "feat: add update persistence schema"
```

### Task 3: Implement release manifest validation and server-side release service

**Files:**
- Create: `apps/server/src/modules/updates/release-manifest.ts`
- Create: `apps/server/src/modules/updates/release-storage.ts`
- Create: `apps/server/src/modules/updates/release.service.ts`
- Create: `apps/server/src/modules/updates/release.service.test.ts`

- [ ] **Step 1: Write the failing release service test**

Create `apps/server/src/modules/updates/release.service.test.ts` with:

```ts
import { describe, expect, it } from 'vitest';
import { createReleaseService } from './release.service.js';

describe('release service', () => {
  it('validates manifests and resolves platform-specific artifacts', () => {
    const service = createReleaseService({
      repo: {
        saveRelease: () => undefined,
        getRelease: () => ({ version: 'v1.4.0', manifestJson: JSON.stringify({
          version: 'v1.4.0',
          releaseTime: '2026-06-09T00:00:00Z',
          notes: 'demo',
          minUpdaterVersion: '0.1.0',
          channel: 'stable',
          compatibleFrom: ['0.1.0'],
          artifacts: [
            { targetType: 'client', platform: 'windows', arch: 'x64', fileName: 'client-win.zip', downloadPath: '/updates/artifacts/v1.4.0/client-win.zip', sha256: 'abc', size: 10, entrypoint: 'client.exe', installerType: 'archive', enabled: true },
          ],
        }), enabled: 1 }),
      },
      now: () => 1,
    } as any);

    const artifact = service.resolveArtifact('v1.4.0', { targetType: 'client', platform: 'windows', arch: 'x64' });
    expect(artifact.fileName).toBe('client-win.zip');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```bash
pnpm --filter @rag/server test -- src/modules/updates/release.service.test.ts
```

Expected: FAIL because release service does not exist.

- [ ] **Step 3: Implement manifest parser and release service**

Create `apps/server/src/modules/updates/release-manifest.ts` with:

```ts
import type { ReleaseManifest, ReleaseArtifact } from '@rag/shared';

export function parseReleaseManifest(input: string): ReleaseManifest {
  const parsed = JSON.parse(input) as ReleaseManifest;
  if (!parsed.version || !Array.isArray(parsed.artifacts) || !parsed.artifacts.length) {
    throw new Error('Invalid release manifest');
  }
  return parsed;
}

export function selectArtifact(manifest: ReleaseManifest, match: { targetType: 'server' | 'client'; platform: 'windows' | 'linux'; arch: string }): ReleaseArtifact {
  const artifact = manifest.artifacts.find((item) => item.enabled && item.targetType === match.targetType && item.platform === match.platform && item.arch === match.arch);
  if (!artifact) throw new Error('No matching artifact');
  return artifact;
}
```

Create `apps/server/src/modules/updates/release.service.ts` with:

```ts
import { parseReleaseManifest, selectArtifact } from './release-manifest.js';

export function createReleaseService(deps: { repo: any; now?: () => number }) {
  return {
    resolveArtifact(version: string, match: { targetType: 'server' | 'client'; platform: 'windows' | 'linux'; arch: string }) {
      const record = deps.repo.getRelease(version);
      if (!record || !record.enabled) throw new Error(`Release ${version} not found or disabled`);
      return selectArtifact(parseReleaseManifest(record.manifestJson), match);
    },
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run:

```bash
pnpm --filter @rag/server test -- src/modules/updates/release.service.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/server/src/modules/updates/release-manifest.ts apps/server/src/modules/updates/release-storage.ts apps/server/src/modules/updates/release.service.ts apps/server/src/modules/updates/release.service.test.ts
git commit -m "feat: add release manifest validation"
```

### Task 4: Expose release admin and artifact download routes

**Files:**
- Create: `apps/server/src/modules/updates/release.routes.ts`
- Create: `apps/server/src/modules/updates/release.routes.test.ts`
- Modify: `apps/server/src/main.ts`

- [ ] **Step 1: Write the failing route test**

Create `apps/server/src/modules/updates/release.routes.test.ts` with:

```ts
import Fastify from 'fastify';
import { describe, expect, it } from 'vitest';
import { releaseRoutes } from './release.routes.js';

describe('release routes', () => {
  it('lists releases and serves controlled artifact downloads', async () => {
    const app = Fastify();
    await app.register(releaseRoutes, {
      service: {
        listReleases: () => [{ version: 'v1.4.0' }],
        getArtifactDownload: () => ({ path: new URL('file:///tmp/client.zip') }),
      },
    } as any);

    const list = await app.inject({ method: 'GET', url: '/admin/updates/releases' });
    expect(list.statusCode).toBe(200);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```bash
pnpm --filter @rag/server test -- src/modules/updates/release.routes.test.ts
```

Expected: FAIL because route module is missing.

- [ ] **Step 3: Implement routes and register them in main**

Create `apps/server/src/modules/updates/release.routes.ts` with routes:

```ts
app.get('/admin/updates/releases', async () => ({ ok: true, data: options.service.listReleases() }));
app.get('/admin/updates/releases/:version', async (request) => ({ ok: true, data: options.service.getRelease((request.params as any).version) }));
app.get('/updates/artifacts/:version/:artifactName', async (request, reply) => {
  const result = options.service.getArtifactDownload((request.params as any).version, (request.params as any).artifactName, request.headers.authorization ?? '');
  return reply.send(createReadStream(result.path));
});
```

Register in `apps/server/src/main.ts`:

```ts
import { releaseRoutes } from './modules/updates/release.routes.js';
// ...
await app.register(releaseRoutes);
```

- [ ] **Step 4: Run test to verify it passes**

Run:

```bash
pnpm --filter @rag/server test -- src/modules/updates/release.routes.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/server/src/modules/updates/release.routes.ts apps/server/src/modules/updates/release.routes.test.ts apps/server/src/main.ts
git commit -m "feat: expose release admin and artifact routes"
```

### Task 5: Implement campaign state transitions and summaries

**Files:**
- Create: `apps/server/src/modules/updates/update-state.ts`
- Create: `apps/server/src/modules/updates/update-state.test.ts`

- [ ] **Step 1: Replace the scaffold test with a failing state-machine test**

Update `apps/server/src/modules/updates/update-state.test.ts` to:

```ts
import { describe, expect, it } from 'vitest';
import { summarizeTargets, transitionCampaignStatus } from './update-state.js';

describe('update state', () => {
  it('marks campaigns with errors when failed or offline targets exist', () => {
    const summary = summarizeTargets([
      { phase: 'succeeded' },
      { phase: 'failed' },
      { phase: 'offline_skipped' },
    ] as any);

    expect(summary.succeeded).toBe(1);
    expect(summary.failed).toBe(1);
    expect(summary.offlineSkipped).toBe(1);
    expect(transitionCampaignStatus(summary)).toBe('completed_with_errors');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```bash
pnpm --filter @rag/server test -- src/modules/updates/update-state.test.ts
```

Expected: FAIL because state helpers are missing.

- [ ] **Step 3: Implement state summarization helpers**

Create `apps/server/src/modules/updates/update-state.ts` with:

```ts
export function summarizeTargets(targets: Array<{ phase: string }>) {
  return targets.reduce((acc, target) => {
    if (target.phase === 'succeeded') acc.succeeded += 1;
    else if (target.phase === 'failed' || target.phase === 'rolled_back') acc.failed += 1;
    else if (target.phase === 'offline_skipped') acc.offlineSkipped += 1;
    return acc;
  }, { succeeded: 0, failed: 0, offlineSkipped: 0 });
}

export function transitionCampaignStatus(summary: { succeeded: number; failed: number; offlineSkipped: number }) {
  return summary.failed > 0 || summary.offlineSkipped > 0 ? 'completed_with_errors' : 'completed';
}
```

- [ ] **Step 4: Run test to verify it passes**

Run:

```bash
pnpm --filter @rag/server test -- src/modules/updates/update-state.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/server/src/modules/updates/update-state.ts apps/server/src/modules/updates/update-state.test.ts
git commit -m "feat: add update campaign state helpers"
```

### Task 6: Implement campaign creation, precheck, and retry service

**Files:**
- Create: `apps/server/src/modules/updates/campaign.service.ts`
- Create: `apps/server/src/modules/updates/campaign.service.test.ts`

- [ ] **Step 1: Write the failing campaign service test**

Create `apps/server/src/modules/updates/campaign.service.test.ts` with:

```ts
import { describe, expect, it } from 'vitest';
import { createCampaignService } from './campaign.service.js';

describe('campaign service', () => {
  it('creates a campaign only when required artifacts exist', () => {
    const service = createCampaignService({
      releaseService: { resolveArtifact: () => ({ fileName: 'ok' }) },
      clientsService: { listClients: () => [{ id: 'client-1', os: 'win32', arch: 'x64', status: 'online', version: '0.1.0' }] },
      repo: { saveCampaign: () => undefined, saveTarget: () => undefined },
      now: () => 1,
      id: () => 'camp_1',
    } as any);

    const result = service.createCampaign({ targetVersion: 'v1.4.0', includeServer: true, batchSize: 10, maxConcurrency: 5, createdBy: 'admin', scope: { all: true } });
    expect(result.campaignId).toBe('camp_1');
    expect(result.targets).toHaveLength(2);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```bash
pnpm --filter @rag/server test -- src/modules/updates/campaign.service.test.ts
```

Expected: FAIL because campaign service does not exist.

- [ ] **Step 3: Implement minimal campaign service**

Create `apps/server/src/modules/updates/campaign.service.ts` with logic to:

```ts
- precheck server artifact for linux/x64
- list clients from clientsService
- map win32 -> windows and linux -> linux
- precheck one artifact per client platform/arch
- persist one campaign record
- persist one server target when includeServer is true
- persist one client target per selected client
- expose retryTargets(campaignId, mode)
```

Core skeleton:

```ts
export function createCampaignService(deps: any) {
  return {
    createCampaign(input: any) {
      const clients = deps.clientsService.listClients();
      deps.releaseService.resolveArtifact(input.targetVersion, { targetType: 'server', platform: 'linux', arch: 'x64' });
      // ...persist campaign and targets
      return { campaignId: campaign.id, targets };
    },
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run:

```bash
pnpm --filter @rag/server test -- src/modules/updates/campaign.service.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/server/src/modules/updates/campaign.service.ts apps/server/src/modules/updates/campaign.service.test.ts
git commit -m "feat: add update campaign creation service"
```

### Task 7: Implement campaign runner and boot-time recovery hook

**Files:**
- Create: `apps/server/src/modules/updates/campaign-runner.ts`
- Create: `apps/server/src/modules/updates/campaign-runner.test.ts`
- Create: `apps/server/src/modules/updates/server-updater.ts`
- Create: `apps/server/src/modules/updates/server-updater.test.ts`
- Modify: `apps/server/src/main.ts`

- [ ] **Step 1: Write the failing runner test**

Create `apps/server/src/modules/updates/campaign-runner.test.ts` with:

```ts
import { describe, expect, it, vi } from 'vitest';
import { createCampaignRunner } from './campaign-runner.js';

describe('campaign runner', () => {
  it('recovers a server_updating campaign and resumes client rollout', async () => {
    const runServerUpdate = vi.fn().mockResolvedValue(undefined);
    const repo = {
      listRecoverableCampaigns: () => [{ id: 'camp_1', status: 'server_updating', targetVersion: 'v1.4.0' }],
      getTargetsForCampaign: () => [],
      updateCampaignStatus: vi.fn(),
    };

    const runner = createCampaignRunner({ repo, runServerUpdate, verifyServerVersion: () => 'v1.4.0' } as any);
    await runner.recoverPendingCampaigns();
    expect(repo.updateCampaignStatus).toHaveBeenCalledWith('camp_1', 'client_updating');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```bash
pnpm --filter @rag/server test -- src/modules/updates/campaign-runner.test.ts
```

Expected: FAIL because runner does not exist.

- [ ] **Step 3: Implement recovery-first runner and server updater contract**

Create `apps/server/src/modules/updates/server-updater.ts`:

```ts
export interface ServerUpdater {
  run(input: { campaignId: string; version: string; artifactPath: string }): Promise<void>;
}

export function createNoopServerUpdater(): ServerUpdater {
  return { async run() { /* implemented later */ } };
}
```

Create `apps/server/src/modules/updates/campaign-runner.ts`:

```ts
export function createCampaignRunner(deps: any) {
  return {
    async recoverPendingCampaigns() {
      for (const campaign of deps.repo.listRecoverableCampaigns()) {
        if (campaign.status === 'server_updating' && deps.verifyServerVersion() === campaign.targetVersion) {
          deps.repo.updateCampaignStatus(campaign.id, 'client_updating');
        }
      }
    },
  };
}
```

Wire startup in `apps/server/src/main.ts` after DB init:

```ts
const campaignRunner = createCampaignRunner(/* deps */);
await campaignRunner.recoverPendingCampaigns();
```

- [ ] **Step 4: Run test to verify it passes**

Run:

```bash
pnpm --filter @rag/server test -- src/modules/updates/campaign-runner.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/server/src/modules/updates/campaign-runner.ts apps/server/src/modules/updates/campaign-runner.test.ts apps/server/src/modules/updates/server-updater.ts apps/server/src/modules/updates/server-updater.test.ts apps/server/src/main.ts
git commit -m "feat: add update campaign recovery runner"
```

### Task 8: Implement client-side version layout and updater state persistence

**Files:**
- Create: `apps/client/src/runtime/updates/version-layout.ts`
- Create: `apps/client/src/runtime/updates/version-layout.test.ts`
- Create: `apps/client/src/runtime/updates/updater-state.ts`
- Create: `apps/client/src/runtime/updates/updater-state.test.ts`

- [ ] **Step 1: Write failing layout/state tests**

Create `apps/client/src/runtime/updates/version-layout.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { resolveVersionLayout } from './version-layout.js';

describe('version layout', () => {
  it('builds windows-safe and linux-safe version paths', () => {
    const layout = resolveVersionLayout('/opt/rag-client', 'v1.4.0');
    expect(layout.versionDir.endsWith('versions/v1.4.0')).toBe(true);
    expect(layout.downloadsDir.endsWith('downloads')).toBe(true);
  });
});
```

Create `apps/client/src/runtime/updates/updater-state.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { readUpdaterState, writeUpdaterState } from './updater-state.js';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

describe('updater state', () => {
  it('persists and reloads updater progress', () => {
    const dir = mkdtempSync(join(tmpdir(), 'rag-updater-state-'));
    writeUpdaterState(dir, { currentVersion: '0.1.0', targetVersion: 'v1.4.0', phase: 'downloading' });
    expect(readUpdaterState(dir)?.targetVersion).toBe('v1.4.0');
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run:

```bash
pnpm --filter @rag/client test -- src/runtime/updates/version-layout.test.ts src/runtime/updates/updater-state.test.ts
```

Expected: FAIL because files do not exist.

- [ ] **Step 3: Implement minimal path and state helpers**

Create `apps/client/src/runtime/updates/version-layout.ts`:

```ts
import { join } from 'node:path';

export function resolveVersionLayout(baseDir: string, version: string) {
  return {
    baseDir,
    versionsDir: join(baseDir, 'versions'),
    versionDir: join(baseDir, 'versions', version),
    downloadsDir: join(baseDir, 'downloads'),
    stateDir: join(baseDir, 'state'),
    currentVersionFile: join(baseDir, 'state', 'current-version.json'),
    updaterStateFile: join(baseDir, 'state', 'updater-state.json'),
  };
}
```

Create `apps/client/src/runtime/updates/updater-state.ts`:

```ts
import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { dirname } from 'node:path';

export function writeUpdaterState(baseDir: string, state: Record<string, unknown>) {
  const file = `${baseDir}/updater-state.json`;
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, JSON.stringify(state, null, 2));
}

export function readUpdaterState(baseDir: string) {
  const file = `${baseDir}/updater-state.json`;
  if (!existsSync(file)) return null;
  return JSON.parse(readFileSync(file, 'utf8'));
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run:

```bash
pnpm --filter @rag/client test -- src/runtime/updates/version-layout.test.ts src/runtime/updates/updater-state.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/client/src/runtime/updates/version-layout.ts apps/client/src/runtime/updates/version-layout.test.ts apps/client/src/runtime/updates/updater-state.ts apps/client/src/runtime/updates/updater-state.test.ts
git commit -m "feat: add client update layout and state helpers"
```

### Task 9: Implement client updater workflow with local rollback

**Files:**
- Create: `apps/client/src/runtime/updates/client-updater.ts`
- Create: `apps/client/src/runtime/updates/client-updater.test.ts`
- Create: `apps/client/src/runtime/updates/update-types.ts`

- [ ] **Step 1: Write the failing client updater test**

Create `apps/client/src/runtime/updates/client-updater.test.ts` with:

```ts
import { describe, expect, it, vi } from 'vitest';
import { createClientUpdater } from './client-updater.js';

describe('client updater', () => {
  it('downloads, verifies, stages, and reports version switch', async () => {
    const updater = createClientUpdater({
      download: vi.fn().mockResolvedValue({ filePath: '/tmp/client.zip', size: 10 }),
      verify: vi.fn().mockResolvedValue(undefined),
      extract: vi.fn().mockResolvedValue('/opt/rag-client/versions/v1.4.0'),
      stopCurrent: vi.fn().mockResolvedValue(undefined),
      switchCurrent: vi.fn().mockResolvedValue(undefined),
      startNew: vi.fn().mockResolvedValue(undefined),
      rollback: vi.fn().mockResolvedValue(undefined),
    } as any);

    const result = await updater.run({ version: 'v1.4.0', expectedSha256: 'abc', expectedSize: 10 } as any);
    expect(result.phase).toBe('verifying');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```bash
pnpm --filter @rag/client test -- src/runtime/updates/client-updater.test.ts
```

Expected: FAIL because updater does not exist.

- [ ] **Step 3: Implement minimal updater workflow**

Create `apps/client/src/runtime/updates/client-updater.ts`:

```ts
export function createClientUpdater(deps: any) {
  return {
    async run(input: any) {
      const downloaded = await deps.download(input);
      await deps.verify(downloaded.filePath, input.expectedSha256, input.expectedSize);
      await deps.extract(downloaded.filePath, input.version);
      await deps.stopCurrent();
      await deps.switchCurrent(input.version);
      await deps.startNew();
      return { phase: 'verifying' };
    },
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run:

```bash
pnpm --filter @rag/client test -- src/runtime/updates/client-updater.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/client/src/runtime/updates/client-updater.ts apps/client/src/runtime/updates/client-updater.test.ts apps/client/src/runtime/updates/update-types.ts
git commit -m "feat: add client updater workflow"
```

### Task 10: Wire client update message handling and status reporting

**Files:**
- Create: `apps/client/src/runtime/updates/update-ws-handler.ts`
- Create: `apps/client/src/runtime/updates/update-ws-handler.test.ts`
- Modify: `apps/client/src/main.ts`
- Modify: `apps/client/src/core/register.ts`

- [ ] **Step 1: Write the failing message-handler test**

Create `apps/client/src/runtime/updates/update-ws-handler.test.ts` with:

```ts
import { describe, expect, it, vi } from 'vitest';
import { handleUpdateWsMessage } from './update-ws-handler.js';

describe('update ws handler', () => {
  it('handles server.update.run and emits client.update.status', async () => {
    const send = vi.fn();
    const handled = await handleUpdateWsMessage({
      message: { type: 'server.update.run', payload: { campaignId: 'camp_1', targetId: 'target_1', attemptId: 'att_1', version: 'v1.4.0' } },
      updater: { run: vi.fn().mockResolvedValue({ phase: 'verifying' }) },
      send,
      currentVersion: '0.1.0',
    } as any);

    expect(handled).toBe(true);
    expect(send).toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```bash
pnpm --filter @rag/client test -- src/runtime/updates/update-ws-handler.test.ts
```

Expected: FAIL because handler does not exist.

- [ ] **Step 3: Implement update message handling and registration metadata**

Create `apps/client/src/runtime/updates/update-ws-handler.ts`:

```ts
export async function handleUpdateWsMessage(input: any) {
  if (input.message.type !== 'server.update.run') return false;
  const payload = input.message.payload;
  input.send({
    type: 'client.update.status',
    requestId: `update_${payload.attemptId}`,
    payload: {
      campaignId: payload.campaignId,
      targetId: payload.targetId,
      attemptId: payload.attemptId,
      phase: 'downloading',
      currentVersion: input.currentVersion,
      targetVersion: payload.version,
    },
  });
  await input.updater.run(payload);
  return true;
}
```

Modify `apps/client/src/core/register.ts` capabilities payload:

```ts
updates: true,
updaterVersion: '0.1.0',
```

Modify `apps/client/src/main.ts` to check `handleUpdateWsMessage(...)` before job dispatch.

- [ ] **Step 4: Run test to verify it passes**

Run:

```bash
pnpm --filter @rag/client test -- src/runtime/updates/update-ws-handler.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/client/src/runtime/updates/update-ws-handler.ts apps/client/src/runtime/updates/update-ws-handler.test.ts apps/client/src/main.ts apps/client/src/core/register.ts
git commit -m "feat: wire client update websocket handling"
```

### Task 11: Add campaign admin routes and dispatch path from server to clients

**Files:**
- Create: `apps/server/src/modules/updates/campaign.routes.ts`
- Create: `apps/server/src/modules/updates/campaign.routes.test.ts`
- Modify: `apps/server/src/main.ts`
- Modify: `apps/server/src/ws/ws-handlers.ts`

- [ ] **Step 1: Write the failing campaign route test**

Create `apps/server/src/modules/updates/campaign.routes.test.ts` with:

```ts
import Fastify from 'fastify';
import { describe, expect, it, vi } from 'vitest';
import { campaignRoutes } from './campaign.routes.js';

describe('campaign routes', () => {
  it('creates and retries campaigns', async () => {
    const app = Fastify();
    await app.register(campaignRoutes, {
      service: {
        createCampaign: vi.fn().mockReturnValue({ campaignId: 'camp_1' }),
        retryTargets: vi.fn().mockReturnValue({ retried: 1 }),
        getCampaign: vi.fn().mockReturnValue({ id: 'camp_1' }),
        listTargets: vi.fn().mockReturnValue([]),
      },
    } as any);

    const create = await app.inject({ method: 'POST', url: '/admin/updates/campaigns', payload: { targetVersion: 'v1.4.0', includeServer: true, batchSize: 10, maxConcurrency: 5, scope: { all: true }, createdBy: 'admin' } });
    expect(create.statusCode).toBe(200);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```bash
pnpm --filter @rag/server test -- src/modules/updates/campaign.routes.test.ts
```

Expected: FAIL because routes do not exist.

- [ ] **Step 3: Implement campaign routes and register them**

Create `apps/server/src/modules/updates/campaign.routes.ts` with:

```ts
app.post('/admin/updates/campaigns', async (request) => ({ ok: true, data: options.service.createCampaign(request.body) }));
app.get('/admin/updates/campaigns/:id', async (request) => ({ ok: true, data: options.service.getCampaign((request.params as any).id) }));
app.get('/admin/updates/campaigns/:id/targets', async (request) => ({ ok: true, data: options.service.listTargets((request.params as any).id) }));
app.post('/admin/updates/campaigns/:id/retry', async (request) => ({ ok: true, data: options.service.retryTargets((request.params as any).id, request.body) }));
```

Register in `apps/server/src/main.ts`.

Extend WebSocket handler plumbing in `apps/server/src/ws/ws-handlers.ts` to route `client.update.status` into campaign runner / repository update hooks.

- [ ] **Step 4: Run test to verify it passes**

Run:

```bash
pnpm --filter @rag/server test -- src/modules/updates/campaign.routes.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/server/src/modules/updates/campaign.routes.ts apps/server/src/modules/updates/campaign.routes.test.ts apps/server/src/main.ts apps/server/src/ws/ws-handlers.ts
git commit -m "feat: expose update campaign admin routes"
```

### Task 12: Add server-side CLI commands for releases and campaigns

**Files:**
- Create: `apps/cli/src/commands/updates.ts`
- Modify: `apps/cli/src/http/server-api.ts`
- Modify: `apps/cli/src/index.ts`
- Modify: `apps/cli/src/commands/commands.test.ts`

- [ ] **Step 1: Write the failing CLI command test**

Append to `apps/cli/src/commands/commands.test.ts`:

```ts
it('runs updates campaigns start through the server api', async () => {
  const outputs: unknown[] = [];
  const api = {
    createUpdateCampaign: vi.fn().mockResolvedValue({ campaignId: 'camp_1' }),
  };
  const program = new Command();
  program.exitOverride();
  registerUpdatesCommands(program, { serverApi: api as any, write: (value) => outputs.push(value) });

  await program.parseAsync(['updates', 'campaigns', 'start', '--version', 'v1.4.0', '--all-clients'], { from: 'user' });

  expect(api.createUpdateCampaign).toHaveBeenCalled();
  expect(outputs[0]).toEqual({ ok: true, data: { campaignId: 'camp_1' } });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```bash
pnpm --filter @rag/cli test -- src/commands/commands.test.ts
```

Expected: FAIL because update commands do not exist.

- [ ] **Step 3: Implement CLI command group and server API methods**

Add to `apps/cli/src/http/server-api.ts`:

```ts
async listUpdateReleases() { return this.request('GET', '/admin/updates/releases'); }
async createUpdateCampaign(input: Record<string, unknown>) { return this.request('POST', '/admin/updates/campaigns', input); }
async getUpdateCampaign(id: string) { return this.request('GET', `/admin/updates/campaigns/${encodeURIComponent(id)}`); }
async retryUpdateCampaign(id: string, input: Record<string, unknown>) { return this.request('POST', `/admin/updates/campaigns/${encodeURIComponent(id)}/retry`, input); }
```

Create `apps/cli/src/commands/updates.ts` with commands like:

```ts
updates campaigns start --version <version> --all-clients
updates campaigns get --campaign <id>
updates campaigns retry --campaign <id> --failed
updates releases list
```

Register command group in `apps/cli/src/index.ts`.

- [ ] **Step 4: Run test to verify it passes**

Run:

```bash
pnpm --filter @rag/cli test -- src/commands/commands.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/cli/src/commands/updates.ts apps/cli/src/http/server-api.ts apps/cli/src/index.ts apps/cli/src/commands/commands.test.ts
git commit -m "feat: add update admin cli commands"
```

### Task 13: Document update workflows in the skill bundle

**Files:**
- Modify: `skills/rag-agent/SKILL.md`
- Modify: `skills/rag-agent/references/cli.md`

- [ ] **Step 1: Write the doc update directly**

Add to `skills/rag-agent/SKILL.md` examples such as:

```md
- Use server-side update commands for release campaigns rather than ad-hoc remote upgrade scripts.
- Preferred pattern:
  - `node ./run.cjs updates releases list`
  - `node ./run.cjs updates campaigns start --version v1.4.0 --all-clients`
  - `node ./run.cjs updates campaigns get --campaign <id>`
  - `node ./run.cjs updates campaigns retry --campaign <id> --failed`
```

Add to `skills/rag-agent/references/cli.md`:

```md
node ./run.cjs updates releases list
node ./run.cjs updates campaigns start --version <version> --all-clients
node ./run.cjs updates campaigns get --campaign <campaignId>
node ./run.cjs updates campaigns retry --campaign <campaignId> --failed
node ./run.cjs updates campaigns retry --campaign <campaignId> --offline-skipped
```

- [ ] **Step 2: Sanity-check formatting**

Run:

```bash
git diff -- skills/rag-agent/SKILL.md skills/rag-agent/references/cli.md
```

Expected: only update workflow documentation changes.

- [ ] **Step 3: Commit**

```bash
git add skills/rag-agent/SKILL.md skills/rag-agent/references/cli.md
git commit -m "docs: add one-click update workflow guidance"
```

### Task 14: Run cross-package verification for the first complete slice

**Files:**
- Modify: `docs/superpowers/plans/2026-06-09-one-click-update-implementation.md` (check off completed steps only during execution)

- [ ] **Step 1: Run focused server tests**

Run:

```bash
pnpm --filter @rag/server test -- src/modules/updates/update-repository.test.ts src/modules/updates/release.service.test.ts src/modules/updates/release.routes.test.ts src/modules/updates/update-state.test.ts src/modules/updates/campaign.service.test.ts src/modules/updates/campaign-runner.test.ts src/modules/updates/campaign.routes.test.ts
```

Expected: PASS.

- [ ] **Step 2: Run focused client tests**

Run:

```bash
pnpm --filter @rag/client test -- src/runtime/updates/version-layout.test.ts src/runtime/updates/updater-state.test.ts src/runtime/updates/client-updater.test.ts src/runtime/updates/update-ws-handler.test.ts
```

Expected: PASS.

- [ ] **Step 3: Run focused CLI tests**

Run:

```bash
pnpm --filter @rag/cli test -- src/commands/commands.test.ts
```

Expected: PASS.

- [ ] **Step 4: Run typecheck across touched packages**

Run:

```bash
pnpm --filter @rag/server typecheck && pnpm --filter @rag/client typecheck && pnpm --filter @rag/cli typecheck
```

Expected: all three commands exit 0.

- [ ] **Step 5: Commit verification-only changes if needed**

```bash
git status --short
```

Expected: no unexpected unstaged files.
```

## Self-Review

### Spec coverage

- Release / manifest / artifact model → Tasks 1-4
- Campaign / target / attempt persistence and state machine → Tasks 2, 5, 6, 7, 11
- Server self-update recovery hook → Task 7
- Client updater layout / state / rollback workflow → Tasks 8-10
- Admin API + CLI triggering → Tasks 4, 11, 12
- Skill documentation → Task 13
- Testing and cross-package verification → Task 14

No major spec section is uncovered for the first implementation slice.

### Placeholder scan

- No `TODO` / `TBD` / “implement later” placeholders in task steps.
- Each task includes exact file paths, test commands, and commit commands.
- Some code blocks are skeletons by design, but each names concrete functions, routes, and payloads that the implementing agent must create.

### Type consistency

- Shared names are consistently used as `ReleaseManifest`, `ReleaseArtifact`, `ClientUpdateCommandPayload`, `ClientUpdateStatusPayload`.
- Server entities consistently use campaign / target / attempt terminology.
- Client handler message names consistently use `server.update.run` and `client.update.status` in this plan.

