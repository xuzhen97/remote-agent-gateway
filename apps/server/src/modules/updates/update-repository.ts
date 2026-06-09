import type { Database } from 'sql.js';
import type { UpdateReleaseRecord, UpdateCampaignRecord, UpdateTargetRecord, UpdateAttemptRecord } from './update-types.js';

function rowToRelease(row: Record<string, unknown>): UpdateReleaseRecord {
  return {
    version: row.version as string,
    manifestJson: row.manifest_json as string,
    enabled: Boolean(row.enabled),
    createdAt: Number(row.created_at),
    updatedAt: Number(row.updated_at),
  };
}

function rowToCampaign(row: Record<string, unknown>): UpdateCampaignRecord {
  return {
    id: row.id as string,
    targetVersion: row.target_version as string,
    scopeJson: row.scope_json as string,
    includeServer: Boolean(row.include_server),
    batchSize: Number(row.batch_size),
    maxConcurrency: Number(row.max_concurrency),
    status: row.status as string,
    createdBy: row.created_by as string,
    createdAt: Number(row.created_at),
    updatedAt: Number(row.updated_at),
  };
}

function rowToTarget(row: Record<string, unknown>): UpdateTargetRecord {
  return {
    id: row.id as string,
    campaignId: row.campaign_id as string,
    targetType: row.target_type as string,
    clientId: (row.client_id ?? null) as string | null,
    platform: (row.platform ?? null) as string | null,
    currentVersion: (row.current_version ?? null) as string | null,
    targetVersion: row.target_version as string,
    phase: row.phase as string,
    attemptCount: Number(row.attempt_count),
    lastErrorCode: (row.last_error_code ?? null) as string | null,
    lastErrorMessage: (row.last_error_message ?? null) as string | null,
    createdAt: Number(row.created_at),
    updatedAt: Number(row.updated_at),
    finishedAt: row.finished_at ? Number(row.finished_at) : null,
  };
}

function rowToAttempt(row: Record<string, unknown>): UpdateAttemptRecord {
  return {
    id: row.id as string,
    targetId: row.target_id as string,
    attemptNo: Number(row.attempt_no),
    phaseTimelineJson: row.phase_timeline_json as string,
    result: row.result as string,
    errorCode: (row.error_code ?? null) as string | null,
    errorMessage: (row.error_message ?? null) as string | null,
    createdAt: Number(row.created_at),
    updatedAt: Number(row.updated_at),
    finishedAt: row.finished_at ? Number(row.finished_at) : null,
  };
}

function queryOne(db: Database, sql: string, params: unknown[]): Record<string, unknown> | undefined {
  const stmt = db.prepare(sql);
  try {
    stmt.bind(params);
    if (stmt.step()) return stmt.getAsObject() as Record<string, unknown>;
    return undefined;
  } finally {
    stmt.free();
  }
}

function queryAll(db: Database, sql: string, params: unknown[]): Record<string, unknown>[] {
  const stmt = db.prepare(sql);
  try {
    stmt.bind(params);
    const rows: Record<string, unknown>[] = [];
    while (stmt.step()) {
      rows.push(stmt.getAsObject() as Record<string, unknown>);
    }
    return rows;
  } finally {
    stmt.free();
  }
}

export function createUpdateRepository(db: Database) {
  return {
    // ---------- Releases ----------
    saveRelease(record: UpdateReleaseRecord): void {
      db.run(
        `INSERT OR REPLACE INTO update_releases (version, manifest_json, enabled, created_at, updated_at) VALUES (?, ?, ?, ?, ?)`,
        [record.version, record.manifestJson, record.enabled ? 1 : 0, record.createdAt, record.updatedAt],
      );
    },
    getRelease(version: string): UpdateReleaseRecord | undefined {
      const row = queryOne(db, 'SELECT * FROM update_releases WHERE version = ?', [version]);
      return row ? rowToRelease(row) : undefined;
    },
    listReleases(): UpdateReleaseRecord[] {
      return queryAll(db, 'SELECT * FROM update_releases ORDER BY created_at DESC', []).map(rowToRelease);
    },

    // ---------- Campaigns ----------
    saveCampaign(record: UpdateCampaignRecord): void {
      db.run(
        `INSERT OR REPLACE INTO update_campaigns (id, target_version, scope_json, include_server, batch_size, max_concurrency, status, created_by, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [record.id, record.targetVersion, record.scopeJson, record.includeServer ? 1 : 0, record.batchSize, record.maxConcurrency, record.status, record.createdBy, record.createdAt, record.updatedAt],
      );
    },
    getCampaign(id: string): UpdateCampaignRecord | undefined {
      const row = queryOne(db, 'SELECT * FROM update_campaigns WHERE id = ?', [id]);
      return row ? rowToCampaign(row) : undefined;
    },
    updateCampaignStatus(id: string, status: string): void {
      db.run('UPDATE update_campaigns SET status = ?, updated_at = ? WHERE id = ?', [status, Date.now(), id]);
    },
    listRecoverableCampaigns(): UpdateCampaignRecord[] {
      return queryAll(db, "SELECT * FROM update_campaigns WHERE status IN ('server_updating', 'client_updating')", []).map(rowToCampaign);
    },

    // ---------- Targets ----------
    saveTarget(record: UpdateTargetRecord): void {
      db.run(
        `INSERT OR REPLACE INTO update_targets (id, campaign_id, target_type, client_id, platform, current_version, target_version, phase, attempt_count, last_error_code, last_error_message, created_at, updated_at, finished_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [record.id, record.campaignId, record.targetType, record.clientId ?? null, record.platform ?? null, record.currentVersion ?? null, record.targetVersion, record.phase, record.attemptCount, record.lastErrorCode ?? null, record.lastErrorMessage ?? null, record.createdAt, record.updatedAt, record.finishedAt ?? null],
      );
    },
    getTarget(id: string): UpdateTargetRecord | undefined {
      const row = queryOne(db, 'SELECT * FROM update_targets WHERE id = ?', [id]);
      return row ? rowToTarget(row) : undefined;
    },
    listTargets(campaignId: string): UpdateTargetRecord[] {
      return queryAll(db, 'SELECT * FROM update_targets WHERE campaign_id = ?', [campaignId]).map(rowToTarget);
    },
    updateTargetPhase(id: string, phase: string, errorCode?: string | null, errorMessage?: string | null): void {
      db.run(
        'UPDATE update_targets SET phase = ?, last_error_code = ?, last_error_message = ?, updated_at = ?, finished_at = CASE WHEN ? IN (\'succeeded\',\'failed\',\'rolled_back\',\'cancelled\') THEN ? ELSE finished_at END WHERE id = ?',
        [phase, errorCode ?? null, errorMessage ?? null, Date.now(), phase, Date.now(), id],
      );
    },
    getTargetsForCampaign(campaignId: string): UpdateTargetRecord[] {
      return this.listTargets(campaignId);
    },

    // ---------- Attempts ----------
    saveAttempt(record: UpdateAttemptRecord): void {
      db.run(
        `INSERT OR REPLACE INTO update_attempts (id, target_id, attempt_no, phase_timeline_json, result, error_code, error_message, created_at, updated_at, finished_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [record.id, record.targetId, record.attemptNo, record.phaseTimelineJson, record.result, record.errorCode ?? null, record.errorMessage ?? null, record.createdAt, record.updatedAt, record.finishedAt ?? null],
      );
    },
    listAttempts(targetId: string): UpdateAttemptRecord[] {
      return queryAll(db, 'SELECT * FROM update_attempts WHERE target_id = ? ORDER BY attempt_no ASC', [targetId]).map(rowToAttempt);
    },
  };
}
