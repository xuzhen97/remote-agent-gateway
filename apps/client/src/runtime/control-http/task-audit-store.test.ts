import { describe, expect, it } from 'vitest';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createTaskAuditStore } from './task-audit-store.js';

describe('task audit store', () => {
  it('persists records and updates sync status', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'rag-task-audit-'));
    const store = createTaskAuditStore(join(dir, 'task-audit.jsonl'));

    await store.append({
      recordId: 'rec_01',
      clientId: 'client-1',
      requestId: 'req_01',
      resourceType: 'file',
      actionType: 'file.write',
      method: 'PUT',
      path: '/files/write',
      targetId: 'workspace:src/index.ts',
      sourceType: 'web-console',
      actorType: 'admin-token',
      actorLabel: 'web-console/admin-token',
      requestSummary: { path: 'src/index.ts', size: 12 },
      resultSummary: { size: 12 },
      status: 'success',
      httpStatus: 200,
      startedAt: 1,
      finishedAt: 2,
      durationMs: 1,
      syncStatus: 'pending',
      reportedAt: 2,
    });

    await store.updateSync('rec_01', { syncStatus: 'synced', syncedAt: 3, syncError: null });

    const text = readFileSync(join(dir, 'task-audit.jsonl'), 'utf8');
    expect(text).toContain('"recordId":"rec_01"');
    expect(text).toContain('"syncStatus":"synced"');
    rmSync(dir, { recursive: true, force: true });
  });

  it('lists all records', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'rag-task-audit-'));
    const store = createTaskAuditStore(join(dir, 'task-audit.jsonl'));

    await store.append({
      recordId: 'rec_a', clientId: 'c1', requestId: 'r1',
      resourceType: 'job', actionType: 'job.command', method: 'POST', path: '/jobs/command',
      targetId: 'job_01', sourceType: 'direct-client-http', actorType: 'client-token',
      actorLabel: 'direct-client-http/client-token',
      requestSummary: {}, resultSummary: {}, status: 'success',
      httpStatus: 200, startedAt: 1, finishedAt: 2, durationMs: 1,
      syncStatus: 'pending', reportedAt: 2,
    });

    const list = await store.list();
    expect(list.length).toBe(1);
    expect(list[0].recordId).toBe('rec_a');
    rmSync(dir, { recursive: true, force: true });
  });
});
