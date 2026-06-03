import type { IncomingMessage, ServerResponse } from 'node:http';
import { ClientJobCommandPayloadSchema, ClientJobScriptPayloadSchema } from '@rag/shared';
import type { ControlHttpRouter } from './router.js';
import { readJson, sendError, sendOk, setCorsHeaders } from './response.js';
import { requireBearerToken } from './auth.js';
import type { JobManager, JobEvent } from './job-manager.js';
import type { TaskAuditExecutor } from './task-audit.js';

function writeSse(res: ServerResponse, item: JobEvent): void {
  if (typeof item.id === 'number') res.write(`id: ${item.id}\n`);
  res.write(`event: ${item.event}\n`);
  res.write(`data: ${JSON.stringify(item.data)}\n\n`);
}

export function registerJobRoutes(
  router: ControlHttpRouter,
  manager: JobManager,
  token: string,
  audit: TaskAuditExecutor,
  options: { clientId: string },
): void {
  router.add('POST', /^\/jobs\/command$/, async (req, res) => {
    if (!requireBearerToken(req, res, token)) return;
    try {
      const payload = ClientJobCommandPayloadSchema.parse(await readJson(req));
      const body = await audit.execute({
        req, actionType: 'job.command', resourceType: 'job',
        method: 'POST', path: '/jobs/command', payload,
        run: async () => {
          const job = manager.createCommand(payload);
          return { httpStatus: 200, resultSummary: { jobId: job.jobId, status: job.status }, targetId: job.jobId, status: 'success', body: { jobId: job.jobId, status: job.status } };
        },
      });
      sendOk(res, body);
    } catch (err) {
      sendError(res, 400, 'INVALID_REQUEST', err instanceof Error ? err.message : String(err));
    }
  });

  router.add('POST', /^\/jobs\/script$/, async (req, res) => {
    if (!requireBearerToken(req, res, token)) return;
    try {
      const payload = ClientJobScriptPayloadSchema.parse(await readJson(req));
      const body = await audit.execute({
        req, actionType: 'job.script', resourceType: 'job',
        method: 'POST', path: '/jobs/script', payload,
        run: async () => {
          const job = manager.createScript(payload);
          return { httpStatus: 200, resultSummary: { jobId: job.jobId, status: job.status }, targetId: job.jobId, status: 'success', body: { jobId: job.jobId, status: job.status } };
        },
      });
      sendOk(res, body);
    } catch (err) {
      sendError(res, 400, 'INVALID_REQUEST', err instanceof Error ? err.message : String(err));
    }
  });

  router.add('GET', /^\/jobs\/[^/]+$/, (req, res, url) => {
    if (!requireBearerToken(req, res, token)) return;
    const jobId = url.pathname.split('/')[2];
    const job = manager.getJob(jobId);
    if (!job) return sendError(res, 404, 'NOT_FOUND', 'Job not found');
    sendOk(res, job);
  });

  router.add('GET', /^\/jobs\/[^/]+\/logs$/, (req, res, url) => {
    if (!requireBearerToken(req, res, token)) return;
    const jobId = url.pathname.split('/')[2];
    const sinceSeq = Number(url.searchParams.get('sinceSeq') ?? '0');
    const limit = Number(url.searchParams.get('limit') ?? '500');
    sendOk(res, { jobId, ...manager.getLogs(jobId, sinceSeq, limit) });
  });

  router.add('POST', /^\/jobs\/[^/]+\/cancel$/, async (req, res, url) => {
    if (!requireBearerToken(req, res, token)) return;
    try {
      const jobId = url.pathname.split('/')[2];
      const body = await audit.execute({
        req, actionType: 'job.cancel', resourceType: 'job',
        method: 'POST', path: `/jobs/${jobId}/cancel`, payload: { jobId },
        run: async () => {
          const result = manager.cancel(jobId);
          return { httpStatus: 200, resultSummary: { status: result.status }, targetId: jobId, status: 'success', body: result };
        },
      });
      sendOk(res, body);
    } catch (err) {
      sendError(res, 404, 'NOT_FOUND', err instanceof Error ? err.message : String(err));
    }
  });

  router.add('GET', /^\/jobs\/[^/]+\/events$/, (req, res, url) => {
    if (!requireBearerToken(req, res, token)) return;
    const jobId = url.pathname.split('/')[2];
    setCorsHeaders(res);
    res.writeHead(200, {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
    });

    const lastEventId = Number(req.headers['last-event-id'] ?? '0');
    for (const log of manager.getLogs(jobId, lastEventId, 500).logs) {
      writeSse(res, { event: log.stream === 'stdout' ? 'job.stdout' : 'job.stderr', data: log, id: log.seq });
    }

    const unsubscribe = manager.subscribe(jobId, (event) => {
      writeSse(res, event);
    });
    req.on('close', unsubscribe);
  });
}
