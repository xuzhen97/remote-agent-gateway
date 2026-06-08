import { describe, expect, it, vi } from 'vitest';
import { forwardServerJobRun } from './server-job-runner.js';

describe('forwardServerJobRun', () => {
  it('forwards a terminal event when a fast job completes before subscription observes it', async () => {
    const send = vi.fn();
    const terminalJob = { jobId: 'job_fast', type: 'command' as const, status: 'success' as const, exitCode: 0 };
    const manager = {
      createCommand: vi.fn(() => terminalJob),
      subscribe: vi.fn(() => () => undefined),
      wait: vi.fn(async () => terminalJob),
    };

    await forwardServerJobRun({
      requestId: 'req_1',
      payload: { command: 'node', args: ['-e', ''] },
      manager: manager as never,
      send,
    });

    expect(send).toHaveBeenCalledWith({
      type: 'client.job.event',
      requestId: 'req_1',
      payload: { jobId: 'job_fast', event: 'job.completed', data: terminalJob },
    });
    expect(manager.wait).toHaveBeenCalledWith('job_fast');
  });

  it('does not forward a duplicate terminal event if subscription already forwarded it', async () => {
    const send = vi.fn();
    const terminalJob = { jobId: 'job_fast', type: 'command' as const, status: 'success' as const, exitCode: 0 };
    const manager = {
      createCommand: vi.fn(() => ({ jobId: 'job_fast', type: 'command' as const, status: 'running' as const })),
      subscribe: vi.fn((_jobId: string, listener: (event: unknown) => void) => {
        listener({ event: 'job.completed', data: terminalJob });
        return () => undefined;
      }),
      wait: vi.fn(async () => terminalJob),
    };

    await forwardServerJobRun({
      requestId: 'req_1',
      payload: { command: 'node', args: ['-e', ''] },
      manager: manager as never,
      send,
    });

    const terminalSends = send.mock.calls.filter(([message]) => message.payload.event === 'job.completed');
    expect(terminalSends).toHaveLength(1);
  });
});
