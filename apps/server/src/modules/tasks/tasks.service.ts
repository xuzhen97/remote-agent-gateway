import { getDb } from '../../db/index.js';
import type { ClientTaskAuditMirrorRecord, TaskHistoryQuery } from '@rag/shared';

type TaskHistoryDbRow = Record<string, unknown>;

function parseSummary(value: unknown): Record<string, unknown> {
  if (typeof value !== 'string' || value.length === 0) return {};
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : {};
  } catch {
    return {};
  }
}

function mapTaskHistoryRow(row: TaskHistoryDbRow | null) {
  if (!row) return null;
  return {
    recordId: String(row.record_id ?? ''),
    clientId: String(row.client_id ?? ''),
    clientNameSnapshot: typeof row.client_name_snapshot === 'string' ? row.client_name_snapshot : undefined,
    requestId: String(row.request_id ?? ''),
    jobId: typeof row.job_id === 'string' ? row.job_id : row.job_id == null ? null : String(row.job_id),
    resourceType: String(row.resource_type ?? ''),
    actionType: String(row.action_type ?? ''),
    method: String(row.method ?? ''),
    path: String(row.path ?? ''),
    targetId: String(row.target_id ?? ''),
    sourceType: String(row.source_type ?? ''),
    actorType: String(row.actor_type ?? ''),
    actorLabel: String(row.actor_label ?? ''),
    querySummary: parseSummary(row.query_summary),
    requestSummary: parseSummary(row.request_summary),
    resultSummary: parseSummary(row.result_summary),
    status: String(row.status ?? ''),
    httpStatus: Number(row.http_status ?? 0),
    startedAt: Number(row.started_at ?? 0),
    finishedAt: Number(row.finished_at ?? 0),
    durationMs: Number(row.duration_ms ?? 0),
    errorCode: typeof row.error_code === 'string' ? row.error_code : row.error_code == null ? null : String(row.error_code),
    errorMessage: typeof row.error_message === 'string' ? row.error_message : row.error_message == null ? null : String(row.error_message),
    reportedAt: Number(row.reported_at ?? 0),
    receivedAt: row.received_at == null ? undefined : Number(row.received_at),
  };
}

class TasksService {
  async upsertMirrorRecord(record: ClientTaskAuditMirrorRecord): Promise<{ inserted: boolean }> {
    const db = getDb();
    const stmt = db.prepare('SELECT record_id FROM task_history WHERE record_id = ? LIMIT 1');
    stmt.bind([record.recordId]);
    const exists = stmt.step();
    stmt.free();

    const values = [
      record.clientId, record.clientNameSnapshot ?? null,
      record.requestId, record.jobId ?? null, record.resourceType, record.actionType,
      record.method, record.path, record.targetId,
      record.sourceType, record.actorType, record.actorLabel,
      JSON.stringify(record.querySummary ?? {}),
      JSON.stringify(record.requestSummary),
      JSON.stringify(record.resultSummary),
      record.status, record.httpStatus, record.startedAt, record.finishedAt,
      record.durationMs, record.errorCode ?? null, record.errorMessage ?? null,
      record.reportedAt, Date.now(),
    ];

    if (!exists) {
      db.run(
        `INSERT INTO task_history (
          record_id, client_id, client_name_snapshot, request_id, job_id, resource_type, action_type, method, path, target_id,
          source_type, actor_type, actor_label, query_summary, request_summary, result_summary, status, http_status,
          started_at, finished_at, duration_ms, error_code, error_message, reported_at, received_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [record.recordId, ...values],
      );
      return { inserted: true };
    }

    db.run(
      `UPDATE task_history SET
        client_id = ?,
        client_name_snapshot = ?,
        request_id = ?,
        job_id = ?,
        resource_type = ?,
        action_type = ?,
        method = ?,
        path = ?,
        target_id = ?,
        source_type = ?,
        actor_type = ?,
        actor_label = ?,
        query_summary = ?,
        request_summary = ?,
        result_summary = ?,
        status = ?,
        http_status = ?,
        started_at = ?,
        finished_at = ?,
        duration_ms = ?,
        error_code = ?,
        error_message = ?,
        reported_at = ?,
        received_at = ?
      WHERE record_id = ?`,
      [...values, record.recordId],
    );
    return { inserted: false };
  }

  list(query: TaskHistoryQuery) {
    const db = getDb();
    const where: string[] = [];
    const params: unknown[] = [];
    if (query.clientId) { where.push('client_id = ?'); params.push(query.clientId); }
    if (query.status) { where.push('status = ?'); params.push(query.status); }
    if (query.resourceType) { where.push('resource_type = ?'); params.push(query.resourceType); }
    if (query.actionType) { where.push('action_type = ?'); params.push(query.actionType); }
    if (query.sourceType) { where.push('source_type = ?'); params.push(query.sourceType); }
    if (query.keyword) {
      where.push('(client_name_snapshot LIKE ? OR target_id LIKE ? OR action_type LIKE ? OR COALESCE(error_message, "") LIKE ?)');
      params.push(`%${query.keyword}%`, `%${query.keyword}%`, `%${query.keyword}%`, `%${query.keyword}%`);
    }
    if (query.from) { where.push('finished_at >= ?'); params.push(query.from); }
    if (query.to) { where.push('finished_at <= ?'); params.push(query.to); }
    const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
    const offset = (query.page - 1) * query.pageSize;

    const totalStmt = db.prepare(`SELECT COUNT(*) AS total FROM task_history ${whereSql}`);
    totalStmt.bind(params as any);
    totalStmt.step();
    const total = Number((totalStmt.getAsObject() as any).total ?? 0);
    totalStmt.free();

    const stmt = db.prepare(`SELECT * FROM task_history ${whereSql} ORDER BY finished_at DESC LIMIT ? OFFSET ?`);
    stmt.bind([...params, query.pageSize, offset] as any);
    const items: Record<string, unknown>[] = [];
    while (stmt.step()) items.push(mapTaskHistoryRow(stmt.getAsObject()) as Record<string, unknown>);
    stmt.free();
    return { items, total, page: query.page, pageSize: query.pageSize };
  }

  getByRecordId(recordId: string) {
    const db = getDb();
    const stmt = db.prepare('SELECT * FROM task_history WHERE record_id = ? LIMIT 1');
    stmt.bind([recordId]);
    const row = stmt.step() ? mapTaskHistoryRow(stmt.getAsObject()) : null;
    stmt.free();
    return row;
  }

  deleteByRecordId(recordId: string): { deleted: boolean } {
    const db = getDb();
    db.run('DELETE FROM task_history WHERE record_id = ?', [recordId]);
    return { deleted: db.getRowsModified() > 0 };
  }

  deleteByRecordIds(recordIds: string[]): { requested: number; deleted: number } {
    const ids = [...new Set(recordIds.map((id) => id.trim()).filter(Boolean))];
    if (!ids.length) return { requested: 0, deleted: 0 };

    const db = getDb();
    const placeholders = ids.map(() => '?').join(', ');
    db.run(`DELETE FROM task_history WHERE record_id IN (${placeholders})`, ids);
    return { requested: ids.length, deleted: db.getRowsModified() };
  }
}

export const tasksService = new TasksService();
