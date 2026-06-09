/** @file 任务管理器
 *
 * 管理命令/脚本执行的生命周期：创建 → 启动 → 运行（带日志收集）→ 完成/失败/取消。
 *
 * 特性：
 * - 支持并发限制
 * - 支持 SSE 订阅实时日志
 * - 支持异步等待（promise）
 * - 自动解码控制台输出编码
 */
import { spawn, type ChildProcess } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { randomUUID } from 'node:crypto';
import type { ClientJobCommandPayload, ClientJobLogEntry, ClientJobScriptPayload, ClientJobStatus, ClientJobType } from '@rag/shared';
import { decodeConsoleBuffer } from './decode-console-output.js';

/** 任务管理器配置选项 */
export interface JobManagerOptions {
  maxConcurrent: number;       // 最大并发数
  defaultTimeoutMs: number;    // 默认超时（毫秒）
  maxTimeoutMs: number;        // 最大超时（毫秒）
  logBufferLines: number;       // 日志缓冲行数
  workspaceDir: string;         // 工作目录
}

/** 任务记录 */
export interface JobRecord {
  jobId: string;               // 任务唯一 ID
  type: ClientJobType;         // 任务类型（命令/脚本）
  status: ClientJobStatus;     // 当前状态
  startedAt?: number;          // 开始时间
  finishedAt?: number;         // 结束时间
  exitCode?: number | null;    // 退出码
  error?: string | null;       // 错误信息
}

/** 任务事件类型 */
export type JobEvent =
  | { event: 'job.started'; data: JobRecord; id?: number }
  | { event: 'job.stdout' | 'job.stderr'; data: ClientJobLogEntry; id: number }
  | { event: 'job.completed' | 'job.failed' | 'job.cancelled'; data: JobRecord; id?: number }
  | { event: 'heartbeat'; data: { timestamp: number }; id?: number };

/** 内部任务状态（包含进程引用、日志缓存、订阅者等） */
interface JobInternal {
  record: JobRecord;
  process?: ChildProcess;          // 子进程引用
  logs: ClientJobLogEntry[];       // 日志环形缓冲区
  seqCounter: number;              // 日志序号计数器
  subscribers: Set<(event: JobEvent) => void>;  // SSE 订阅者
  activeReleased: boolean;         // 是否已释放并发槽位
  resolve?: (record: JobRecord) => void;  // wait() 的 resolve 回调
}

/** 终态集合：到达这些状态后不可再变更 */
const TERMINAL_STATUSES = new Set<ClientJobStatus>(['success', 'failed', 'cancelled']);

/** 任务管理器 */
export class JobManager {
  /** jobId → JobInternal 映射 */
  private readonly jobs = new Map<string, JobInternal>();
  /** 当前活跃（正在运行）的任务数 */
  private active = 0;

  constructor(private readonly options: JobManagerOptions) {}

  /** 创建命令执行任务 */
  createCommand(payload: ClientJobCommandPayload): JobRecord {
    this.assertCapacity();
    const jobId = `job_${randomUUID().slice(0, 12)}`;
    const internal: JobInternal = {
      record: { jobId, type: 'command', status: 'queued' },
      logs: [],
      seqCounter: 0,
      subscribers: new Set(),
      activeReleased: false,
    };
    this.jobs.set(jobId, internal);
    try {
      this.startJob(jobId, internal, () => this.runCommand(jobId, payload, internal));
    } catch (err) {
      this.jobs.delete(jobId);
      throw err;
    }
    return internal.record;
  }

  /** 创建脚本执行任务 */
  createScript(payload: ClientJobScriptPayload): JobRecord {
    this.assertCapacity();
    const jobId = `job_${randomUUID().slice(0, 12)}`;
    const internal: JobInternal = {
      record: { jobId, type: 'script', status: 'queued' },
      logs: [],
      seqCounter: 0,
      subscribers: new Set(),
      activeReleased: false,
    };
    this.jobs.set(jobId, internal);
    try {
      this.startJob(jobId, internal, () => this.runScript(jobId, payload, internal));
    } catch (err) {
      this.jobs.delete(jobId);
      throw err;
    }
    return internal.record;
  }

  /** 获取任务状态 */
  getJob(jobId: string): JobRecord | undefined {
    return this.jobs.get(jobId)?.record;
  }

  /**
   * 获取任务日志（支持基于序号的增量拉取）
   * @param sinceSeq - 从此序号之后
   * @param limit - 最多返回条数
   */
  getLogs(jobId: string, sinceSeq: number, limit: number): { logs: ClientJobLogEntry[]; nextSeq: number } {
    const ji = this.jobs.get(jobId);
    if (!ji) return { logs: [], nextSeq: sinceSeq };
    const filtered = ji.logs.filter((l) => l.seq > sinceSeq).slice(0, limit);
    return { logs: filtered, nextSeq: filtered.length ? filtered[filtered.length - 1].seq : sinceSeq };
  }

  /** 取消任务（发送 SIGTERM） */
  cancel(jobId: string): JobRecord {
    const ji = this.jobs.get(jobId);
    if (!ji) throw new Error('任务未找到');
    if (ji.process && !ji.process.killed) {
      ji.process.kill('SIGTERM');
    }
    this.finalize(ji, 'cancelled', 'job.cancelled', { exitCode: null });
    return ji.record;
  }

  /** 等待任务完成（返回 Promise<JobRecord>） */
  wait(jobId: string): Promise<JobRecord> {
    const ji = this.jobs.get(jobId);
    if (!ji) throw new Error('任务未找到');
    if (TERMINAL_STATUSES.has(ji.record.status)) {
      return Promise.resolve(ji.record);
    }
    return new Promise((resolve) => { ji.resolve = resolve; });
  }

  /**
   * 订阅任务事件（SSE 使用）
   * @returns 取消订阅的函数
   */
  subscribe(jobId: string, listener: (event: JobEvent) => void): () => void {
    const ji = this.jobs.get(jobId);
    if (!ji) { listener({ event: 'job.failed', data: { jobId, type: 'command', status: 'failed', error: '任务未找到' } }); return () => {}; }
    ji.subscribers.add(listener);
    return () => ji.subscribers.delete(listener);
  }

  /** 检查是否达到并发上限 */
  private assertCapacity(): void {
    if (this.active >= this.options.maxConcurrent) {
      throw new Error(`并发任务已达上限 ${this.options.maxConcurrent}`);
    }
  }

  /**
   * 启动任务（占用并发槽位，发出 started 事件）
   */
  private startJob(jobId: string, ji: JobInternal, run: () => Promise<void>): void {
    this.assertCapacity();
    this.active++;
    ji.record.status = 'running';
    ji.record.startedAt = Date.now();
    this.emit(ji, { event: 'job.started', data: ji.record });
    run().catch((err) => {
      this.finalize(ji, 'failed', 'job.failed', { error: err instanceof Error ? err.message : String(err) });
    });
  }

  /** 运行命令（通过 spawn） */
  private async runCommand(jobId: string, payload: ClientJobCommandPayload, ji: JobInternal): Promise<void> {
    const timeoutMs = Math.min(payload.timeoutMs ?? this.options.defaultTimeoutMs, this.options.maxTimeoutMs);
    const child = spawn(payload.command, payload.args ?? [], {
      cwd: payload.cwd ?? this.options.workspaceDir,
      env: { ...process.env, ...payload.env },
      shell: process.platform === 'win32',  // Windows 需要 shell
      timeout: timeoutMs,
    });

    ji.process = child;

    child.stdout?.on('data', (d: Buffer) => this.appendLog(ji, 'stdout', decodeConsoleBuffer(d)));
    child.stderr?.on('data', (d: Buffer) => this.appendLog(ji, 'stderr', decodeConsoleBuffer(d)));

    child.on('close', (code) => {
      this.finalize(ji, code === 0 ? 'success' : 'failed', code === 0 ? 'job.completed' : 'job.failed', { exitCode: code });
    });

    child.on('error', (err) => {
      this.finalize(ji, 'failed', 'job.failed', { error: err.message });
    });
  }

  /** 运行脚本（写入临时文件后通过对应运行时执行） */
  private async runScript(jobId: string, payload: ClientJobScriptPayload, ji: JobInternal): Promise<void> {
    const runtime = payload.runtime ?? 'node';
    // 根据运行时选择文件扩展名
    const ext = runtime === 'node' ? '.js' : runtime === 'python' ? '.py' : runtime === 'powershell' ? '.ps1' : '.sh';
    const taskDir = path.join(this.options.workspaceDir, 'jobs', jobId);
    fs.mkdirSync(taskDir, { recursive: true });
    const scriptPath = path.join(taskDir, `script${ext}`);
    fs.writeFileSync(scriptPath, payload.script, 'utf-8');

    // 运行时 → 命令映射
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

    child.stdout?.on('data', (d: Buffer) => this.appendLog(ji, 'stdout', decodeConsoleBuffer(d)));
    child.stderr?.on('data', (d: Buffer) => this.appendLog(ji, 'stderr', decodeConsoleBuffer(d)));

    child.on('close', (code) => {
      this.finalize(ji, code === 0 ? 'success' : 'failed', code === 0 ? 'job.completed' : 'job.failed', { exitCode: code });
    });

    child.on('error', (err) => {
      this.finalize(ji, 'failed', 'job.failed', { error: err.message });
    });
  }

  /**
   * 终结任务（设置终态、发出事件、释放并发槽位）
   * 幂等：多次调用仅第一次生效
   */
  private finalize(
    ji: JobInternal,
    status: 'success' | 'failed' | 'cancelled',
    event: 'job.completed' | 'job.failed' | 'job.cancelled',
    updates: { exitCode?: number | null; error?: string | null } = {},
  ): void {
    if (TERMINAL_STATUSES.has(ji.record.status)) return;  // 防止重复终结
    ji.record.status = status;
    if ('exitCode' in updates) ji.record.exitCode = updates.exitCode;
    if ('error' in updates) ji.record.error = updates.error;
    ji.record.finishedAt = Date.now();
    this.emit(ji, { event, data: ji.record });
    ji.resolve?.(ji.record);          // 通知 wait() 的调用方
    this.releaseActive(ji);            // 释放并发槽位
  }

  /** 释放并发槽位（确保只释放一次） */
  private releaseActive(ji: JobInternal): void {
    if (ji.activeReleased) return;
    ji.activeReleased = true;
    this.active = Math.max(0, this.active - 1);
    this.drain();
  }

  /** 追加日志条目（环形缓冲区） */
  private appendLog(ji: JobInternal, stream: 'stdout' | 'stderr', content: string): void {
    ji.seqCounter++;
    const entry: ClientJobLogEntry = { seq: ji.seqCounter, stream, content, timestamp: Date.now() };
    ji.logs.push(entry);
    if (ji.logs.length > this.options.logBufferLines) ji.logs.shift();  // 超过上限时淘汰旧日志
    this.emit(ji, { event: stream === 'stdout' ? 'job.stdout' : 'job.stderr', data: entry, id: entry.seq });
  }

  /** 发出事件到所有订阅者 */
  private emit(ji: JobInternal, event: JobEvent): void {
    for (const sub of ji.subscribers) {
      try { sub(event); } catch { /* 忽略订阅者错误 */ }
    }
  }

  /**
   * 排空队列（预留接口）
   * 未来可实现持久化队列，从队列中取出等待的任务执行
   */
  private drain(): void {
    // future: pick queued jobs from a persistent queue
  }
}
