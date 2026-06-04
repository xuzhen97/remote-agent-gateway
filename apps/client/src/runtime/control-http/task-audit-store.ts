import * as fs from 'node:fs';
import * as path from 'node:path';
import type { ClientTaskAuditLocalRecord } from '@rag/shared';

interface SyncPatch {
  syncStatus: 'pending' | 'synced' | 'sync_failed';
  syncedAt?: number | null;
  syncError?: string | null;
}

export interface TaskAuditStore {
  append(record: ClientTaskAuditLocalRecord): Promise<void>;
  replace(record: ClientTaskAuditLocalRecord): Promise<void>;
  updateSync(recordId: string, patch: SyncPatch): Promise<void>;
  list(): Promise<ClientTaskAuditLocalRecord[]>;
}

export function createTaskAuditStore(filePath: string): TaskAuditStore {
  function ensureDir() {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    if (!fs.existsSync(filePath)) fs.writeFileSync(filePath, '', 'utf8');
  }

  async function list(): Promise<ClientTaskAuditLocalRecord[]> {
    ensureDir();
    const text = fs.readFileSync(filePath, 'utf8').trim();
    if (!text) return [];
    return text.split(/\r?\n/).filter(Boolean).map((line) => JSON.parse(line) as ClientTaskAuditLocalRecord);
  }

  async function writeAll(records: ClientTaskAuditLocalRecord[]): Promise<void> {
    ensureDir();
    const body = records.map((record) => JSON.stringify(record)).join('\n');
    fs.writeFileSync(filePath, body ? `${body}\n` : '', 'utf8');
  }

  return {
    async append(record) {
      ensureDir();
      fs.appendFileSync(filePath, `${JSON.stringify(record)}\n`, 'utf8');
    },
    async replace(record) {
      const records = await list();
      const index = records.findIndex((item) => item.recordId === record.recordId);
      if (index === -1) {
        records.push(record);
      } else {
        records[index] = record;
      }
      await writeAll(records);
    },
    async updateSync(recordId, patch) {
      const records = await list();
      const next = records.map((record) => (
        record.recordId === recordId
          ? { ...record, ...patch }
          : record
      ));
      await writeAll(next);
    },
    list,
  };
}
