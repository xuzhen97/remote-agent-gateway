import { getDb } from '../../db/index.js';
import type { ClientTaskAuditMirrorRecord, TaskHistoryQuery } from '@rag/shared';

class TasksService {
  async upsertMirrorRecord(record: ClientTaskAuditMirrorRecord): Promise<{ inserted: boolean }> {
    const db = getDb();
    const stmt = db.prepare('SELECT record_id FROM task_history WHERE record_id = ? LIMIT 1');
    stmt.bind([record.recordId]);
    const exists = stmt.step();
    stmt.free();
    if (exists) return { inserted: false };

    db.run(
      `INSERT INTO task_history (
        record_id, client_id, client_name_snapshot, request_id, job_id, resource_type, action_type, method, path, target_id,
        source_type, actor_type, actor_label, query_summary, request_summary, result_summary, status, http_status,
        started_at, finished_at, duration_ms, error_code, error_message, reported_at, received_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        record.recordId, record.clientId, record.clientNameSnapshot ?? null,
        record.requestId, record.jobId ?? null, record.resourceType, record.actionType,
        record.method, record.path, record.targetId,
        record.sourceType, record.actorType, record.actorLabel,
        JSON.stringify(record.querySummary ?? {}),
        JSON.stringify(record.requestSummary),
        JSON.stringify(record.resultSummary),
        record.status, record.httpStatus, record.startedAt, record.finishedAt,
        record.durationMs, record.errorCode ?? null, record.errorMessage ?? null,
        record.reportedAt, Date.now(),
      ],
    );
    return { inserted: true };
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
    while (stmt.step()) items.push(stmt.getAsObject());
    stmt.free();
    return { items, total, page: query.page, pageSize: query.pageSize };
  }

  getByRecordId(recordId: string) {
    const db = getDb();
    const stmt = db.prepare('SELECT * FROM task_history WHERE record_id = ? LIMIT 1');
    stmt.bind([recordId]);
    const row = stmt.step() ? stmt.getAsObject() : null;
    stmt.free();
    return row;
  }
}

export const tasksService = new TasksService();
