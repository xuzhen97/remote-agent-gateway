/** @file 服务端审计日志服务
 *
 * 记录关键操作（客户端注册、断开、HTTP 控制面失败等）到数据库。
 * 审计日志不同于客户端任务审计（task-audit），它记录服务端自身的管理操作。
 */
import { getDb } from '../../db/index.js';

/** 审计日志服务 */
export class AuditService {
  /**
   * 写入审计日志
   * @param params.actor - 操作者（通常是 clientId）
   * @param params.action - 操作类型
   * @param params.targetType - 目标类型
   * @param params.targetId - 目标 ID
   * @param params.detail - 操作详情
   */
  log(params: {
    actor?: string;
    action: string;
    targetType?: string;
    targetId?: string;
    detail?: string;
  }): void {
    const db = getDb();
    db.run(
      `INSERT INTO audit_logs (actor, action, target_type, target_id, detail, created_at) VALUES (?, ?, ?, ?, ?, ?)`,
      [params.actor ?? null, params.action, params.targetType ?? null, params.targetId ?? null, params.detail ?? null, Date.now()],
    );
  }

  /**
   * 列出最近的审计日志
   * @param limit - 最多返回条数（默认 100）
   */
  listLogs(limit = 100): Record<string, unknown>[] {
    const db = getDb();
    const results: Record<string, unknown>[] = [];
    const stmt = db.prepare('SELECT * FROM audit_logs ORDER BY created_at DESC LIMIT ?');
    stmt.bind([limit]);
    while (stmt.step()) {
      const row = stmt.getAsObject();
      results.push({
        id: row.id,
        actor: row.actor,
        action: row.action,
        targetType: row.target_type,
        targetId: row.target_id,
        detail: row.detail,
        createdAt: row.created_at,
      });
    }
    stmt.free();
    return results;
  }
}

/** 全局审计服务单例 */
export const auditService = new AuditService();
