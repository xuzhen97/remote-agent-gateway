import { describe, expect, it, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createTaskAuditStore } from './task-audit-store.js';
import { attachJobAuditLifecycle } from './job-audit-lifecycle.js';
import type { JobEvent } from './job-manager.js';

describe('job audit lifecycle', () => {
  it('updates an existing job audit record with final lifecycle and output summary', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'rag-job-audit-'));
    const store = createTaskAuditStore(join(dir, 'task-audit.jsonl'));
    await store.append({
      recordId: 'rec_job_01',
      clientId: 'dev-client-01',
      requestId: 'req_job_01',
      jobId: 'job_01',
      resourceType: 'job',
      actionType: 'job.command',
      method: 'POST',
      path: '/jobs/command',
      targetId: 'job_01',
      sourceType: 'direct-client-http',
      actorType: 'client-token',
      actorLabel: 'direct-client-http/client-token',
      requestSummary: { command: 'ipconfig' },
      resultSummary: { jobId: 'job_01', status: 'running' },
      status: 'success',
      httpStatus: 200,
      startedAt: 100,
      finishedAt: 110,
      durationMs: 10,
      syncStatus: 'pending',
      reportedAt: 110,
    } as any);

    let listener: ((event: JobEvent) => void | Promise<void>) | undefined;
    const manager = {
      subscribe: vi.fn((_jobId: string, cb: (event: JobEvent) => void) => {
        listener = cb;
        return () => undefined;
      }),
      wait: vi.fn(async () => ({
        jobId: 'job_01',
        type: 'command',
        status: 'success',
        startedAt: 100,
        finishedAt: 125,
        exitCode: 0,
      })),
      getJob: vi.fn(() => ({
        jobId: 'job_01',
        type: 'command',
        status: 'running',
        startedAt: 100,
      })),
      getLogs: vi.fn(() => ({
        logs: [
          { seq: 1, stream: 'stdout', content: 'Windows IP Configuration\r\n', timestamp: 105 },
          { seq: 2, stream: 'stdout', content: '   IPv4 Address. . . . . . . . . . . : 192.168.0.12\r\n', timestamp: 110 },
          { seq: 3, stream: 'stdout', content: '   Default Gateway . . . . . . . . . : 192.168.0.1\r\n', timestamp: 111 },
          { seq: 4, stream: 'stderr', content: 'warning line\r\n', timestamp: 112 },
        ],
        nextSeq: 4,
      })),
    };
    const reporter = { report: vi.fn(async () => undefined) };

    attachJobAuditLifecycle({
      recordId: 'rec_job_01',
      jobId: 'job_01',
      manager: manager as any,
      store,
      reporter,
    });

    await listener?.({
      event: 'job.completed',
      data: {
        jobId: 'job_01',
        type: 'command',
        status: 'success',
        startedAt: 100,
        finishedAt: 125,
        exitCode: 0,
      },
    });
    await new Promise((resolve) => setTimeout(resolve, 0));

    const records = await store.list();
    expect(records).toHaveLength(1);
    expect(records[0]).toMatchObject({
      recordId: 'rec_job_01',
      jobId: 'job_01',
      finishedAt: 125,
      durationMs: 25,
      resultSummary: {
        jobId: 'job_01',
        lifecycle: { status: 'success', exitCode: 0, durationMs: 25 },
        output: {
          stdoutLineCount: 3,
          stderrLineCount: 1,
          stdoutTail: [
            'Windows IP Configuration',
            'IPv4 Address. . . . . . . . . . . : 192.168.0.12',
            'Default Gateway . . . . . . . . . : 192.168.0.1',
          ],
          stderrTail: ['warning line'],
        },
        extracted: {
          ipv4: ['192.168.0.12'],
          defaultGateway: ['192.168.0.1'],
        },
      },
    });
    expect(reporter.report).toHaveBeenCalledWith(expect.objectContaining({
      recordId: 'rec_job_01',
      jobId: 'job_01',
      durationMs: 25,
    }));
    rmSync(dir, { recursive: true, force: true });
  });
});
