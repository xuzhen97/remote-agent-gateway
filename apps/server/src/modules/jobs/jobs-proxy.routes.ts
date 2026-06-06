import type { FastifyInstance } from 'fastify';
import { randomUUID } from 'node:crypto';
import { authMiddleware } from '../auth/auth.middleware.js';
import { connectionManager } from '../connections/connections.manager.js';

interface PendingJob {
  requestId: string;
  clientId: string;
  resolve: (value: unknown) => void;
  reject: (reason: Error) => void;
  job: Record<string, unknown> | null;
  logs: Array<{ seq: number; stream: string; content: string; timestamp: number }>;
  timer: ReturnType<typeof setTimeout>;
  seqCounter: number;
}

const pendingJobs = new Map<string, PendingJob>();

export function resolveJobEvent(requestId: string, event: string, data: Record<string, unknown>): void {
  const pending = pendingJobs.get(requestId);
  if (!pending) return;

  switch (event) {
    case 'job.started':
      pending.job = { jobId: data.jobId, ...data } as Record<string, unknown>;
      break;
    case 'job.stdout':
    case 'job.stderr': {
      pending.seqCounter++;
      const entry = data as Record<string, unknown>;
      pending.logs.push({
        seq: pending.seqCounter,
        stream: event === 'job.stdout' ? 'stdout' : 'stderr',
        content: typeof entry.content === 'string' ? entry.content : '',
        timestamp: typeof entry.timestamp === 'number' ? entry.timestamp : Date.now(),
      });
      break;
    }
    case 'job.completed':
    case 'job.failed': {
      clearTimeout(pending.timer);
      pending.job = { ...pending.job, ...data, status: event === 'job.completed' ? 'success' : 'failed' };
      pending.resolve({ job: pending.job, logs: { jobId: pending.job?.jobId, logs: pending.logs, nextSeq: pending.seqCounter } });
      pendingJobs.delete(requestId);
      break;
    }
    default:
      break;
  }
}

export async function jobsProxyRoutes(app: FastifyInstance): Promise<void> {
  app.addHook('preHandler', authMiddleware);

  app.post<{ Params: { clientId: string }; Body: { command: string; args?: string[]; timeoutMs?: number; cwd?: string; env?: Record<string, string> } }>(
    '/api/clients/:clientId/jobs/run',
    async (request, reply) => {
      const { clientId } = request.params;
      const { command, args, timeoutMs, cwd, env } = request.body;

      if (!connectionManager.isOnline(clientId)) {
        return reply.code(409).send({ ok: false, error: { code: 'CLIENT_OFFLINE', message: `Client ${clientId} is offline` } });
      }

      const requestId = `job_${randomUUID().slice(0, 12)}`;
      const waitTimeoutMs = (timeoutMs ?? 300_000) + 15_000;

      const jobPromise = new Promise<unknown>((resolve, reject) => {
        const timer = setTimeout(() => {
          pendingJobs.delete(requestId);
          reject(new Error('Job timed out'));
        }, waitTimeoutMs);

        pendingJobs.set(requestId, {
          requestId,
          clientId,
          resolve,
          reject,
          job: null,
          logs: [],
          timer,
          seqCounter: 0,
        });

        const sent = connectionManager.sendToClient(clientId, {
          type: 'server.job.run',
          requestId,
          payload: { command, args, timeoutMs, cwd, env },
        });

        if (!sent) {
          clearTimeout(timer);
          pendingJobs.delete(requestId);
          reject(new Error('Failed to send job to client'));
        }
      });

      try {
        const result = await jobPromise;
        return reply.send({ ok: true, data: result });
      } catch (err) {
        return reply.code(500).send({
          ok: false,
          error: { code: 'JOB_ERROR', message: err instanceof Error ? err.message : String(err) },
        });
      }
    },
  );
}
