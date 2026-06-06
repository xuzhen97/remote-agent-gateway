import { getDb, saveDb } from '../../db/index.js';
import { aliyunDriveAuthService } from '../aliyundrive/aliyundrive-auth.service.js';
import { AliyunDriveOpenApiClient } from '../aliyundrive/aliyundrive-openapi.client.js';

export function computeCleanupAfter(completedAt: number, ttlMs: number): number {
  return completedAt + ttlMs;
}

export class TransferCleanupService {
  private timer: ReturnType<typeof setInterval> | null = null;

  start(intervalMs = 60 * 60 * 1000): void {
    if (this.timer) return;
    this.timer = setInterval(() => {
      void this.runOnce().catch((error) => console.warn('[transfer-cleanup] failed:', error instanceof Error ? error.message : error));
    }, intervalMs);
  }

  stop(): void {
    if (!this.timer) return;
    clearInterval(this.timer);
    this.timer = null;
  }

  async runOnce(now = Date.now()): Promise<void> {
    const auth = aliyunDriveAuthService.getAuth();
    const config = aliyunDriveAuthService.getConfig();
    if (!auth?.accessToken || !config) return;
    const client = new AliyunDriveOpenApiClient({ openapiBase: config.openapiBase, accessToken: auth.accessToken });
    const stmt = getDb().prepare("SELECT id, aliyun_drive_id, aliyun_file_id FROM transfer_jobs WHERE cleanup_status='cleanup_pending' AND cleanup_after_at IS NOT NULL AND cleanup_after_at <= ?");
    stmt.bind([now]);
    const rows: Array<{ id: string; driveId: string; fileId: string }> = [];
    try {
      while (stmt.step()) {
        const row = stmt.getAsObject() as Record<string, unknown>;
        rows.push({ id: String(row.id), driveId: String(row.aliyun_drive_id), fileId: String(row.aliyun_file_id) });
      }
    } finally { stmt.free(); }
    for (const row of rows) {
      try {
        await client.deleteFile({ driveId: row.driveId, fileId: row.fileId });
        getDb().run("UPDATE transfer_jobs SET cleanup_status='cleanup_done', updated_at=? WHERE id=?", [Date.now(), row.id]);
      } catch (error) {
        getDb().run("UPDATE transfer_jobs SET cleanup_status='cleanup_failed', error_message=?, updated_at=? WHERE id=?", [error instanceof Error ? error.message : String(error), Date.now(), row.id]);
      }
    }
    if (rows.length > 0) saveDb();
  }
}

export const transferCleanupService = new TransferCleanupService();
