import { describe, it, expect, beforeAll } from 'vitest';
import initSqlJs, { type Database } from 'sql.js';
import { migrate } from '../../db/migrate.js';
import { createUpdateRepository } from './update-repository.js';
import type { UpdateReleaseRecord, UpdateCampaignRecord, UpdateTargetRecord, UpdateAttemptRecord } from './update-types.js';

describe('update repository', () => {
  let db: Database;

  beforeAll(async () => {
    const SQL = await initSqlJs();
    db = new SQL.Database();
    migrate(db);
  });

  it('persists releases, campaigns, targets, and attempts', () => {
    const repo = createUpdateRepository(db);
    const now = Date.now();

    const release: UpdateReleaseRecord = {
      version: 'v1.4.0',
      manifestJson: '{"version":"v1.4.0"}',
      enabled: true,
      createdAt: now,
      updatedAt: now,
    };
    repo.saveRelease(release);

    const campaign: UpdateCampaignRecord = {
      id: 'camp_1',
      targetVersion: 'v1.4.0',
      scopeJson: '{"all":true}',
      includeServer: true,
      batchSize: 10,
      maxConcurrency: 5,
      status: 'draft',
      createdBy: 'admin',
      createdAt: now,
      updatedAt: now,
    };
    repo.saveCampaign(campaign);

    const target: UpdateTargetRecord = {
      id: 'target_1',
      campaignId: 'camp_1',
      targetType: 'client',
      clientId: 'client-1',
      platform: 'windows',
      currentVersion: '0.1.0',
      targetVersion: 'v1.4.0',
      phase: 'queued',
      attemptCount: 0,
      createdAt: now,
      updatedAt: now,
    };
    repo.saveTarget(target);

    const attempt: UpdateAttemptRecord = {
      id: 'att_1',
      targetId: 'target_1',
      attemptNo: 1,
      phaseTimelineJson: '[]',
      result: 'running',
      createdAt: now,
      updatedAt: now,
    };
    repo.saveAttempt(attempt);

    expect(repo.getRelease('v1.4.0')?.version).toBe('v1.4.0');
    expect(repo.listReleases()).toHaveLength(1);
    expect(repo.getCampaign('camp_1')?.status).toBe('draft');
    expect(repo.listTargets('camp_1')).toHaveLength(1);
    expect(repo.listAttempts('target_1')).toHaveLength(1);
  });
});
