import type { ClientTaskAuditLocalRecord } from '@rag/shared';
import type { JobEvent, JobRecord } from './job-manager.js';
import type { TaskAuditStore } from './task-audit-store.js';

export interface JobAuditLifecycleManager {
  subscribe(jobId: string, listener: (event: JobEvent) => void): () => void;
  wait(jobId: string): Promise<JobRecord>;
  getJob(jobId: string): JobRecord | undefined;
  getLogs(jobId: string, sinceSeq: number, limit: number): {
    logs: Array<{ seq: number; stream: 'stdout' | 'stderr'; content: string; timestamp: number }>;
    nextSeq: number;
  };
}

function splitLines(chunks: string[]): string[] {
  return chunks
    .flatMap((chunk) => chunk.split(/\r?\n/))
    .map((line) => line.trim())
    .filter(Boolean);
}

function summarizeLogs(logs: Array<{ stream: 'stdout' | 'stderr'; content: string }>) {
  const stdoutChunks = logs.filter((item) => item.stream === 'stdout').map((item) => item.content);
  const stderrChunks = logs.filter((item) => item.stream === 'stderr').map((item) => item.content);
  const stdoutLines = splitLines(stdoutChunks);
  const stderrLines = splitLines(stderrChunks);

  return {
    stdoutBytes: stdoutChunks.reduce((sum, chunk) => sum + Buffer.byteLength(chunk, 'utf8'), 0),
    stderrBytes: stderrChunks.reduce((sum, chunk) => sum + Buffer.byteLength(chunk, 'utf8'), 0),
    stdoutLineCount: stdoutLines.length,
    stderrLineCount: stderrLines.length,
    stdoutTail: stdoutLines.slice(-20),
    stderrTail: stderrLines.slice(-20),
  };
}

function extractSignals(stdoutTail: string[]) {
  const ipv4 = new Set<string>();
  const defaultGateway = new Set<string>();

  for (const line of stdoutTail) {
    const ips = line.match(/\b(?:\d{1,3}\.){3}\d{1,3}\b/g) ?? [];
    if (/ipv4/i.test(line)) {
      for (const ip of ips) ipv4.add(ip);
    }
    if (/default gateway|默认网关/i.test(line)) {
      for (const ip of ips) defaultGateway.add(ip);
    }
  }

  return {
    ipv4: [...ipv4],
    defaultGateway: [...defaultGateway],
  };
}

async function updateFromFinalState(options: {
  recordId: string;
  jobId: string;
  finalRecord: JobRecord;
  manager: JobAuditLifecycleManager;
  store: TaskAuditStore;
  reporter: { report(record: ClientTaskAuditLocalRecord): Promise<void> };
}) {
  const records = await options.store.list();
  const current = records.find((record) => record.recordId === options.recordId);
  if (!current) return;

  const { logs } = options.manager.getLogs(options.jobId, 0, 10_000);
  const output = summarizeLogs(logs);
  const extracted = extractSignals(output.stdoutTail);
  const finishedAt = options.finalRecord.finishedAt ?? current.finishedAt;
  const startedAt = options.finalRecord.startedAt ?? current.startedAt;
  const durationMs = Math.max(0, finishedAt - startedAt);

  const updated: ClientTaskAuditLocalRecord = {
    ...current,
    jobId: options.jobId,
    targetId: options.jobId,
    status: options.finalRecord.status === 'cancelled'
      ? 'cancelled'
      : options.finalRecord.status === 'failed'
        ? 'failed'
        : 'success',
    startedAt,
    finishedAt,
    durationMs,
    errorMessage: options.finalRecord.error ?? current.errorMessage,
    resultSummary: {
      ...(current.resultSummary ?? {}),
      jobId: options.jobId,
      jobType: options.finalRecord.type,
      lifecycle: {
        status: options.finalRecord.status,
        startedAt,
        finishedAt,
        durationMs,
        exitCode: options.finalRecord.exitCode ?? null,
        error: options.finalRecord.error ?? null,
      },
      output,
      extracted,
    },
    metadata: {
      ...(current.metadata ?? {}),
      jobRef: { jobId: options.jobId },
      detailVersion: 2,
    },
    reportedAt: Date.now(),
    syncStatus: 'pending',
    syncedAt: null,
    syncError: null,
  };

  await options.store.replace(updated);
  await options.reporter.report(updated);
}

export function attachJobAuditLifecycle(options: {
  recordId: string;
  jobId: string;
  manager: JobAuditLifecycleManager;
  store: TaskAuditStore;
  reporter: { report(record: ClientTaskAuditLocalRecord): Promise<void> };
}): () => void {
  let closed = false;

  const finalize = async (record: JobRecord) => {
    if (closed) return;
    if (!['success', 'failed', 'cancelled'].includes(record.status)) return;
    closed = true;
    unsubscribe();
    await updateFromFinalState({
      recordId: options.recordId,
      jobId: options.jobId,
      finalRecord: record,
      manager: options.manager,
      store: options.store,
      reporter: options.reporter,
    });
  };

  const unsubscribe = options.manager.subscribe(options.jobId, (event) => {
    if (event.event === 'job.completed' || event.event === 'job.failed' || event.event === 'job.cancelled') {
      void finalize(event.data);
    }
  });

  void options.manager.wait(options.jobId).then((record) => finalize(record)).catch(() => undefined);

  const current = options.manager.getJob(options.jobId);
  if (current) void finalize(current);

  return () => {
    closed = true;
    unsubscribe();
  };
}
