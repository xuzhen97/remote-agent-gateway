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

    const result = service.deleteRelease({ version: 'v2.1.0', force: false });
    expect(result).toEqual({
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

    const sRoot = makeStorageRoot();
    const service = createReleaseDeletionService({
      repo,
      storage: { releasesDir: sRoot, artifactDir: (version: string) => path.join(sRoot, 'artifacts', version) },
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

    const sRoot = makeStorageRoot();
    const service = createReleaseDeletionService({
      repo,
      storage: { releasesDir: sRoot, artifactDir: (version: string) => path.join(sRoot, 'artifacts', version) },
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

    const badRepo = {
      ...repo,
      withTransaction: vi.fn().mockImplementation(() => {
        throw new Error('db failed');
      }),
    };

    const service = createReleaseDeletionService({
      repo: badRepo,
      storage: { releasesDir: storageRoot, artifactDir: (version: string) => path.join(storageRoot, 'artifacts', version) },
      fileOps: { renameSync, rmSync, readdirSync, mkdirSync },
      idFactory: () => 'trash-4',
    });

    expect(() => service.deleteRelease({ version: 'v2.4.0', force: false })).toThrow('db failed');
    expect(readdirSync(path.join(storageRoot, 'artifacts'))).toContain('v2.4.0');
  });
});
