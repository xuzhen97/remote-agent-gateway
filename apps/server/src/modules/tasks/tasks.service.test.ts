import { beforeEach, describe, expect, it } from 'vitest';
import { initDb, getDb } from '../../db/index.js';
import { tasksService } from './tasks.service.js';

beforeEach(async () => {
  await initDb();
  getDb().run('DELETE FROM task_history');
});

describe('tasksService', () => {
  it('stores mirrored records idempotently', async () => {
    const record = {
      recordId: 'rec_01', clientId: 'client-1', requestId: 'req_01',
      resourceType: 'file', actionType: 'file.write' as const,
      method: 'PUT', path: '/files/write', targetId: 'workspace:src/index.ts',
      sourceType: 'web-console' as const, actorType: 'admin-token' as const,
      actorLabel: 'web-console/admin-token',
      requestSummary: { path: 'src/index.ts' }, resultSummary: { size: 12 },
      status: 'success' as const, httpStatus: 200,
      startedAt: 1, finishedAt: 2, durationMs: 1, reportedAt: 2,
    };

    const r1 = await tasksService.upsertMirrorRecord(record as any);
    const r2 = await tasksService.upsertMirrorRecord(record as any);

    expect(r1.inserted).toBe(true);
    expect(r2.inserted).toBe(false);

    const page = tasksService.list({ page: 1, pageSize: 20 });
    expect(page.total).toBe(1);
  });

  it('filters by status and clientId', async () => {
    await tasksService.upsertMirrorRecord({ recordId: 'r1', clientId: 'a', requestId: 'x', resourceType: 'job', actionType: 'job.command' as const, method: 'POST', path: '/jobs/command', targetId: 'j1', sourceType: 'agent-api' as const, actorType: 'agent-token' as const, actorLabel: 'agent-api/agent-token', requestSummary: {}, resultSummary: {}, status: 'success' as const, httpStatus: 200, startedAt: 1, finishedAt: 2, durationMs: 1, reportedAt: 2 } as any);
    await tasksService.upsertMirrorRecord({ recordId: 'r2', clientId: 'b', requestId: 'y', resourceType: 'job', actionType: 'job.script' as const, method: 'POST', path: '/jobs/script', targetId: 'j2', sourceType: 'web-console' as const, actorType: 'admin-token' as const, actorLabel: 'web-console/admin-token', requestSummary: {}, resultSummary: {}, status: 'failed' as const, httpStatus: 500, startedAt: 1, finishedAt: 3, durationMs: 2, reportedAt: 3 } as any);

    const byClient = tasksService.list({ clientId: 'a', page: 1, pageSize: 20 });
    expect(byClient.total).toBe(1);

    const byStatus = tasksService.list({ status: 'failed', page: 1, pageSize: 20 });
    expect(byStatus.total).toBe(1);
  });

  it('returns camelCase task records with parsed summary objects', async () => {
    await tasksService.upsertMirrorRecord({
      recordId: 'rec_02',
      clientId: 'client-2',
      clientNameSnapshot: 'Development Machine (dev-client-01)',
      requestId: 'req_02',
      resourceType: 'job',
      actionType: 'job.command' as const,
      method: 'POST',
      path: '/jobs/command',
      targetId: 'ipconfig',
      sourceType: 'agent-api' as const,
      actorType: 'agent-token' as const,
      actorLabel: 'agent-api/agent-token',
      querySummary: { clientId: 'client-2' },
      requestSummary: { command: 'ipconfig' },
      resultSummary: { exitCode: 0, stdoutBytes: 1234 },
      status: 'success' as const,
      httpStatus: 200,
      startedAt: 1710000000000,
      finishedAt: 1710000002500,
      durationMs: 2500,
      reportedAt: 1710000002501,
    } as any);

    const page = tasksService.list({ page: 1, pageSize: 20 });
    expect(page.items).toHaveLength(1);
    expect(page.items[0]).toMatchObject({
      recordId: 'rec_02',
      clientId: 'client-2',
      clientNameSnapshot: 'Development Machine (dev-client-01)',
      requestId: 'req_02',
      actionType: 'job.command',
      targetId: 'ipconfig',
      startedAt: 1710000000000,
      finishedAt: 1710000002500,
      durationMs: 2500,
      querySummary: { clientId: 'client-2' },
      requestSummary: { command: 'ipconfig' },
      resultSummary: { exitCode: 0, stdoutBytes: 1234 },
    });
    expect(page.items[0]).not.toHaveProperty('record_id');
    expect(page.items[0]).not.toHaveProperty('duration_ms');
    expect(page.items[0]).not.toHaveProperty('result_summary');

    const detail = tasksService.getByRecordId('rec_02');
    expect(detail).toMatchObject({
      recordId: 'rec_02',
      clientId: 'client-2',
      resultSummary: { exitCode: 0, stdoutBytes: 1234 },
      durationMs: 2500,
    });
    expect(detail).not.toHaveProperty('record_id');
    expect(detail).not.toHaveProperty('duration_ms');
    expect(detail).not.toHaveProperty('result_summary');
  });
});
