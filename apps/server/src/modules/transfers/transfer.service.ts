import { randomUUID } from 'node:crypto';
import type { TransferJobView, TransferMode, TransferStatus } from '@rag/shared';
import { getDb, saveDb } from '../../db/index.js';
import { connectionManager } from '../connections/connections.manager.js';
import { clientHttpAdminService } from '../client-http/client-http-admin.service.js';
import { aliyunDriveAuthService } from '../aliyundrive/aliyundrive-auth.service.js';
import { AliyunDriveOpenApiClient } from '../aliyundrive/aliyundrive-openapi.client.js';
import { buildPartInfoList, resolveAliyunPartSize, resolvePartSize } from '../aliyundrive/aliyundrive-upload-planner.js';
import { assertTransferTransition, sanitizeTransferEventPayload } from './transfer-state.js';

export interface CreateUploadInput {
  clientId: string;
  rootId: string;
  path: string;
  filename: string;
  size: number;
  transfer: 'auto' | 'aliyundrive' | 'direct';
}

export type CreateUploadResult =
  | { mode: 'frps_chunked' }
  | {
      mode: 'aliyundrive';
      transferId: string;
      accessToken: string;
      openapiBase: string;
      driveId: string;
      fileId: string;
      uploadId: string;
      partSize: number;
      partCount: number;
      uploadParts: Array<{ partNumber: number; uploadUrl: string; size: number }>;
    };

export class TransferService {
  constructor(private readonly deps: { now?: () => number; id?: () => string; authStatus?: () => { configured: boolean; authorized: boolean } } = {}) {}

  private now(): number { return this.deps.now?.() ?? Date.now(); }
  private id(): string { return this.deps.id?.() ?? `tr_${randomUUID().replace(/-/g, '')}`; }

  async createUpload(input: CreateUploadInput): Promise<CreateUploadResult> {
    const status = this.deps.authStatus?.() ?? aliyunDriveAuthService.getStatus();
    if (input.transfer === 'direct') return { mode: 'frps_chunked' };
    if (!status.configured || !status.authorized) {
      if (input.transfer === 'aliyundrive') throw new Error('Aliyun Drive is not configured or authorized');
      return { mode: 'frps_chunked' };
    }

    const config = aliyunDriveAuthService.getConfig();
    const auth = aliyunDriveAuthService.getAuth();
    if (!config || !auth?.accessToken) throw new Error('Aliyun Drive auth is missing');
    const driveId = auth.driveId ?? 'root';
    const transferId = this.id();
    const partSize = resolveAliyunPartSize(input.size);
    const partInfoList = buildPartInfoList(input.size, partSize);
    const client = new AliyunDriveOpenApiClient({ openapiBase: config.openapiBase, accessToken: auth.accessToken });
    const parentFileId = await client.ensureFolderPath({ driveId, folderPath: config.transferFolder });
    const createResult = await client.createFileUpload({
      driveId,
      parentFileId,
      name: `${transferId}-${input.filename}`,
      size: input.size,
      partInfoList,
    });
    const fileId = String(createResult.file_id ?? createResult.fileId);
    const uploadId = String(createResult.upload_id ?? createResult.uploadId);
    const remoteParts = (createResult.part_info_list ?? []) as Array<Record<string, unknown>>;
    const now = this.now();
    this.insertJob({
      id: transferId,
      clientId: input.clientId,
      rootId: input.rootId,
      targetDir: input.path,
      filename: input.filename,
      size: input.size,
      mode: 'aliyundrive',
      status: 'waiting_cli_upload',
      phase: 'waiting_cli_upload',
      aliyunDriveId: driveId,
      aliyunFileId: fileId,
      aliyunUploadId: uploadId,
      aliyunParentFileId: parentFileId,
      aliyunFileName: `${transferId}-${input.filename}`,
      totalBytes: input.size,
      partCount: partInfoList.length,
      createdAt: now,
      updatedAt: now,
    });
    this.addEvent(transferId, 'server', 'phase_changed', 'Transfer created', { status: 'waiting_cli_upload' });
    saveDb();
    return {
      mode: 'aliyundrive',
      transferId,
      accessToken: auth.accessToken,
      openapiBase: config.openapiBase,
      driveId,
      fileId,
      uploadId,
      partSize,
      partCount: partInfoList.length,
      uploadParts: remoteParts.map((part, index) => ({
        partNumber: Number(part.part_number ?? index + 1),
        uploadUrl: String(part.upload_url),
        size: resolvePartSize(input.size, partSize, Number(part.part_number ?? index + 1)),
      })),
    };
  }

  getTransfer(id: string): TransferJobView | null {
    const stmt = getDb().prepare('SELECT * FROM transfer_jobs WHERE id = ?');
    stmt.bind([id]);
    try { return stmt.step() ? this.rowToView(stmt.getAsObject() as Record<string, unknown>) : null; }
    finally { stmt.free(); }
  }

  listTransfers(limit = 20): TransferJobView[] {
    const stmt = getDb().prepare('SELECT * FROM transfer_jobs ORDER BY updated_at DESC LIMIT ?');
    stmt.bind([limit]);
    const items: TransferJobView[] = [];
    try {
      while (stmt.step()) items.push(this.rowToView(stmt.getAsObject() as Record<string, unknown>));
      return items;
    } finally {
      stmt.free();
    }
  }

  listEvents(transferId: string): unknown[] {
    const stmt = getDb().prepare('SELECT * FROM transfer_events WHERE transfer_id = ? ORDER BY created_at ASC');
    stmt.bind([transferId]);
    const events: unknown[] = [];
    try {
      while (stmt.step()) {
        const row = stmt.getAsObject() as Record<string, unknown>;
        events.push({
          id: Number(row.id),
          transferId: row.transfer_id,
          source: row.source,
          type: row.type,
          message: row.message,
          payload: row.payload ? JSON.parse(String(row.payload)) : null,
          createdAt: Number(row.created_at),
        });
      }
      return events;
    } finally { stmt.free(); }
  }

  recordCliProgress(transferId: string, progress: { uploadedBytes: number; totalBytes: number; currentPart?: number }): TransferJobView | null {
    this.updateProgress(transferId, 'cli_uploading', { uploaded_bytes: progress.uploadedBytes, current_part: progress.currentPart ?? null, total_bytes: progress.totalBytes });
    this.addEvent(transferId, 'cli', 'progress', 'CLI upload progress', progress);
    saveDb();
    return this.getTransfer(transferId);
  }

  async completeCliUpload(transferId: string): Promise<TransferJobView | null> {
    const job = this.getTransfer(transferId);
    if (!job) throw new Error('Transfer not found');
    this.setStatus(transferId, 'aliyun_uploaded');
    this.setStatus(transferId, 'waiting_client_download');

    const message = { type: 'transfer.download.start', requestId: `transfer_${transferId}`, payload: { transferId, clientId: job.clientId } };
    const sent = connectionManager.sendToClient(job.clientId, message);
    if (!sent) {
      const fallback = await clientHttpAdminService.request(job.clientId, {
        method: 'POST',
        path: '/files/aliyundrive-download',
        body: { transferId },
      });
      if (fallback.status < 200 || fallback.status >= 300) {
        const fallbackBody = fallback.body as any;
        const errorMessage = fallbackBody?.error?.message ?? fallbackBody?.message ?? 'Failed to dispatch client download';
        this.failTransfer(transferId, { errorCode: 'CLIENT_DISPATCH_FAILED', errorMessage });
        throw new Error(errorMessage);
      }
      this.addEvent(transferId, 'server', 'dispatch_fallback', 'Client download dispatched through client HTTP fallback', { transferId, clientId: job.clientId });
    }

    saveDb();
    return this.getTransfer(transferId);
  }

  async completeBrowserUpload(transferId: string): Promise<TransferJobView | null> {
    const job = this.getTransfer(transferId);
    if (!job) throw new Error('Transfer not found');
    const stmt = getDb().prepare('SELECT aliyun_drive_id, aliyun_file_id, aliyun_upload_id FROM transfer_jobs WHERE id = ?');
    stmt.bind([transferId]);
    try {
      if (!stmt.step()) throw new Error('Transfer not found');
      const row = stmt.getAsObject() as Record<string, unknown>;
      const driveId = String(row.aliyun_drive_id ?? '');
      const fileId = String(row.aliyun_file_id ?? '');
      const uploadId = String(row.aliyun_upload_id ?? '');
      if (!driveId || !fileId || !uploadId) throw new Error('Aliyun transfer metadata is missing');
      const config = aliyunDriveAuthService.getConfig();
      const auth = aliyunDriveAuthService.getAuth();
      if (!config || !auth?.accessToken) throw new Error('Aliyun Drive auth is missing');
      const client = new AliyunDriveOpenApiClient({ openapiBase: config.openapiBase, accessToken: auth.accessToken });
      await client.completeUpload({ driveId, fileId, uploadId });
    } finally {
      stmt.free();
    }
    return await this.completeCliUpload(transferId);
  }

  async refreshUploadUrl(transferId: string, partNumbers?: number[]): Promise<{ uploadParts: Array<{ partNumber: number; uploadUrl: string; size: number }> }> {
    const stmt = getDb().prepare('SELECT aliyun_drive_id, aliyun_file_id, aliyun_upload_id, total_bytes FROM transfer_jobs WHERE id = ?');
    stmt.bind([transferId]);
    try {
      if (!stmt.step()) throw new Error('Transfer not found');
      const row = stmt.getAsObject() as Record<string, unknown>;
      const driveId = String(row.aliyun_drive_id ?? '');
      const fileId = String(row.aliyun_file_id ?? '');
      const uploadId = String(row.aliyun_upload_id ?? '');
      const totalBytes = Number(row.total_bytes ?? 0);
      if (!driveId || !fileId || !uploadId) throw new Error('Aliyun transfer metadata is missing');
      const config = aliyunDriveAuthService.getConfig();
      const auth = aliyunDriveAuthService.getAuth();
      if (!config || !auth?.accessToken) throw new Error('Aliyun Drive auth is missing');
      const client = new AliyunDriveOpenApiClient({ openapiBase: config.openapiBase, accessToken: auth.accessToken });
      const requestedPartNumbers = partNumbers?.length ? partNumbers : [1];
      const result = await client.getUploadUrl({ driveId, fileId, uploadId, partNumbers: requestedPartNumbers });
      const remoteParts = (result.part_info_list ?? []) as Array<Record<string, unknown>>;
      const partSize = resolveAliyunPartSize(totalBytes);
      return {
        uploadParts: remoteParts.map((part) => {
          const partNumber = Number(part.part_number ?? 0);
          return {
            partNumber,
            uploadUrl: String(part.upload_url ?? ''),
            size: resolvePartSize(totalBytes, partSize, partNumber),
          };
        }),
      };
    } finally {
      stmt.free();
    }
  }

  async refreshDownloadUrl(transferId: string): Promise<{ downloadUrl: string }> {
    const stmt = getDb().prepare('SELECT aliyun_drive_id, aliyun_file_id FROM transfer_jobs WHERE id = ?');
    stmt.bind([transferId]);
    try {
      if (!stmt.step()) throw new Error('Transfer not found');
      const row = stmt.getAsObject() as Record<string, unknown>;
      const driveId = String(row.aliyun_drive_id ?? '');
      const fileId = String(row.aliyun_file_id ?? '');
      if (!driveId || !fileId) throw new Error('Aliyun transfer metadata is missing');
      const config = aliyunDriveAuthService.getConfig();
      const auth = aliyunDriveAuthService.getAuth();
      if (!config || !auth?.accessToken) throw new Error('Aliyun Drive auth is missing');
      const client = new AliyunDriveOpenApiClient({ openapiBase: config.openapiBase, accessToken: auth.accessToken });
      let lastError: unknown;
      for (let attempt = 1; attempt <= 10; attempt += 1) {
        try {
          const result = await client.getDownloadUrl({ driveId, fileId });
          const downloadUrl = String((result as Record<string, unknown>).download_url ?? (result as Record<string, unknown>).url ?? '');
          if (!downloadUrl) throw new Error('Aliyun did not return download_url');
          return { downloadUrl };
        } catch (error) {
          lastError = error;
          const message = error instanceof Error ? error.message : String(error);
          const retryable = /InvalidResource\.File|File status is not available/i.test(message);
          if (!retryable || attempt === 10) throw error;
          await new Promise((resolve) => setTimeout(resolve, 1000));
        }
      }
      throw lastError instanceof Error ? lastError : new Error(String(lastError));
    } finally {
      stmt.free();
    }
  }

  recordClientProgress(transferId: string, progress: { downloadedBytes?: number; writtenBytes?: number; totalBytes: number }): TransferJobView | null {
    this.updateProgress(transferId, 'client_downloading', { downloaded_bytes: progress.downloadedBytes ?? 0, written_bytes: progress.writtenBytes ?? 0, total_bytes: progress.totalBytes });
    this.addEvent(transferId, 'client', 'progress', 'Client download progress', progress);
    saveDb();
    return this.getTransfer(transferId);
  }

  completeClientDownload(transferId: string): TransferJobView | null {
    const now = this.now();
    getDb().run("UPDATE transfer_jobs SET status='completed', phase='completed', completed_at=?, cleanup_after_at=?, cleanup_status='cleanup_pending', updated_at=? WHERE id=?", [now, now + 24 * 60 * 60 * 1000, now, transferId]);
    this.addEvent(transferId, 'client', 'phase_changed', 'Client download completed', { status: 'completed' });
    saveDb();
    return this.getTransfer(transferId);
  }

  failTransfer(transferId: string, input: { errorCode: string; errorMessage: string }): TransferJobView | null {
    getDb().run("UPDATE transfer_jobs SET status='failed', phase='failed', error_code=?, error_message=?, updated_at=? WHERE id=?", [input.errorCode, input.errorMessage, this.now(), transferId]);
    this.addEvent(transferId, 'server', 'error', input.errorMessage, input);
    saveDb();
    return this.getTransfer(transferId);
  }

  private setStatus(id: string, status: TransferStatus): void {
    const current = this.getTransfer(id);
    if (current) assertTransferTransition(current.status, status);
    getDb().run('UPDATE transfer_jobs SET status=?, phase=?, updated_at=? WHERE id=?', [status, status, this.now(), id]);
    this.addEvent(id, 'server', 'phase_changed', `Transfer status changed to ${status}`, { status });
  }

  private updateProgress(id: string, status: TransferStatus, values: Record<string, number | null>): void {
    const current = this.getTransfer(id);
    if (current && current.status !== status) this.setStatus(id, status);
    getDb().run('UPDATE transfer_jobs SET uploaded_bytes=COALESCE(?, uploaded_bytes), downloaded_bytes=COALESCE(?, downloaded_bytes), written_bytes=COALESCE(?, written_bytes), total_bytes=COALESCE(?, total_bytes), current_part=COALESCE(?, current_part), updated_at=? WHERE id=?', [values.uploaded_bytes ?? null, values.downloaded_bytes ?? null, values.written_bytes ?? null, values.total_bytes ?? null, values.current_part ?? null, this.now(), id]);
  }

  private addEvent(transferId: string, source: string, type: string, message: string, payload: unknown): void {
    getDb().run('INSERT INTO transfer_events (transfer_id, source, type, message, payload, created_at) VALUES (?, ?, ?, ?, ?, ?)', [transferId, source, type, message, JSON.stringify(sanitizeTransferEventPayload(payload)), this.now()]);
  }

  private insertJob(job: Record<string, unknown>): void {
    getDb().run(`INSERT INTO transfer_jobs (id, client_id, root_id, target_dir, filename, size, mode, status, phase, aliyun_drive_id, aliyun_file_id, aliyun_upload_id, aliyun_parent_file_id, aliyun_file_name, total_bytes, part_count, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`, [job.id, job.clientId, job.rootId, job.targetDir, job.filename, job.size, job.mode, job.status, job.phase, job.aliyunDriveId, job.aliyunFileId, job.aliyunUploadId, job.aliyunParentFileId, job.aliyunFileName, job.totalBytes, job.partCount, job.createdAt, job.updatedAt]);
  }

  private rowToView(row: Record<string, unknown>): TransferJobView {
    return {
      id: String(row.id),
      clientId: String(row.client_id),
      rootId: String(row.root_id),
      targetDir: String(row.target_dir),
      filename: String(row.filename),
      size: Number(row.size),
      mode: row.mode as TransferMode,
      status: row.status as TransferStatus,
      cleanupStatus: String(row.cleanup_status ?? 'none') as any,
      uploadedBytes: Number(row.uploaded_bytes),
      downloadedBytes: Number(row.downloaded_bytes),
      writtenBytes: Number(row.written_bytes),
      totalBytes: Number(row.total_bytes),
      errorCode: row.error_code as string | null,
      errorMessage: row.error_message as string | null,
      createdAt: Number(row.created_at),
      updatedAt: Number(row.updated_at),
      completedAt: row.completed_at == null ? null : Number(row.completed_at),
      cleanupAfterAt: row.cleanup_after_at == null ? null : Number(row.cleanup_after_at),
    };
  }
}

export const transferService = new TransferService();
