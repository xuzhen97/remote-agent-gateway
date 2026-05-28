import { getDb } from '../../db/index.js';

export class AuditService {
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

export const auditService = new AuditService();
