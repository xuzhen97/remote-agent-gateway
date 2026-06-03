import { spawn, type ChildProcess } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { randomUUID } from 'node:crypto';
import type { ClientJobCommandPayload, ClientJobLogEntry, ClientJobScriptPayload, ClientJobStatus, ClientJobType } from '@rag/shared';

export interface JobManagerOptions {
  maxConcurrent: number;
  defaultTimeoutMs: number;
  maxTimeoutMs: number;
  logBufferLines: number;
  workspaceDir: string;
}

export interface JobRecord {
  jobId: string;
  type: ClientJobType;
  status: ClientJobStatus;
  startedAt?: number;
  finishedAt?: number;
  exitCode?: number | null;
  error?: string | null;
}

export type JobEvent =
  | { event: 'job.started'; data: JobRecord; id?: number }
  | { event: 'job.stdout' | 'job.stderr'; data: ClientJobLogEntry; id: number }
  | { event: 'job.completed' | 'job.failed' | 'job.cancelled'; data: JobRecord; id?: number }
  | { event: 'heartbeat'; data: { timestamp: number }; id?: number };

interface JobInternal {
  record: JobRecord;
  process?: ChildProcess;
  logs: ClientJobLogEntry[];
  seqCounter: number;
  subscribers: Set<(event: JobEvent) => void>;
  resolve?: (record: JobRecord) => void;
}

export class JobManager {
  private readonly jobs = new Map<string, JobInternal>();
  private active = 0;

  constructor(private readonly options: JobManagerOptions) {}

  createCommand(payload: ClientJobCommandPayload): JobRecord {
    const jobId = `job_${randomUUID().slice(0, 12)}`;
    const internal: JobInternal = {
      record: { jobId, type: 'command', status: 'queued' },
      logs: [],
      seqCounter: 0,
      subscribers: new Set(),
    };
    this.jobs.set(jobId, internal);
    this.startJob(jobId, internal, () => this.runCommand(jobId, payload, internal));
    return internal.record;
  }

  createScript(payload: ClientJobScriptPayload): JobRecord {
    const jobId = `job_${randomUUID().slice(0, 12)}`;
    const internal: JobInternal = {
      record: { jobId, type: 'script', status: 'queued' },
      logs: [],
      seqCounter: 0,
      subscribers: new Set(),
    };
    this.jobs.set(jobId, internal);
    this.startJob(jobId, internal, () => this.runScript(jobId, payload, internal));
    return internal.record;
  }

  getJob(jobId: string): JobRecord | undefined {
    return this.jobs.get(jobId)?.record;
  }

  getLogs(jobId: string, sinceSeq: number, limit: number): { logs: ClientJobLogEntry[]; nextSeq: number } {
    const ji = this.jobs.get(jobId);
    if (!ji) return { logs: [], nextSeq: sinceSeq };
    const filtered = ji.logs.filter((l) => l.seq > sinceSeq).slice(0, limit);
    return { logs: filtered, nextSeq: filtered.length ? filtered[filtered.length - 1].seq : sinceSeq };
  }

  cancel(jobId: string): JobRecord {
    const ji = this.jobs.get(jobId);
    if (!ji) throw new Error('Job not found');
    if (ji.process && !ji.process.killed) {
      ji.process.kill('SIGTERM');
    }
    ji.record.status = 'cancelled';
    ji.record.finishedAt = Date.now();
    this.emit(ji, { event: 'job.cancelled', data: ji.record });
    ji.resolve?.(ji.record);
    this.active = Math.max(0, this.active - 1);
    this.drain();
    return ji.record;
  }

  wait(jobId: string): Promise<JobRecord> {
    const ji = this.jobs.get(jobId);
    if (!ji) throw new Error('Job not found');
    if (ji.record.status === 'success' || ji.record.status === 'failed' || ji.record.status === 'cancelled') {
      return Promise.resolve(ji.record);
    }
    return new Promise((resolve) => { ji.resolve = resolve; });
  }

  subscribe(jobId: string, listener: (event: JobEvent) => void): () => void {
    const ji = this.jobs.get(jobId);
    if (!ji) { listener({ event: 'job.failed', data: { jobId, type: 'command', status: 'failed', error: 'Job not found' } }); return () => {}; }
    ji.subscribers.add(listener);
    return () => ji.subscribers.delete(listener);
  }

  private startJob(jobId: string, ji: JobInternal, run: () => Promise<void>): void {
    if (this.active >= this.options.maxConcurrent) {
      throw new Error(`Concurrent job limit ${this.options.maxConcurrent} exceeded`);
    }
    this.active++;
    ji.record.status = 'running';
    ji.record.startedAt = Date.now();
    this.emit(ji, { event: 'job.started', data: ji.record });
    run().catch((err) => {
      if (ji.record.status === 'cancelled') return;
      ji.record.status = 'failed';
      ji.record.error = err instanceof Error ? err.message : String(err);
      ji.record.finishedAt = Date.now();
      this.emit(ji, { event: 'job.failed', data: ji.record });
      ji.resolve?.(ji.record);
    });
  }

  private async runCommand(jobId: string, payload: ClientJobCommandPayload, ji: JobInternal): Promise<void> {
    const timeoutMs = Math.min(payload.timeoutMs ?? this.options.defaultTimeoutMs, this.options.maxTimeoutMs);
    const child = spawn(payload.command, payload.args ?? [], {
      cwd: payload.cwd ?? this.options.workspaceDir,
      env: { ...process.env, ...payload.env },
      shell: process.platform === 'win32',
      timeout: timeoutMs,
    });

    ji.process = child;

    child.stdout?.on('data', (d: Buffer) => this.appendLog(ji, 'stdout', d.toString()));
    child.stderr?.on('data', (d: Buffer) => this.appendLog(ji, 'stderr', d.toString()));

    child.on('close', (code) => {
      ji.record.exitCode = code;
      ji.record.finishedAt = Date.now();
      ji.record.status = code === 0 ? 'success' : 'failed';
      this.emit(ji, { event: code === 0 ? 'job.completed' : 'job.failed', data: ji.record });
      ji.resolve?.(ji.record);
      this.active = Math.max(0, this.active - 1);
      this.drain();
    });

    child.on('error', (err) => {
      if (ji.record.status === 'cancelled') return;
      ji.record.status = 'failed';
      ji.record.error = err.message;
      ji.record.finishedAt = Date.now();
      this.emit(ji, { event: 'job.failed', data: ji.record });
      ji.resolve?.(ji.record);
      this.active = Math.max(0, this.active - 1);
      this.drain();
    });
  }

  private async runScript(jobId: string, payload: ClientJobScriptPayload, ji: JobInternal): Promise<void> {
    const runtime = payload.runtime ?? 'node';
    const ext = runtime === 'node' ? '.js' : runtime === 'python' ? '.py' : runtime === 'powershell' ? '.ps1' : '.sh';
    const taskDir = path.join(this.options.workspaceDir, 'jobs', jobId);
    fs.mkdirSync(taskDir, { recursive: true });
    const scriptPath = path.join(taskDir, `script${ext}`);
    fs.writeFileSync(scriptPath, payload.script, 'utf-8');

    const commandMap: Record<string, string> = {
      node: 'node', python: 'python3', bash: 'bash', powershell: 'powershell.exe',
    };
    const command = commandMap[runtime] ?? 'node';
    const args = runtime === 'powershell' ? ['-File', scriptPath] : [scriptPath];

    const timeoutMs = Math.min(payload.timeoutMs ?? this.options.defaultTimeoutMs, this.options.maxTimeoutMs);
    const child = spawn(command, args, {
      cwd: payload.cwd ?? this.options.workspaceDir,
      env: { ...process.env, ...payload.env },
      timeout: timeoutMs,
    });

    ji.process = child;

    child.stdout?.on('data', (d: Buffer) => this.appendLog(ji, 'stdout', d.toString()));
    child.stderr?.on('data', (d: Buffer) => this.appendLog(ji, 'stderr', d.toString()));

    child.on('close', (code) => {
      ji.record.exitCode = code;
      ji.record.finishedAt = Date.now();
      ji.record.status = code === 0 ? 'success' : 'failed';
      this.emit(ji, { event: code === 0 ? 'job.completed' : 'job.failed', data: ji.record });
      ji.resolve?.(ji.record);
      this.active = Math.max(0, this.active - 1);
      this.drain();
    });

    child.on('error', (err) => {
      if (ji.record.status === 'cancelled') return;
      ji.record.status = 'failed';
      ji.record.error = err.message;
      ji.record.finishedAt = Date.now();
      this.emit(ji, { event: 'job.failed', data: ji.record });
      ji.resolve?.(ji.record);
      this.active = Math.max(0, this.active - 1);
      this.drain();
    });
  }

  private appendLog(ji: JobInternal, stream: 'stdout' | 'stderr', content: string): void {
    ji.seqCounter++;
    const entry: ClientJobLogEntry = { seq: ji.seqCounter, stream, content, timestamp: Date.now() };
    ji.logs.push(entry);
    if (ji.logs.length > this.options.logBufferLines) ji.logs.shift();
    this.emit(ji, { event: stream === 'stdout' ? 'job.stdout' : 'job.stderr', data: entry, id: entry.seq });
  }

  private emit(ji: JobInternal, event: JobEvent): void {
    for (const sub of ji.subscribers) {
      try { sub(event); } catch { /* ignore subscriber errors */ }
    }
  }

  private drain(): void {
    // future: pick queued jobs from a persistent queue
  }
}
