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

  it('updates target phase, increments attempts, and appends attempt phases', () => {
    const repo = createUpdateRepository(db);
    const now = Date.now();

    repo.saveCampaign({
      id: 'camp_status_1',
      targetVersion: '1.0.1',
      scopeJson: '{"all":true}',
      includeServer: false,
      batchSize: 10,
      maxConcurrency: 5,
      status: 'client_updating',
      createdBy: 'admin',
      createdAt: now,
      updatedAt: now,
    });

    repo.saveTarget({
      id: 'target_status_1',
      campaignId: 'camp_status_1',
      targetType: 'client',
      clientId: 'client-1',
      platform: 'windows',
      currentVersion: '1.0.0',
      targetVersion: '1.0.1',
      phase: 'queued',
      attemptCount: 0,
      createdAt: now,
      updatedAt: now,
    });

    repo.incrementTargetAttempt('target_status_1');
    expect(repo.getTarget('target_status_1')?.attemptCount).toBe(1);

    repo.upsertAttemptPhase({
      attemptId: 'attempt_status_1',
      targetId: 'target_status_1',
      phase: 'downloading',
      payload: { phase: 'downloading' },
      terminal: false,
    });
    repo.upsertAttemptPhase({
      attemptId: 'attempt_status_1',
      targetId: 'target_status_1',
      phase: 'failed',
      payload: { phase: 'failed', errorCode: 'INSTALL_FAILED' },
      terminal: true,
      errorCode: 'INSTALL_FAILED',
      errorMessage: 'boom',
    });
    repo.updateTargetPhase('target_status_1', 'failed', 'INSTALL_FAILED', 'boom');

    const target = repo.getTarget('target_status_1');
    expect(target?.phase).toBe('failed');
    expect(target?.lastErrorCode).toBe('INSTALL_FAILED');
    expect(target?.lastErrorMessage).toBe('boom');
    expect(target?.finishedAt).toBeTruthy();

    const attempts = repo.listAttempts('target_status_1');
    expect(attempts).toHaveLength(1);
    expect(attempts[0].result).toBe('failed');
    expect(attempts[0].errorCode).toBe('INSTALL_FAILED');
    expect(JSON.parse(attempts[0].phaseTimelineJson)).toHaveLength(2);
    expect(repo.listCampaigns().some((campaign) => campaign.id === 'camp_status_1')).toBe(true);
  });

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
});
