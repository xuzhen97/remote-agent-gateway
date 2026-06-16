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
    const result = service.deleteCampaign({ campaignId: 'camp_del_ok', force: false });
    expect(result).toEqual({
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
