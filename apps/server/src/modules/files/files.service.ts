import { getDb } from '../../db/index.js';
import { v4 as uuid } from 'uuid';
import * as path from 'node:path';
import * as fs from 'node:fs';
import * as crypto from 'node:crypto';
import { env } from '../../config/env.js';

export interface FileRow {
  id: string;
  original_name: string;
  stored_path: string;
  size: number | null;
  sha256: string | null;
  mime_type: string | null;
  created_at: number;
}

export class FilesService {
  async storeFile(originalName: string, buffer: Buffer, mimeType?: string): Promise<FileRow> {
    const id = `file_${uuid().slice(0, 8)}`;
    const ext = path.extname(originalName);
    const storedName = `${id}${ext}`;
    const storedPath = path.join(env.STORAGE_DIR, storedName);

    // Ensure storage dir exists
    if (!fs.existsSync(env.STORAGE_DIR)) {
      fs.mkdirSync(env.STORAGE_DIR, { recursive: true });
    }

    // Write file
    fs.writeFileSync(storedPath, buffer);

    // Calculate SHA256
    const sha256 = crypto.createHash('sha256').update(buffer).digest('hex');

    const now = Date.now();
    const db = getDb();
    db.run(
      `INSERT INTO files (id, original_name, stored_path, size, sha256, mime_type, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [id, originalName, storedPath, buffer.length, sha256, mimeType ?? null, now],
    );

    return this.getFile(id)!;
  }

  getFile(fileId: string): FileRow | undefined {
    const db = getDb();
    const stmt = db.prepare('SELECT * FROM files WHERE id = ?');
    stmt.bind([fileId]);
    if (stmt.step()) {
      const row = stmt.getAsObject() as unknown as FileRow;
      stmt.free();
      return row;
    }
    stmt.free();
    return undefined;
  }

  listFiles(): FileRow[] {
    const db = getDb();
    const results: FileRow[] = [];
    const stmt = db.prepare('SELECT * FROM files ORDER BY created_at DESC');
    while (stmt.step()) {
      results.push(stmt.getAsObject() as unknown as FileRow);
    }
    stmt.free();
    return results;
  }

  readFileContent(fileId: string): Buffer | undefined {
    const file = this.getFile(fileId);
    if (!file) return undefined;

    if (!fs.existsSync(file.stored_path)) return undefined;
    return fs.readFileSync(file.stored_path);
  }

  toApi(file: FileRow): Record<string, unknown> {
    return {
      id: file.id,
      originalName: file.original_name,
      size: file.size,
      sha256: file.sha256,
      mimeType: file.mime_type,
      createdAt: file.created_at,
    };
  }
}

export const filesService = new FilesService();
