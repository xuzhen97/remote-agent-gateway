import type { ClientJobCommandPayload } from '@rag/shared';
import type { JobEvent, JobManager, JobRecord } from './runtime/control-http/job-manager.js';

const TERMINAL_EVENT_BY_STATUS: Partial<Record<JobRecord['status'], 'job.completed' | 'job.failed' | 'job.cancelled'>> = {
  success: 'job.completed',
  failed: 'job.failed',
  cancelled: 'job.cancelled',
};

interface ServerJobRunOptions {
  requestId?: string;
  payload: ClientJobCommandPayload;
  manager: Pick<JobManager, 'createCommand' | 'subscribe' | 'wait'>;
  send(message: unknown): void;
}

export async function forwardServerJobRun({ requestId, payload, manager, send }: ServerJobRunOptions): Promise<void> {
  try {
    const job = manager.createCommand(payload);
    const jobId = job.jobId;
    let terminalForwarded = false;

    const forward = (event: Pick<JobEvent, 'event' | 'data'>): void => {
      if (event.event === 'job.completed' || event.event === 'job.failed' || event.event === 'job.cancelled') {
        terminalForwarded = true;
      }
      send({
        type: 'client.job.event',
        requestId,
        payload: { jobId, event: event.event, data: event.data },
      });
    };

    const unsubscribe = manager.subscribe(jobId, forward as (event: JobEvent) => void);
    forward({ event: 'job.started', data: job });
    const terminalJob = await manager.wait(jobId);
    const terminalEvent = TERMINAL_EVENT_BY_STATUS[terminalJob.status];
    if (terminalEvent && !terminalForwarded) {
      forward({ event: terminalEvent, data: terminalJob });
    }
    unsubscribe();
  } catch (err) {
    send({
      type: 'client.job.event',
      requestId,
      payload: { event: 'job.failed', data: { error: err instanceof Error ? err.message : String(err) } },
    });
  }
}
