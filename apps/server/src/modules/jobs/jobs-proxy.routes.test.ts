import { afterEach, describe, expect, it } from 'vitest';
import { resolveJobEvent, __testing } from './jobs-proxy.routes.js';

describe('jobs proxy terminal event handling', () => {
  afterEach(() => {
    __testing.clearPendingJobs();
  });

  it('resolves and removes pending proxy jobs on job.cancelled', async () => {
    const requestId = 'job_req_cancelled';
    const timer = setTimeout(() => undefined, 10_000);
    const resultPromise = new Promise<unknown>((resolve, reject) => {
      __testing.pendingJobs.set(requestId, {
        requestId,
        clientId: 'client-1',
        resolve,
        reject,
        job: { jobId: 'job_1', status: 'running' },
        logs: [],
        timer,
        seqCounter: 0,
      });
    });

    resolveJobEvent(requestId, 'job.cancelled', { jobId: 'job_1', type: 'command', status: 'cancelled' });

    await expect(resultPromise).resolves.toEqual({
      job: { jobId: 'job_1', status: 'cancelled', type: 'command' },
      logs: { jobId: 'job_1', logs: [], nextSeq: 0 },
    });
    expect(__testing.pendingJobs.has(requestId)).toBe(false);
  });
});
