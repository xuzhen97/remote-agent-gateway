import { describe, expect, it, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createTaskAuditStore } from './task-audit-store.js';
import { attachJobAuditLifecycle } from './job-audit-lifecycle.js';

describe('task audit lifecycle/report race', () => {
  it('preserves finalized lifecycle when initial sync patch resolves after replace', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'rag-task-audit-race-'));
    const store = createTaskAuditStore(join(dir, 'task-audit.jsonl'));
    await store.append({
      recordId: 'rec_race', clientId: 'dev-client-01', requestId: 'req_race',
      resourceType: 'job', actionType: 'job.command', method: 'POST', path: '/jobs/command',
      targetId: 'job_race', sourceType: 'direct-client-http', actorType: 'client-token', actorLabel: 'direct-client-http/client-token',
      requestSummary: { command: 'ipconfig' }, resultSummary: { jobId: 'job_race', status: 'running' },
      status: 'success', httpStatus: 200, startedAt: 100, finishedAt: 110, durationMs: 10,
      syncStatus: 'pending', reportedAt: 110,
    } as any);

    const initialRecords = await store.list();
    const staleBeforeFinalize = { ...initialRecords[0] };

    let listener: ((event: any) => void) | undefined;
    const manager = {
      subscribe: vi.fn((_jobId: string, cb: (event: any) => void) => { listener = cb; return () => undefined; }),
      wait: vi.fn(async () => ({ jobId: 'job_race', type: 'command', status: 'success', startedAt: 100, finishedAt: 125, exitCode: 0 })),
      getJob: vi.fn(() => ({ jobId: 'job_race', type: 'command', status: 'running', startedAt: 100 })),
      getLogs: vi.fn(() => ({ logs: [{ seq: 1, stream: 'stdout', content: 'IPv4 Address. . . : 192.168.0.12\n', timestamp: 105 }], nextSeq: 1 })),
    };
    const reporter = { report: vi.fn(async () => undefined) };

    attachJobAuditLifecycle({ recordId: 'rec_race', jobId: 'job_race', manager: manager as any, store, reporter });
    await listener?.({ event: 'job.completed', data: { jobId: 'job_race', type: 'command', status: 'success', startedAt: 100, finishedAt: 125, exitCode: 0 } });
    await new Promise((resolve) => setTimeout(resolve, 0));

    await store.updateSync('rec_race', { syncStatus: 'synced', syncedAt: 130, syncError: null });

    const afterNormalSync = await store.list();
    expect(afterNormalSync[0].resultSummary).toMatchObject({ lifecycle: { status: 'success', exitCode: 0 } });

    await store.replace(staleBeforeFinalize as any);
    const afterStaleRewrite = await store.list();
    expect(afterStaleRewrite[0].resultSummary).not.toMatchObject({ lifecycle: { status: 'success', exitCode: 0 } });
    rmSync(dir, { recursive: true, force: true });
  });
});
