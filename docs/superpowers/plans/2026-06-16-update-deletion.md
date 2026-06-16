# Update Deletion Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add hard-delete support for update releases and update campaigns in the Server API and Web UI, including force-delete semantics, release file cleanup, and cascading delete of related campaign/target/attempt data.

**Architecture:** Keep existing create/query/update services intact and add dedicated deletion coordination services under `apps/server/src/modules/updates/`. Campaign deletion stays fully transactional in SQL.js. Release deletion uses a file-first coordination flow (`rename to .trash` → DB transaction → final cleanup / rollback) so the public artifact path disappears before database state is committed.

**Tech Stack:** TypeScript, Fastify 5, sql.js, Vitest, React 19, Ant Design 5

---

## File structure map

### Server files to create

- `apps/server/src/modules/updates/update-delete-policy.ts`
  - Centralize active campaign status checks and “can delete / can force delete” policy helpers.
- `apps/server/src/modules/updates/update-delete-errors.ts`
  - Domain error classes / constructors carrying stable error codes for routes.
- `apps/server/src/modules/updates/campaign-deletion.service.ts`
  - Transactional deletion of a non-active campaign and its targets/attempts.
- `apps/server/src/modules/updates/release-deletion.service.ts`
  - Coordinated release deletion with force-delete, campaign cascade, artifact stash/restore, and empty parent cleanup.
- `apps/server/src/modules/updates/campaign-deletion.service.test.ts`
  - Unit tests for campaign deletion rules and cascade counts.
- `apps/server/src/modules/updates/release-deletion.service.test.ts`
  - Unit tests for release deletion rules, force-delete, file rollback, and empty-dir cleanup.

### Server files to modify

- `apps/server/src/modules/updates/update-repository.ts`
  - Add delete/query helpers and a `withTransaction()` wrapper.
- `apps/server/src/modules/updates/update-repository.test.ts`
  - Cover new delete/query/transaction helpers.
- `apps/server/src/modules/updates/campaign.routes.ts`
  - Add `DELETE /admin/updates/campaigns/:id`.
- `apps/server/src/modules/updates/campaign.routes.test.ts`
  - Add delete route coverage.
- `apps/server/src/modules/updates/release.routes.ts`
  - Add `DELETE /admin/updates/releases/:version`.
- `apps/server/src/modules/updates/release.routes.test.ts`
  - Add delete route coverage.
- `apps/server/src/main.ts`
  - Instantiate deletion services and inject them into routes.

### Web files to modify

- `apps/web/src/api/http.ts`
  - Preserve API error codes in thrown errors.
- `apps/web/src/api/__tests__/http.test.ts`
  - Verify error code propagation.
- `apps/web/src/api/updates.ts`
  - Add `deleteRelease()` and `deleteCampaign()` API helpers.
- `apps/web/src/api/__tests__/updates.test.ts`
  - Verify delete helper URLs and force query handling.
- `apps/web/src/pages/UpdatesPage.tsx`
  - Add delete buttons and force-delete confirm flow.
- `apps/web/src/pages/UpdatesPage.test.tsx`
  - Verify release force-delete flow and campaign delete UI behavior.

---

### Task 1: Add shared delete policy and error primitives

**Files:**
- Create: `apps/server/src/modules/updates/update-delete-policy.ts`
- Create: `apps/server/src/modules/updates/update-delete-errors.ts`
- Test: `apps/server/src/modules/updates/campaign-deletion.service.test.ts`
- Test: `apps/server/src/modules/updates/release-deletion.service.test.ts`

- [ ] **Step 1: Write the failing tests indirectly by referencing policy/error behavior from new service tests**

Add these expectations to the top of both future service test files so the first run fails on missing imports:

```ts
import { describe, expect, it } from 'vitest';
import {
  isActiveCampaignStatus,
  assertCampaignDeletable,
  assertReleaseDeletionAllowed,
} from './update-delete-policy.js';
import {
  CampaignActiveNotDeletableError,
  ReleaseInUseError,
  ReleaseReferencedByActiveCampaignError,
} from './update-delete-errors.js';

describe('update delete policy primitives', () => {
  it('treats server_updating and client_updating as active', () => {
    expect(isActiveCampaignStatus('server_updating')).toBe(true);
    expect(isActiveCampaignStatus('client_updating')).toBe(true);
    expect(isActiveCampaignStatus('draft')).toBe(false);
    expect(isActiveCampaignStatus('completed')).toBe(false);
  });

  it('throws the correct domain errors', () => {
    expect(() => assertCampaignDeletable({ status: 'client_updating' })).toThrow(CampaignActiveNotDeletableError);
    expect(() => assertReleaseDeletionAllowed({ activeReferences: 1, inactiveReferences: 0, force: true }))
      .toThrow(ReleaseReferencedByActiveCampaignError);
    expect(() => assertReleaseDeletionAllowed({ activeReferences: 0, inactiveReferences: 1, force: false }))
      .toThrow(ReleaseInUseError);
  });
});
```

- [ ] **Step 2: Run the targeted server tests to confirm the new imports are missing**

Run:

```bash
pnpm --filter @rag/server test -- src/modules/updates/campaign-deletion.service.test.ts src/modules/updates/release-deletion.service.test.ts
```

Expected: FAIL with module resolution errors for `update-delete-policy.ts` and `update-delete-errors.ts`.

- [ ] **Step 3: Create the policy helper file with the minimal deletion rules**

Write `apps/server/src/modules/updates/update-delete-policy.ts`:

```ts
import {
  CampaignActiveNotDeletableError,
  ReleaseInUseError,
  ReleaseReferencedByActiveCampaignError,
} from './update-delete-errors.js';

const ACTIVE_CAMPAIGN_STATUSES = new Set(['server_updating', 'client_updating']);

export function isActiveCampaignStatus(status: string): boolean {
  return ACTIVE_CAMPAIGN_STATUSES.has(status);
}

export function assertCampaignDeletable(input: { status: string }): void {
  if (isActiveCampaignStatus(input.status)) {
    throw new CampaignActiveNotDeletableError(input.status);
  }
}

export function assertReleaseDeletionAllowed(input: {
  activeReferences: number;
  inactiveReferences: number;
  force: boolean;
}): void {
  if (input.activeReferences > 0) {
    throw new ReleaseReferencedByActiveCampaignError(input.activeReferences);
  }
  if (!input.force && input.inactiveReferences > 0) {
    throw new ReleaseInUseError(input.inactiveReferences);
  }
}
```

- [ ] **Step 4: Create typed domain errors with stable codes**

Write `apps/server/src/modules/updates/update-delete-errors.ts`:

```ts
export class UpdateDeleteDomainError extends Error {
  constructor(
    message: string,
    public readonly code:
      | 'CAMPAIGN_NOT_FOUND'
      | 'CAMPAIGN_ACTIVE_NOT_DELETABLE'
      | 'RELEASE_NOT_FOUND'
      | 'RELEASE_IN_USE'
      | 'RELEASE_REFERENCED_BY_ACTIVE_CAMPAIGN'
      | 'DELETE_CONSISTENCY_FAILED',
    public readonly statusCode: number,
    public readonly details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = new.target.name;
  }
}

export class CampaignNotFoundError extends UpdateDeleteDomainError {
  constructor(campaignId: string) {
    super(`Campaign ${campaignId} not found`, 'CAMPAIGN_NOT_FOUND', 404, { campaignId });
  }
}

export class CampaignActiveNotDeletableError extends UpdateDeleteDomainError {
  constructor(status: string) {
    super(`Campaign is active in status ${status}`, 'CAMPAIGN_ACTIVE_NOT_DELETABLE', 409, { status });
  }
}

export class ReleaseNotFoundError extends UpdateDeleteDomainError {
  constructor(version: string) {
    super(`Release ${version} not found`, 'RELEASE_NOT_FOUND', 404, { version });
  }
}

export class ReleaseInUseError extends UpdateDeleteDomainError {
  constructor(referenceCount: number) {
    super('Release is referenced by existing campaigns', 'RELEASE_IN_USE', 409, { referenceCount, canForce: true });
  }
}

export class ReleaseReferencedByActiveCampaignError extends UpdateDeleteDomainError {
  constructor(referenceCount: number) {
    super(
      'Release is referenced by active campaigns',
      'RELEASE_REFERENCED_BY_ACTIVE_CAMPAIGN',
      409,
      { referenceCount, canForce: false },
    );
  }
}

export class DeleteConsistencyFailedError extends UpdateDeleteDomainError {
  constructor(message: string, details?: Record<string, unknown>) {
    super(message, 'DELETE_CONSISTENCY_FAILED', 500, details);
  }
}
```

- [ ] **Step 5: Re-run the targeted tests and commit the new primitives**

Run:

```bash
pnpm --filter @rag/server test -- src/modules/updates/campaign-deletion.service.test.ts src/modules/updates/release-deletion.service.test.ts
```

Expected: FAIL later on missing deletion services, but no longer fail on missing shared policy/error modules.

Commit:

```bash
git add apps/server/src/modules/updates/update-delete-policy.ts apps/server/src/modules/updates/update-delete-errors.ts apps/server/src/modules/updates/campaign-deletion.service.test.ts apps/server/src/modules/updates/release-deletion.service.test.ts
git commit -m "test: define update deletion policy primitives"
```

---

### Task 2: Extend the update repository for delete workflows

**Files:**
- Modify: `apps/server/src/modules/updates/update-repository.ts`
- Modify: `apps/server/src/modules/updates/update-repository.test.ts`

- [ ] **Step 1: Add failing repository tests for lookup, deletion, and transaction rollback**

Append to `apps/server/src/modules/updates/update-repository.test.ts`:

```ts
it('lists release-linked campaigns and deletes attempts/targets/campaigns/releases', () => {
  const repo = createUpdateRepository(db);
  const now = Date.now();

  repo.saveRelease({ version: 'v2.0.0', manifestJson: '{}', enabled: true, createdAt: now, updatedAt: now });
  repo.saveCampaign({
    id: 'camp_delete_1',
    targetVersion: 'v2.0.0',
    scopeJson: '{"all":true}',
    includeServer: false,
    batchSize: 10,
    maxConcurrency: 5,
    status: 'completed',
    createdBy: 'spec',
    createdAt: now,
    updatedAt: now,
  });
  repo.saveTarget({
    id: 'target_delete_1',
    campaignId: 'camp_delete_1',
    targetType: 'client',
    clientId: 'client-1',
    platform: 'windows',
    currentVersion: 'v1.0.0',
    targetVersion: 'v2.0.0',
    phase: 'succeeded',
    attemptCount: 1,
    createdAt: now,
    updatedAt: now,
  });
  repo.saveAttempt({
    id: 'attempt_delete_1',
    targetId: 'target_delete_1',
    attemptNo: 1,
    phaseTimelineJson: '[]',
    result: 'succeeded',
    createdAt: now,
    updatedAt: now,
  });

  expect(repo.listCampaignsByTargetVersion('v2.0.0').map((item) => item.id)).toEqual(['camp_delete_1']);
  expect(repo.listTargetsByCampaignIds(['camp_delete_1']).map((item) => item.id)).toEqual(['target_delete_1']);
  expect(repo.deleteAttemptsByTargetIds(['target_delete_1'])).toBe(1);
  expect(repo.deleteTargetsByCampaignIds(['camp_delete_1'])).toBe(1);
  expect(repo.deleteCampaignsByIds(['camp_delete_1'])).toBe(1);
  expect(repo.deleteRelease('v2.0.0')).toBe(1);
});

it('rolls back transaction work when withTransaction throws', () => {
  const repo = createUpdateRepository(db);
  const now = Date.now();

  repo.saveCampaign({
    id: 'camp_tx_1',
    targetVersion: 'v9.9.9',
    scopeJson: '{"all":true}',
    includeServer: false,
    batchSize: 10,
    maxConcurrency: 5,
    status: 'completed',
    createdBy: 'spec',
    createdAt: now,
    updatedAt: now,
  });

  expect(() => repo.withTransaction(() => {
    repo.deleteCampaignsByIds(['camp_tx_1']);
    throw new Error('boom');
  })).toThrow('boom');

  expect(repo.getCampaign('camp_tx_1')?.id).toBe('camp_tx_1');
});
```

- [ ] **Step 2: Run the repository test file and confirm missing methods fail**

Run:

```bash
pnpm --filter @rag/server test -- src/modules/updates/update-repository.test.ts
```

Expected: FAIL with missing method errors for `listCampaignsByTargetVersion`, `listTargetsByCampaignIds`, deletion helpers, and `withTransaction`.

- [ ] **Step 3: Add repository query/delete helpers and transaction support**

Update `apps/server/src/modules/updates/update-repository.ts` with these additions inside the returned object:

```ts
withTransaction<T>(fn: () => T): T {
  db.run('BEGIN');
  try {
    const result = fn();
    db.run('COMMIT');
    return result;
  } catch (error) {
    db.run('ROLLBACK');
    throw error;
  }
},

listCampaignsByTargetVersion(version: string): UpdateCampaignRecord[] {
  return queryAll(
    db,
    'SELECT * FROM update_campaigns WHERE target_version = ? ORDER BY created_at DESC',
    [version],
  ).map(rowToCampaign);
},

deleteCampaign(id: string): number {
  db.run('DELETE FROM update_campaigns WHERE id = ?', [id]);
  return db.getRowsModified();
},

deleteCampaignsByIds(ids: string[]): number {
  if (ids.length === 0) return 0;
  const placeholders = ids.map(() => '?').join(', ');
  db.run(`DELETE FROM update_campaigns WHERE id IN (${placeholders})`, ids);
  return db.getRowsModified();
},

deleteRelease(version: string): number {
  db.run('DELETE FROM update_releases WHERE version = ?', [version]);
  return db.getRowsModified();
},

listTargetsByCampaignIds(campaignIds: string[]): UpdateTargetRecord[] {
  if (campaignIds.length === 0) return [];
  const placeholders = campaignIds.map(() => '?').join(', ');
  return queryAll(
    db,
    `SELECT * FROM update_targets WHERE campaign_id IN (${placeholders}) ORDER BY created_at ASC`,
    campaignIds,
  ).map(rowToTarget);
},

deleteTargetsByCampaignIds(campaignIds: string[]): number {
  if (campaignIds.length === 0) return 0;
  const placeholders = campaignIds.map(() => '?').join(', ');
  db.run(`DELETE FROM update_targets WHERE campaign_id IN (${placeholders})`, campaignIds);
  return db.getRowsModified();
},

deleteAttemptsByTargetIds(targetIds: string[]): number {
  if (targetIds.length === 0) return 0;
  const placeholders = targetIds.map(() => '?').join(', ');
  db.run(`DELETE FROM update_attempts WHERE target_id IN (${placeholders})`, targetIds);
  return db.getRowsModified();
},
```

- [ ] **Step 4: Re-run the repository tests to verify the helpers pass**

Run:

```bash
pnpm --filter @rag/server test -- src/modules/updates/update-repository.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit the repository support layer**

```bash
git add apps/server/src/modules/updates/update-repository.ts apps/server/src/modules/updates/update-repository.test.ts
git commit -m "test: cover update repository delete helpers"
```

---

### Task 3: Implement campaign deletion service

**Files:**
- Create: `apps/server/src/modules/updates/campaign-deletion.service.ts`
- Modify: `apps/server/src/modules/updates/campaign-deletion.service.test.ts`

- [ ] **Step 1: Write the failing campaign deletion service tests**

Write `apps/server/src/modules/updates/campaign-deletion.service.test.ts`:

```ts
import { beforeAll, describe, expect, it } from 'vitest';
import initSqlJs, { type Database } from 'sql.js';
import { migrate } from '../../db/migrate.js';
import { createUpdateRepository } from './update-repository.js';
import { createCampaignDeletionService } from './campaign-deletion.service.js';
import { CampaignActiveNotDeletableError, CampaignNotFoundError } from './update-delete-errors.js';

describe('campaign deletion service', () => {
  let db: Database;

  beforeAll(async () => {
    const SQL = await initSqlJs();
    db = new SQL.Database();
    migrate(db);
  });

  it('deletes a completed campaign and its related targets/attempts', () => {
    const repo = createUpdateRepository(db);
    const now = Date.now();

    repo.saveCampaign({
      id: 'camp_del_ok',
      targetVersion: 'v1.4.0',
      scopeJson: '{"all":true}',
      includeServer: false,
      batchSize: 10,
      maxConcurrency: 5,
      status: 'completed',
      createdBy: 'spec',
      createdAt: now,
      updatedAt: now,
    });
    repo.saveTarget({
      id: 'target_del_ok',
      campaignId: 'camp_del_ok',
      targetType: 'client',
      clientId: 'client-1',
      platform: 'windows',
      currentVersion: 'v1.3.0',
      targetVersion: 'v1.4.0',
      phase: 'succeeded',
      attemptCount: 1,
      createdAt: now,
      updatedAt: now,
    });
    repo.saveAttempt({
      id: 'attempt_del_ok',
      targetId: 'target_del_ok',
      attemptNo: 1,
      phaseTimelineJson: '[]',
      result: 'succeeded',
      createdAt: now,
      updatedAt: now,
    });

    const service = createCampaignDeletionService({ repo });
    expect(service.deleteCampaign({ campaignId: 'camp_del_ok', force: false })).toEqual({
      campaignId: 'camp_del_ok',
      force: false,
      deletedTargetCount: 1,
      deletedAttemptCount: 1,
    });
    expect(repo.getCampaign('camp_del_ok')).toBeUndefined();
    expect(repo.listTargets('camp_del_ok')).toEqual([]);
  });

  it('rejects deleting an active campaign', () => {
    const repo = createUpdateRepository(db);
    const now = Date.now();
    repo.saveCampaign({
      id: 'camp_del_active',
      targetVersion: 'v1.4.0',
      scopeJson: '{"all":true}',
      includeServer: false,
      batchSize: 10,
      maxConcurrency: 5,
      status: 'client_updating',
      createdBy: 'spec',
      createdAt: now,
      updatedAt: now,
    });

    const service = createCampaignDeletionService({ repo });
    expect(() => service.deleteCampaign({ campaignId: 'camp_del_active', force: true }))
      .toThrow(CampaignActiveNotDeletableError);
  });

  it('rejects deleting a missing campaign', () => {
    const repo = createUpdateRepository(db);
    const service = createCampaignDeletionService({ repo });
    expect(() => service.deleteCampaign({ campaignId: 'missing', force: false })).toThrow(CampaignNotFoundError);
  });
});
```

- [ ] **Step 2: Run the campaign deletion tests to confirm the service is missing**

Run:

```bash
pnpm --filter @rag/server test -- src/modules/updates/campaign-deletion.service.test.ts
```

Expected: FAIL with `createCampaignDeletionService` missing.

- [ ] **Step 3: Implement the transactional service**

Write `apps/server/src/modules/updates/campaign-deletion.service.ts`:

```ts
import { CampaignNotFoundError } from './update-delete-errors.js';
import { assertCampaignDeletable } from './update-delete-policy.js';

export function createCampaignDeletionService(deps: {
  repo: {
    getCampaign(id: string): { id: string; status: string } | undefined;
    listTargets(campaignId: string): Array<{ id: string }>;
    deleteAttemptsByTargetIds(targetIds: string[]): number;
    deleteTargetsByCampaignIds(campaignIds: string[]): number;
    deleteCampaignsByIds(campaignIds: string[]): number;
    withTransaction<T>(fn: () => T): T;
  };
}) {
  return {
    deleteCampaign(input: { campaignId: string; force: boolean }) {
      const campaign = deps.repo.getCampaign(input.campaignId);
      if (!campaign) throw new CampaignNotFoundError(input.campaignId);
      assertCampaignDeletable({ status: campaign.status });

      const targets = deps.repo.listTargets(input.campaignId);
      const targetIds = targets.map((target) => target.id);

      return deps.repo.withTransaction(() => {
        const deletedAttemptCount = deps.repo.deleteAttemptsByTargetIds(targetIds);
        const deletedTargetCount = deps.repo.deleteTargetsByCampaignIds([input.campaignId]);
        deps.repo.deleteCampaignsByIds([input.campaignId]);
        return {
          campaignId: input.campaignId,
          force: input.force,
          deletedTargetCount,
          deletedAttemptCount,
        };
      });
    },
  };
}
```

- [ ] **Step 4: Re-run the service tests to verify campaign deletion behavior**

Run:

```bash
pnpm --filter @rag/server test -- src/modules/updates/campaign-deletion.service.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit the campaign deletion service**

```bash
git add apps/server/src/modules/updates/campaign-deletion.service.ts apps/server/src/modules/updates/campaign-deletion.service.test.ts
git commit -m "feat: add campaign deletion service"
```

---

### Task 4: Expose campaign deletion through Fastify routes

**Files:**
- Modify: `apps/server/src/modules/updates/campaign.routes.ts`
- Modify: `apps/server/src/modules/updates/campaign.routes.test.ts`

- [ ] **Step 1: Write failing route tests for campaign delete success and active rejection**

Update `apps/server/src/modules/updates/campaign.routes.test.ts`:

```ts
import { CampaignActiveNotDeletableError } from './update-delete-errors.js';

it('deletes a campaign through the admin route', async () => {
  const app = Fastify();
  await app.register(campaignRoutes, {
    service: {
      createCampaign: vi.fn().mockReturnValue({ campaignId: 'camp_1' }),
      retryTargets: vi.fn().mockReturnValue([{ id: 'target_1' }]),
      getCampaign: vi.fn().mockReturnValue({ id: 'camp_1' }),
      listCampaigns: vi.fn().mockReturnValue([{ id: 'camp_1' }]),
      listTargets: vi.fn().mockReturnValue([]),
      listAttempts: vi.fn().mockReturnValue([{ id: 'attempt_1' }]),
    },
    deletionService: {
      deleteCampaign: vi.fn().mockReturnValue({
        campaignId: 'camp_1',
        force: false,
        deletedTargetCount: 1,
        deletedAttemptCount: 2,
      }),
    },
  } as any);

  const res = await app.inject({ method: 'DELETE', url: '/admin/updates/campaigns/camp_1' });
  expect(res.statusCode).toBe(200);
  expect(res.json().data.deletedAttemptCount).toBe(2);
});

it('maps active campaign delete errors to 409', async () => {
  const app = Fastify();
  await app.register(campaignRoutes, {
    service: {
      createCampaign: vi.fn(),
      retryTargets: vi.fn(),
      getCampaign: vi.fn(),
      listCampaigns: vi.fn().mockReturnValue([]),
      listTargets: vi.fn().mockReturnValue([]),
      listAttempts: vi.fn().mockReturnValue([]),
    },
    deletionService: {
      deleteCampaign: vi.fn().mockImplementation(() => {
        throw new CampaignActiveNotDeletableError('client_updating');
      }),
    },
  } as any);

  const res = await app.inject({ method: 'DELETE', url: '/admin/updates/campaigns/camp_1?force=true' });
  expect(res.statusCode).toBe(409);
  expect(res.json().error.code).toBe('CAMPAIGN_ACTIVE_NOT_DELETABLE');
});
```

- [ ] **Step 2: Run the campaign route test file and confirm the new route fails**

Run:

```bash
pnpm --filter @rag/server test -- src/modules/updates/campaign.routes.test.ts
```

Expected: FAIL because `deletionService` is ignored and `DELETE` route is missing.

- [ ] **Step 3: Add delete route plumbing and error mapping**

Update `apps/server/src/modules/updates/campaign.routes.ts`:

```ts
import { UpdateDeleteDomainError } from './update-delete-errors.js';

export async function campaignRoutes(
  app: FastifyInstance,
  opts: {
    service: CampaignService;
    executor?: CampaignExecutorForRoutes;
    deletionService?: {
      deleteCampaign(input: { campaignId: string; force: boolean }): {
        campaignId: string;
        force: boolean;
        deletedTargetCount: number;
        deletedAttemptCount: number;
      };
    };
  },
): Promise<void> {
  const { service, executor, deletionService } = opts;

  // ...existing routes...

  app.delete<{ Params: { id: string }; Querystring: { force?: string } }>(
    '/admin/updates/campaigns/:id',
    async (request, reply) => {
      if (!deletionService) {
        return reply.code(501).send({ ok: false, error: { code: 'NOT_IMPLEMENTED', message: 'Deletion service not available' } });
      }
      try {
        return {
          ok: true,
          data: deletionService.deleteCampaign({
            campaignId: request.params.id,
            force: request.query.force === 'true',
          }),
        };
      } catch (err) {
        if (err instanceof UpdateDeleteDomainError) {
          return reply.code(err.statusCode).send({
            ok: false,
            error: { code: err.code, message: err.message, details: err.details },
          });
        }
        return reply.code(500).send({
          ok: false,
          error: { code: 'DELETE_CONSISTENCY_FAILED', message: err instanceof Error ? err.message : String(err) },
        });
      }
    },
  );
}
```

- [ ] **Step 4: Re-run the route tests**

Run:

```bash
pnpm --filter @rag/server test -- src/modules/updates/campaign.routes.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit the route wiring**

```bash
git add apps/server/src/modules/updates/campaign.routes.ts apps/server/src/modules/updates/campaign.routes.test.ts
git commit -m "feat: add campaign delete route"
```

---

### Task 5: Implement release deletion service with file coordination

**Files:**
- Create: `apps/server/src/modules/updates/release-deletion.service.ts`
- Modify: `apps/server/src/modules/updates/release-deletion.service.test.ts`

- [ ] **Step 1: Write failing tests for release delete, force-delete, and rollback**

Write `apps/server/src/modules/updates/release-deletion.service.test.ts`:

```ts
import { mkdirSync, readdirSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { beforeAll, afterEach, describe, expect, it, vi } from 'vitest';
import initSqlJs, { type Database } from 'sql.js';
import { migrate } from '../../db/migrate.js';
import { createUpdateRepository } from './update-repository.js';
import { createReleaseDeletionService } from './release-deletion.service.js';
import { ReleaseInUseError, ReleaseReferencedByActiveCampaignError } from './update-delete-errors.js';

describe('release deletion service', () => {
  let db: Database;
  const tmpRoots: string[] = [];

  beforeAll(async () => {
    const SQL = await initSqlJs();
    db = new SQL.Database();
    migrate(db);
  });

  afterEach(() => {
    while (tmpRoots.length > 0) {
      rmSync(tmpRoots.pop()!, { recursive: true, force: true });
    }
  });

  function makeStorageRoot() {
    const root = path.join(os.tmpdir(), `rag-update-delete-${Date.now()}-${Math.random().toString(16).slice(2)}`);
    mkdirSync(path.join(root, 'artifacts'), { recursive: true });
    tmpRoots.push(root);
    return root;
  }

  it('deletes an unreferenced release and its artifact directory', () => {
    const repo = createUpdateRepository(db);
    const now = Date.now();
    repo.saveRelease({ version: 'v2.1.0', manifestJson: '{}', enabled: true, createdAt: now, updatedAt: now });

    const storageRoot = makeStorageRoot();
    const releaseDir = path.join(storageRoot, 'artifacts', 'v2.1.0');
    mkdirSync(releaseDir, { recursive: true });
    writeFileSync(path.join(releaseDir, 'client.zip'), 'demo');

    const service = createReleaseDeletionService({
      repo,
      storage: { releasesDir: storageRoot, artifactDir: (version: string) => path.join(storageRoot, 'artifacts', version) },
      fileOps: { renameSync, rmSync, readdirSync, mkdirSync },
      idFactory: () => 'trash-1',
    });

    expect(service.deleteRelease({ version: 'v2.1.0', force: false })).toEqual({
      version: 'v2.1.0',
      force: false,
      deletedCampaignCount: 0,
      deletedTargetCount: 0,
      deletedAttemptCount: 0,
      deletedArtifactDir: true,
    });
    expect(repo.getRelease('v2.1.0')).toBeUndefined();
  });

  it('requires force when inactive campaign references exist', () => {
    const repo = createUpdateRepository(db);
    const now = Date.now();
    repo.saveRelease({ version: 'v2.2.0', manifestJson: '{}', enabled: true, createdAt: now, updatedAt: now });
    repo.saveCampaign({
      id: 'camp_ref_1',
      targetVersion: 'v2.2.0',
      scopeJson: '{"all":true}',
      includeServer: false,
      batchSize: 10,
      maxConcurrency: 5,
      status: 'completed',
      createdBy: 'spec',
      createdAt: now,
      updatedAt: now,
    });

    const service = createReleaseDeletionService({
      repo,
      storage: { releasesDir: makeStorageRoot(), artifactDir: (version: string) => path.join(makeStorageRoot(), 'artifacts', version) },
      fileOps: { renameSync, rmSync, readdirSync, mkdirSync },
      idFactory: () => 'trash-2',
    });

    expect(() => service.deleteRelease({ version: 'v2.2.0', force: false })).toThrow(ReleaseInUseError);
  });

  it('blocks force delete when active campaign references exist', () => {
    const repo = createUpdateRepository(db);
    const now = Date.now();
    repo.saveRelease({ version: 'v2.3.0', manifestJson: '{}', enabled: true, createdAt: now, updatedAt: now });
    repo.saveCampaign({
      id: 'camp_ref_active',
      targetVersion: 'v2.3.0',
      scopeJson: '{"all":true}',
      includeServer: false,
      batchSize: 10,
      maxConcurrency: 5,
      status: 'client_updating',
      createdBy: 'spec',
      createdAt: now,
      updatedAt: now,
    });

    const service = createReleaseDeletionService({
      repo,
      storage: { releasesDir: makeStorageRoot(), artifactDir: (version: string) => path.join(makeStorageRoot(), 'artifacts', version) },
      fileOps: { renameSync, rmSync, readdirSync, mkdirSync },
      idFactory: () => 'trash-3',
    });

    expect(() => service.deleteRelease({ version: 'v2.3.0', force: true }))
      .toThrow(ReleaseReferencedByActiveCampaignError);
  });

  it('restores the artifact directory when database work fails after stashing', () => {
    const repo = createUpdateRepository(db);
    const now = Date.now();
    repo.saveRelease({ version: 'v2.4.0', manifestJson: '{}', enabled: true, createdAt: now, updatedAt: now });

    const storageRoot = makeStorageRoot();
    const releaseDir = path.join(storageRoot, 'artifacts', 'v2.4.0');
    mkdirSync(releaseDir, { recursive: true });
    writeFileSync(path.join(releaseDir, 'server.tar.gz'), 'demo');

    const service = createReleaseDeletionService({
      repo: {
        ...repo,
        withTransaction: vi.fn().mockImplementation(() => {
          throw new Error('db failed');
        }),
      },
      storage: { releasesDir: storageRoot, artifactDir: (version: string) => path.join(storageRoot, 'artifacts', version) },
      fileOps: { renameSync, rmSync, readdirSync, mkdirSync },
      idFactory: () => 'trash-4',
    });

    expect(() => service.deleteRelease({ version: 'v2.4.0', force: false })).toThrow('db failed');
    expect(readdirSync(path.join(storageRoot, 'artifacts'))).toContain('v2.4.0');
  });
});
```

- [ ] **Step 2: Run the release deletion tests to confirm the service is missing**

Run:

```bash
pnpm --filter @rag/server test -- src/modules/updates/release-deletion.service.test.ts
```

Expected: FAIL with missing `createReleaseDeletionService`.

- [ ] **Step 3: Implement the coordinated release deletion service**

Write `apps/server/src/modules/updates/release-deletion.service.ts`:

```ts
import path from 'node:path';
import {
  DeleteConsistencyFailedError,
  ReleaseNotFoundError,
} from './update-delete-errors.js';
import { assertReleaseDeletionAllowed, isActiveCampaignStatus } from './update-delete-policy.js';

export function createReleaseDeletionService(deps: {
  repo: {
    getRelease(version: string): { version: string } | undefined;
    listCampaignsByTargetVersion(version: string): Array<{ id: string; status: string }>;
    listTargetsByCampaignIds(campaignIds: string[]): Array<{ id: string }>;
    deleteAttemptsByTargetIds(targetIds: string[]): number;
    deleteTargetsByCampaignIds(campaignIds: string[]): number;
    deleteCampaignsByIds(campaignIds: string[]): number;
    deleteRelease(version: string): number;
    withTransaction<T>(fn: () => T): T;
  };
  storage: {
    releasesDir: string;
    artifactDir(version: string): string;
  };
  fileOps: {
    renameSync(from: string, to: string): void;
    rmSync(target: string, options: { recursive: true; force: true }): void;
    readdirSync(target: string): string[];
    mkdirSync(target: string, options: { recursive: true }): void;
  };
  idFactory: () => string;
}) {
  function cleanupEmptyParents(startDir: string): void {
    const boundary = path.resolve(deps.storage.releasesDir);
    let current = path.resolve(path.dirname(startDir));

    while (current.startsWith(boundary) && current !== boundary) {
      if (deps.fileOps.readdirSync(current).length > 0) break;
      deps.fileOps.rmSync(current, { recursive: true, force: true });
      current = path.dirname(current);
    }
  }

  return {
    deleteRelease(input: { version: string; force: boolean }) {
      const release = deps.repo.getRelease(input.version);
      if (!release) throw new ReleaseNotFoundError(input.version);

      const campaigns = deps.repo.listCampaignsByTargetVersion(input.version);
      const activeReferences = campaigns.filter((campaign) => isActiveCampaignStatus(campaign.status));
      const inactiveReferences = campaigns.filter((campaign) => !isActiveCampaignStatus(campaign.status));
      assertReleaseDeletionAllowed({
        activeReferences: activeReferences.length,
        inactiveReferences: inactiveReferences.length,
        force: input.force,
      });

      const campaignIds = input.force ? inactiveReferences.map((campaign) => campaign.id) : [];
      const targetIds = deps.repo.listTargetsByCampaignIds(campaignIds).map((target) => target.id);
      const artifactDir = deps.storage.artifactDir(input.version);
      const trashRoot = path.join(deps.storage.releasesDir, '.trash');
      const trashDir = path.join(trashRoot, `${deps.idFactory()}-${input.version}`);
      let artifactStashed = false;

      deps.fileOps.mkdirSync(trashRoot, { recursive: true });
      try {
        deps.fileOps.renameSync(artifactDir, trashDir);
        artifactStashed = true;
      } catch {
        artifactStashed = false;
      }

      try {
        const result = deps.repo.withTransaction(() => {
          const deletedAttemptCount = deps.repo.deleteAttemptsByTargetIds(targetIds);
          const deletedTargetCount = deps.repo.deleteTargetsByCampaignIds(campaignIds);
          const deletedCampaignCount = deps.repo.deleteCampaignsByIds(campaignIds);
          deps.repo.deleteRelease(input.version);
          return {
            version: input.version,
            force: input.force,
            deletedCampaignCount,
            deletedTargetCount,
            deletedAttemptCount,
            deletedArtifactDir: artifactStashed,
          };
        });

        if (artifactStashed) {
          deps.fileOps.rmSync(trashDir, { recursive: true, force: true });
          cleanupEmptyParents(artifactDir);
        }
        return result;
      } catch (error) {
        if (artifactStashed) {
          try {
            deps.fileOps.renameSync(trashDir, artifactDir);
          } catch (rollbackError) {
            throw new DeleteConsistencyFailedError('Failed to restore release artifacts after transaction error', {
              version: input.version,
              cause: error instanceof Error ? error.message : String(error),
              rollbackCause: rollbackError instanceof Error ? rollbackError.message : String(rollbackError),
            });
          }
        }
        throw error;
      }
    },
  };
}
```

- [ ] **Step 4: Re-run the release deletion tests**

Run:

```bash
pnpm --filter @rag/server test -- src/modules/updates/release-deletion.service.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit the release deletion service**

```bash
git add apps/server/src/modules/updates/release-deletion.service.ts apps/server/src/modules/updates/release-deletion.service.test.ts
git commit -m "feat: add release deletion service"
```

---

### Task 6: Expose release deletion through Fastify routes and main wiring

**Files:**
- Modify: `apps/server/src/modules/updates/release.routes.ts`
- Modify: `apps/server/src/modules/updates/release.routes.test.ts`
- Modify: `apps/server/src/main.ts`

- [ ] **Step 1: Add failing route tests for release delete success and conflict**

Update `apps/server/src/modules/updates/release.routes.test.ts`:

```ts
import { ReleaseInUseError } from './update-delete-errors.js';

it('deletes a release through the admin route', async () => {
  const app = Fastify();
  await app.register(releaseRoutes, {
    service: {
      listReleases: () => [{ version: 'v1.4.0' }],
      getRelease: vi.fn().mockReturnValue({ version: 'v1.4.0' }),
      registerRelease: vi.fn().mockReturnValue({ version: 'v1.4.0' }),
      getArtifactDownload: vi.fn().mockReturnValue({ path: '/tmp/client.zip' }),
      getArtifactDir: vi.fn().mockReturnValue('/tmp/artifacts/v1.4.0'),
      deleteRelease: vi.fn().mockReturnValue({
        version: 'v1.4.0',
        force: false,
        deletedCampaignCount: 0,
        deletedTargetCount: 0,
        deletedAttemptCount: 0,
        deletedArtifactDir: true,
      }),
    },
  } as any);

  const res = await app.inject({ method: 'DELETE', url: '/admin/updates/releases/v1.4.0' });
  expect(res.statusCode).toBe(200);
  expect(res.json().data.deletedArtifactDir).toBe(true);
});

it('maps release-in-use conflicts to 409', async () => {
  const app = Fastify();
  await app.register(releaseRoutes, {
    service: {
      listReleases: () => [],
      getRelease: vi.fn(),
      registerRelease: vi.fn(),
      getArtifactDownload: vi.fn(),
      getArtifactDir: vi.fn(),
      deleteRelease: vi.fn().mockImplementation(() => { throw new ReleaseInUseError(1); }),
    },
  } as any);

  const res = await app.inject({ method: 'DELETE', url: '/admin/updates/releases/v1.4.0' });
  expect(res.statusCode).toBe(409);
  expect(res.json().error.code).toBe('RELEASE_IN_USE');
});
```

- [ ] **Step 2: Run the release route test file and confirm delete is missing**

Run:

```bash
pnpm --filter @rag/server test -- src/modules/updates/release.routes.test.ts
```

Expected: FAIL because `deleteRelease` is unused and the route is missing.

- [ ] **Step 3: Add delete route and inject both deletion services in main**

Update `apps/server/src/modules/updates/release.routes.ts` by extending the service interface and adding:

```ts
import { UpdateDeleteDomainError } from './update-delete-errors.js';

export interface ReleaseServiceForRoutes {
  listReleases(): Array<{ version: string; enabled?: boolean }>;
  getRelease(version: string): unknown;
  registerRelease(manifestJson: string): { version: string };
  getArtifactDownload(version: string, artifactName: string): { path: string };
  getArtifactDir(version: string): string;
  deleteRelease(input: {
    version: string;
    force: boolean;
  }): {
    version: string;
    force: boolean;
    deletedCampaignCount: number;
    deletedTargetCount: number;
    deletedAttemptCount: number;
    deletedArtifactDir: boolean;
  };
}

app.delete<{ Params: { version: string }; Querystring: { force?: string } }>(
  '/admin/updates/releases/:version',
  async (request, reply) => {
    try {
      return {
        ok: true,
        data: service.deleteRelease({
          version: request.params.version,
          force: request.query.force === 'true',
        }),
      };
    } catch (err) {
      if (err instanceof UpdateDeleteDomainError) {
        return reply.code(err.statusCode).send({
          ok: false,
          error: { code: err.code, message: err.message, details: err.details },
        });
      }
      return reply.code(500).send({
        ok: false,
        error: { code: 'DELETE_CONSISTENCY_FAILED', message: err instanceof Error ? err.message : String(err) },
      });
    }
  },
);
```

Update `apps/server/src/main.ts` around the updates service construction:

```ts
import { createCampaignDeletionService } from './modules/updates/campaign-deletion.service.js';
import { createReleaseDeletionService } from './modules/updates/release-deletion.service.js';

const campaignDeletionService = createCampaignDeletionService({ repo: updateRepo });
const releaseDeletionService = createReleaseDeletionService({
  repo: updateRepo,
  storage: releaseStorage,
  fileOps: fs,
  idFactory: () => crypto.randomUUID(),
});

await app.register(releaseRoutes, {
  service: {
    listReleases: () => releaseService.listReleases(),
    getRelease: (v: string) => releaseService.getRelease(v),
    registerRelease: (m: string) => releaseService.registerRelease(m),
    getArtifactDownload: (version: string, artifactName: string) => ({
      path: releaseStorage.artifactPath(version, artifactName),
    }),
    getArtifactDir: (version: string) => releaseStorage.artifactDir(version),
    deleteRelease: ({ version, force }) => releaseDeletionService.deleteRelease({ version, force }),
  },
});

await app.register(campaignRoutes, {
  service: campaignService,
  executor: campaignExecutor,
  deletionService: campaignDeletionService,
});
```

- [ ] **Step 4: Re-run the route tests plus a server typecheck**

Run:

```bash
pnpm --filter @rag/server test -- src/modules/updates/release.routes.test.ts src/modules/updates/campaign.routes.test.ts
pnpm --filter @rag/server typecheck
```

Expected: PASS.

- [ ] **Step 5: Commit the server route integration**

```bash
git add apps/server/src/modules/updates/release.routes.ts apps/server/src/modules/updates/release.routes.test.ts apps/server/src/main.ts
git commit -m "feat: wire update deletion routes"
```

---

### Task 7: Preserve API error codes in the Web client

**Files:**
- Modify: `apps/web/src/api/http.ts`
- Modify: `apps/web/src/api/__tests__/http.test.ts`

- [ ] **Step 1: Add a failing test proving Web API errors need a `code` field**

Append to `apps/web/src/api/__tests__/http.test.ts`:

```ts
it('preserves server error codes on thrown api errors', async () => {
  const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({
    ok: false,
    error: { code: 'RELEASE_IN_USE', message: 'Release is referenced by existing campaigns' },
  }), { status: 409 }));

  const api = createApiClient({ baseUrl: 'http://server', getToken: () => 't', fetchImpl: fetchMock as any });

  await expect(api.delete('/admin/updates/releases/v1.4.0')).rejects.toMatchObject({
    code: 'RELEASE_IN_USE',
    message: 'Release is referenced by existing campaigns',
  });
});
```

- [ ] **Step 2: Run the Web HTTP test file and confirm the code is not preserved**

Run:

```bash
pnpm --filter @rag/web test -- src/api/__tests__/http.test.ts
```

Expected: FAIL because the thrown `Error` only contains `message`.

- [ ] **Step 3: Add an `ApiError` class and throw it from the HTTP client**

Update `apps/web/src/api/http.ts`:

```ts
export class ApiError extends Error {
  constructor(
    message: string,
    public readonly code?: string,
    public readonly status?: number,
    public readonly details?: unknown,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

async function request(method: string, path: string, body?: unknown) {
  const headers: Record<string, string> = { Authorization: `Bearer ${options.getToken()}` };
  const init: RequestInit = { method, headers };
  if (body !== undefined) {
    headers['Content-Type'] = 'application/json';
    init.body = JSON.stringify(body);
  }
  const res = await fetcher(`${baseUrl}${path}`, init);
  const text = await res.text();
  const data = text ? JSON.parse(text) : null;
  if (!res.ok) {
    throw new ApiError(
      data?.error?.message ?? data?.error ?? `HTTP ${res.status}`,
      data?.error?.code,
      res.status,
      data?.error?.details,
    );
  }
  return data;
}
```

- [ ] **Step 4: Re-run the Web HTTP tests**

Run:

```bash
pnpm --filter @rag/web test -- src/api/__tests__/http.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit the Web API error propagation**

```bash
git add apps/web/src/api/http.ts apps/web/src/api/__tests__/http.test.ts
git commit -m "feat: preserve api error codes in web client"
```

---

### Task 8: Add release/campaign delete API helpers in the Web layer

**Files:**
- Modify: `apps/web/src/api/updates.ts`
- Modify: `apps/web/src/api/__tests__/updates.test.ts`

- [ ] **Step 1: Add failing update API tests for delete helper URLs**

Append to `apps/web/src/api/__tests__/updates.test.ts`:

```ts
import { deleteCampaign, deleteRelease } from '../updates.js';

it('calls deleteRelease with optional force query', async () => {
  const api = { delete: vi.fn().mockResolvedValue({ data: { version: 'v1.4.0' } }) } as any;
  await deleteRelease(api, 'v1.4.0');
  await deleteRelease(api, 'v1.4.0', { force: true });

  expect(api.delete).toHaveBeenNthCalledWith(1, '/admin/updates/releases/v1.4.0');
  expect(api.delete).toHaveBeenNthCalledWith(2, '/admin/updates/releases/v1.4.0?force=true');
});

it('calls deleteCampaign with optional force query', async () => {
  const api = { delete: vi.fn().mockResolvedValue({ data: { campaignId: 'camp_1' } }) } as any;
  await deleteCampaign(api, 'camp_1');
  await deleteCampaign(api, 'camp_1', { force: true });

  expect(api.delete).toHaveBeenNthCalledWith(1, '/admin/updates/campaigns/camp_1');
  expect(api.delete).toHaveBeenNthCalledWith(2, '/admin/updates/campaigns/camp_1?force=true');
});
```

- [ ] **Step 2: Run the updates API tests and confirm the helpers are missing**

Run:

```bash
pnpm --filter @rag/web test -- src/api/__tests__/updates.test.ts
```

Expected: FAIL because `deleteRelease` and `deleteCampaign` do not exist.

- [ ] **Step 3: Implement typed delete helpers**

Update `apps/web/src/api/updates.ts`:

```ts
export async function deleteRelease(
  api: Api,
  version: string,
  options?: { force?: boolean },
): Promise<{
  version: string;
  force: boolean;
  deletedCampaignCount: number;
  deletedTargetCount: number;
  deletedAttemptCount: number;
  deletedArtifactDir: boolean;
}> {
  const suffix = options?.force ? '?force=true' : '';
  const res = await api.delete(`/admin/updates/releases/${encodeURIComponent(version)}${suffix}`);
  return res.data;
}

export async function deleteCampaign(
  api: Api,
  id: string,
  options?: { force?: boolean },
): Promise<{
  campaignId: string;
  force: boolean;
  deletedTargetCount: number;
  deletedAttemptCount: number;
}> {
  const suffix = options?.force ? '?force=true' : '';
  const res = await api.delete(`/admin/updates/campaigns/${encodeURIComponent(id)}${suffix}`);
  return res.data;
}
```

- [ ] **Step 4: Re-run the updates API tests**

Run:

```bash
pnpm --filter @rag/web test -- src/api/__tests__/updates.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit the Web update delete helpers**

```bash
git add apps/web/src/api/updates.ts apps/web/src/api/__tests__/updates.test.ts
git commit -m "feat: add web update delete helpers"
```

---

### Task 9: Add release deletion UI with force-delete confirmation

**Files:**
- Modify: `apps/web/src/pages/UpdatesPage.tsx`
- Create: `apps/web/src/pages/UpdatesPage.test.tsx`

- [ ] **Step 1: Write a failing UI test for release force-delete flow**

Create `apps/web/src/pages/UpdatesPage.test.tsx`:

```tsx
import { App } from 'antd';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { ApiError } from '../api/http.js';
import { UpdatesPage } from './UpdatesPage.js';

describe('UpdatesPage', () => {
  it('retries release deletion with force after RELEASE_IN_USE', async () => {
    const api = {
      get: vi.fn()
        .mockResolvedValueOnce([{ version: 'v1.4.0', enabled: true }])
        .mockResolvedValueOnce([]),
      post: vi.fn(),
      delete: vi.fn()
        .mockRejectedValueOnce(new ApiError('Release is referenced by existing campaigns', 'RELEASE_IN_USE', 409))
        .mockResolvedValueOnce({
          data: {
            version: 'v1.4.0',
            force: true,
            deletedCampaignCount: 1,
            deletedTargetCount: 2,
            deletedAttemptCount: 3,
            deletedArtifactDir: true,
          },
        }),
    } as any;

    const user = userEvent.setup();
    render(<App><UpdatesPage api={api} /></App>);

    await screen.findByText('v1.4.0');
    await user.click(screen.getByRole('button', { name: '删除' }));
    await user.click(await screen.findByRole('button', { name: '确定' }));
    await user.click(await screen.findByRole('button', { name: '强制删除' }));

    await waitFor(() => {
      expect(api.delete).toHaveBeenNthCalledWith(1, '/admin/updates/releases/v1.4.0');
      expect(api.delete).toHaveBeenNthCalledWith(2, '/admin/updates/releases/v1.4.0?force=true');
    });
  });
});
```

- [ ] **Step 2: Run the new page test and confirm the delete controls do not exist yet**

Run:

```bash
pnpm --filter @rag/web test -- src/pages/UpdatesPage.test.tsx
```

Expected: FAIL because the release table has no delete button and no force-delete modal.

- [ ] **Step 3: Implement release delete UI and force-confirm flow**

Update `apps/web/src/pages/UpdatesPage.tsx` in the release tab:

```tsx
import { ApiError } from '../api/http';
import { deleteCampaign, deleteRelease, /* existing imports... */ } from '../api/updates';

const handleDeleteRelease = async (version: string, force = false) => {
  try {
    const result = await deleteRelease(api, version, force ? { force: true } : undefined);
    message.success(`已删除 ${result.version}`);
    if (detail?.version === version) {
      setDetail(null);
      setDetailOpen(false);
    }
    await load();
  } catch (error) {
    if (error instanceof ApiError && error.code === 'RELEASE_IN_USE' && !force) {
      Modal.confirm({
        title: '该版本已被编排引用',
        content: '强制删除会级联删除关联 campaign、targets 和 attempts。确定继续吗？',
        okText: '强制删除',
        okButtonProps: { danger: true },
        onOk: () => handleDeleteRelease(version, true),
      });
      return;
    }
    message.error(error instanceof Error ? error.message : '删除版本失败');
  }
};
```

Replace the release actions column with:

```tsx
{
  title: '操作',
  key: 'actions',
  width: 180,
  render: (_: unknown, record: ReleaseSummary) => (
    <Space size="small">
      <Button type="link" size="small" onClick={() => handleViewDetail(record.version)}>查看详情</Button>
      <Popconfirm
        title={`确定删除版本 ${record.version} 吗？`}
        okText="确定"
        cancelText="取消"
        onConfirm={() => handleDeleteRelease(record.version)}
      >
        <Button type="link" size="small" danger>删除</Button>
      </Popconfirm>
    </Space>
  ),
}
```

- [ ] **Step 4: Re-run the page test**

Run:

```bash
pnpm --filter @rag/web test -- src/pages/UpdatesPage.test.tsx
```

Expected: PASS.

- [ ] **Step 5: Commit the release deletion UI**

```bash
git add apps/web/src/pages/UpdatesPage.tsx apps/web/src/pages/UpdatesPage.test.tsx
git commit -m "feat: add release deletion ui"
```

---

### Task 10: Add campaign deletion UI and selected-detail cleanup

**Files:**
- Modify: `apps/web/src/pages/UpdatesPage.tsx`
- Modify: `apps/web/src/pages/UpdatesPage.test.tsx`

- [ ] **Step 1: Add a failing UI test for campaign delete and detail cleanup**

Append to `apps/web/src/pages/UpdatesPage.test.tsx`:

```tsx
it('deletes a selected completed campaign and clears its detail panel', async () => {
  const api = {
    get: vi.fn()
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([
        {
          id: 'camp_1',
          targetVersion: 'v1.4.0',
          includeServer: false,
          batchSize: 10,
          maxConcurrency: 5,
          status: 'completed',
          createdBy: 'web-ui',
          createdAt: Date.now(),
        },
      ])
      .mockResolvedValueOnce({
        id: 'camp_1',
        targetVersion: 'v1.4.0',
        includeServer: false,
        batchSize: 10,
        maxConcurrency: 5,
        status: 'completed',
        createdBy: 'web-ui',
        createdAt: Date.now(),
      })
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([]),
    post: vi.fn(),
    delete: vi.fn().mockResolvedValue({
      data: { campaignId: 'camp_1', force: false, deletedTargetCount: 0, deletedAttemptCount: 0 },
    }),
  } as any;

  const user = userEvent.setup();
  render(<App><UpdatesPage api={api} /></App>);

  await user.click(await screen.findByRole('tab', { name: /更新编排/i }));
  await screen.findByText('camp_1');
  await user.click(screen.getByRole('button', { name: '查看' }));
  await screen.findByText(/编排 camp_1/i);
  await user.click(screen.getAllByRole('button', { name: '删除' })[0]);
  await user.click(await screen.findByRole('button', { name: '确定' }));

  await waitFor(() => expect(api.delete).toHaveBeenCalledWith('/admin/updates/campaigns/camp_1'));
  await waitFor(() => expect(screen.queryByText(/编排 camp_1/i)).not.toBeInTheDocument());
});
```

- [ ] **Step 2: Run the page tests and confirm campaign delete behavior is missing**

Run:

```bash
pnpm --filter @rag/web test -- src/pages/UpdatesPage.test.tsx
```

Expected: FAIL because the campaign list has no delete action and selected details are not cleared.

- [ ] **Step 3: Implement campaign delete action and selected state cleanup**

Update `apps/web/src/pages/UpdatesPage.tsx` inside `CampaignsTab`:

```tsx
const handleDeleteCampaign = async (campaignId: string) => {
  try {
    const result = await deleteCampaign(api, campaignId);
    message.success(`已删除编排 ${result.campaignId}`);
    if (selectedCampaign?.id === campaignId) {
      setSelectedCampaign(null);
      setTargets([]);
      setAttempts([]);
    }
    await loadCampaigns();
  } catch (error) {
    message.error(error instanceof Error ? error.message : '删除编排失败');
  }
};
```

Update the campaign list actions column to:

```tsx
{
  title: '操作',
  key: 'actions',
  render: (_: unknown, r: CampaignRecord) => (
    <Space size="small">
      <Button type="link" size="small" onClick={() => handleSelectCampaign(r.id)}>查看</Button>
      <Popconfirm
        title={`确定删除编排 ${r.id.slice(0, 12)}... 吗？`}
        okText="确定"
        cancelText="取消"
        onConfirm={() => handleDeleteCampaign(r.id)}
      >
        <Button type="link" size="small" danger>删除</Button>
      </Popconfirm>
    </Space>
  ),
}
```

- [ ] **Step 4: Re-run the UpdatesPage tests**

Run:

```bash
pnpm --filter @rag/web test -- src/pages/UpdatesPage.test.tsx
```

Expected: PASS.

- [ ] **Step 5: Commit the campaign deletion UI**

```bash
git add apps/web/src/pages/UpdatesPage.tsx apps/web/src/pages/UpdatesPage.test.tsx
git commit -m "feat: add campaign deletion ui"
```

---

### Task 11: Full verification and cleanup

**Files:**
- Modify: `TODO.md`
- Review: changed files from Tasks 1-10

- [ ] **Step 1: Run focused server and web test suites for update deletion**

Run:

```bash
pnpm --filter @rag/server test -- src/modules/updates/update-repository.test.ts src/modules/updates/campaign-deletion.service.test.ts src/modules/updates/release-deletion.service.test.ts src/modules/updates/campaign.routes.test.ts src/modules/updates/release.routes.test.ts
pnpm --filter @rag/web test -- src/api/__tests__/http.test.ts src/api/__tests__/updates.test.ts src/pages/UpdatesPage.test.tsx
```

Expected: PASS.

- [ ] **Step 2: Run package typechecks for touched apps**

Run:

```bash
pnpm --filter @rag/server typecheck
pnpm --filter @rag/web typecheck
```

Expected: PASS.

- [ ] **Step 3: Run the repo-required verification command before claiming completion**

Run:

```bash
pnpm typecheck && pnpm test
```

Expected: PASS across the monorepo.

- [ ] **Step 4: Update task tracking and review the diff for scope control**

Run:

```bash
git diff --stat
git diff -- apps/server/src/modules/updates apps/web/src/api apps/web/src/pages/UpdatesPage.tsx apps/web/src/pages/UpdatesPage.test.tsx
```

Expected: Diff limited to update deletion support, supporting API error propagation, tests, and tracking updates.

Then update `TODO.md` to reflect completed brainstorming/plan state and implementation status.

- [ ] **Step 5: Commit the final integrated feature**

```bash
git add apps/server/src/modules/updates apps/server/src/main.ts apps/web/src/api apps/web/src/pages/UpdatesPage.tsx apps/web/src/pages/UpdatesPage.test.tsx TODO.md
git commit -m "feat: add update deletion management"
```

---

## Self-review checklist

### Spec coverage

- Release delete API: covered in Tasks 5 and 6.
- Campaign delete API: covered in Tasks 3 and 4.
- Force delete semantics for release: covered in Tasks 1, 5, and 9.
- Active campaign protection: covered in Tasks 1, 3, 4, and 5.
- Release artifact cleanup and rollback: covered in Task 5.
- Web list-page delete interactions: covered in Tasks 9 and 10.
- Error-code-based UI flow: covered in Tasks 7, 8, 9, and 10.
- Verification requirements: covered in Task 11.

### Placeholder scan

- No `TODO`, `TBD`, or “implement later” placeholders in plan steps.
- Every code step includes concrete code.
- Every verification step includes exact commands and expected outcomes.

### Type consistency

- Domain error codes are defined once in `update-delete-errors.ts` and reused in routes and UI.
- Delete service method names are consistent across services, routes, main wiring, and API helpers:
  - `deleteCampaign`
  - `deleteRelease`
- Repository helper names are consistent across Tasks 2, 3, and 5.

---
