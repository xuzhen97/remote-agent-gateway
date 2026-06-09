/** @file 任务审计历史服务
 *
 * 客户端上报的任务审计记录（脱敏摘要）存储到服务端数据库，
 * 提供查询、查看详情和批量删除功能。
 */
import { getDb } from '../../db/index.js';
import type { ClientTaskAuditMirrorRecord, TaskHistoryQuery } from '@rag/shared';

type TaskHistoryDbRow = Record<string, unknown>;

/**
 * 解析 JSON 摘要字段
 * 数据库中 JSON 字段可能为空字符串或无效 JSON，需要安全解析
 */
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

/** 将数据库行映射为 API 响应格式 */
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

/** 任务审计历史服务 */
class TasksService {
  /**
   * 插入或更新审计镜像记录
   * 客户端上报的脱敏审计摘要通过此接口同步到服务端。
   */
  async upsertMirrorRecord(record: ClientTaskAuditMirrorRecord): Promise<{ inserted: boolean }> {
    const db = getDb();
    // 检查记录是否已存在
    const stmt = db.prepare('SELECT record_id FROM task_history WHERE record_id = ? LIMIT 1');
    stmt.bind([record.recordId]);
    const exists = stmt.step();
    stmt.free();

    // 准备写入的值（不含敏感字段）
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
      // 插入新记录
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

    // 更新已有记录
    db.run(
      `UPDATE task_history SET
        client_id = ?, client_name_snapshot = ?, request_id = ?, job_id = ?,
        resource_type = ?, action_type = ?, method = ?, path = ?, target_id = ?,
        source_type = ?, actor_type = ?, actor_label = ?,
        query_summary = ?, request_summary = ?, result_summary = ?,
        status = ?, http_status = ?, started_at = ?, finished_at = ?,
        duration_ms = ?, error_code = ?, error_message = ?,
        reported_at = ?, received_at = ?
      WHERE record_id = ?`,
      [...values, record.recordId],
    );
    return { inserted: false };
  }

  /**
   * 查询审计记录列表（支持分页和多种筛选条件）
   */
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

    // 查询总数
    const totalStmt = db.prepare(`SELECT COUNT(*) AS total FROM task_history ${whereSql}`);
    totalStmt.bind(params as any);
    totalStmt.step();
    const total = Number((totalStmt.getAsObject() as any).total ?? 0);
    totalStmt.free();

    // 分页查询
    const stmt = db.prepare(`SELECT * FROM task_history ${whereSql} ORDER BY finished_at DESC LIMIT ? OFFSET ?`);
    stmt.bind([...params, query.pageSize, offset] as any);
    const items: Record<string, unknown>[] = [];
    while (stmt.step()) items.push(mapTaskHistoryRow(stmt.getAsObject()) as Record<string, unknown>);
    stmt.free();
    return { items, total, page: query.page, pageSize: query.pageSize };
  }

  /** 根据 recordId 获取单条记录详情 */
  getByRecordId(recordId: string) {
    const db = getDb();
    const stmt = db.prepare('SELECT * FROM task_history WHERE record_id = ? LIMIT 1');
    stmt.bind([recordId]);
    const row = stmt.step() ? mapTaskHistoryRow(stmt.getAsObject()) : null;
    stmt.free();
    return row;
  }

  /** 删除单条记录 */
  deleteByRecordId(recordId: string): { deleted: boolean } {
    const db = getDb();
    db.run('DELETE FROM task_history WHERE record_id = ?', [recordId]);
    return { deleted: db.getRowsModified() > 0 };
  }

  /** 批量删除记录 */
  deleteByRecordIds(recordIds: string[]): { requested: number; deleted: number } {
    const ids = [...new Set(recordIds.map((id) => id.trim()).filter(Boolean))];
    if (!ids.length) return { requested: 0, deleted: 0 };

    const db = getDb();
    const placeholders = ids.map(() => '?').join(', ');
    db.run(`DELETE FROM task_history WHERE record_id IN (${placeholders})`, ids);
    return { requested: ids.length, deleted: db.getRowsModified() };
  }
}

/** 全局任务历史服务单例 */
export const tasksService = new TasksService();
