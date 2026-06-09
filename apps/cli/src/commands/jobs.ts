/** @file Jobs 命令 — 任务（命令/脚本）执行
 *
 * rag jobs run      — 执行命令
 * rag jobs script   — 执行脚本
 * rag jobs get/logs/events/cancel — 查询/流式/取消任务
 *
 * --wait 模式通过服务端 WebSocket 代理执行
 * --events 模式通过 SSE 实时流式获取日志
 */
import { readFile } from 'node:fs/promises';
import type { Command } from 'commander';
import type { ClientHttpApi } from '../http/client-http.js';
import { CliError } from '../http/http-error.js';
import { successEnvelope, writeJsonLine } from '../output/json-output.js';
import { optionalNumber, requiredString } from '../util/args.js';

interface JobsDeps {
  discoverClientHttp(clientId: string): Promise<ClientHttpApi>;
  proxyJob(clientId: string, payload: { command: string; args?: string[]; timeoutMs?: number; cwd?: string; env?: Record<string, string> }): Promise<unknown>;
  write(value: unknown): void;
}

/** 任务终态集合 */
const TERMINAL_JOB_STATUSES = new Set(['success', 'failed', 'cancelled']);
/** 默认等待超时（5 分钟） */
const DEFAULT_WAIT_TIMEOUT_MS = 300_000;
/** 轮询间隔（500ms） */
const DEFAULT_POLL_INTERVAL_MS = 500;

function isObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

/** 从可能的成功信封包裹中解包实际数据 */
function unwrapClientPayload(value: unknown): unknown {
  if (isObject(value) && value.ok === true && 'data' in value) {
    return value.data;
  }
  return value;
}

/** 从创建任务响应中提取 jobId */
function getJobId(value: unknown): string {
  const unwrapped = unwrapClientPayload(value);
  if (!isObject(unwrapped) || typeof unwrapped.jobId !== 'string' || !unwrapped.jobId) {
    throw new CliError('PARSE_ERROR', '任务创建响应中没有 jobId');
  }
  return unwrapped.jobId;
}

/** 轮询等待任务完成 */
async function waitForJobCompletion(client: ClientHttpApi, jobId: string, timeoutMs = DEFAULT_WAIT_TIMEOUT_MS): Promise<unknown> {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    const job = unwrapClientPayload(await client.getJob(jobId));
    if (isObject(job) && typeof job.status === 'string' && TERMINAL_JOB_STATUSES.has(job.status)) {
      return job;
    }
    await new Promise((resolve) => setTimeout(resolve, DEFAULT_POLL_INTERVAL_MS));
  }
  throw new CliError('NETWORK_ERROR', `等待任务 ${jobId} 完成超时`);
}

/**
 * 在任务创建后根据选项决定是否需要等待/获取日志/流式事件
 * @returns 是否已处理（true 表示已响应，调用方不再需要写额外输出）
 */
async function maybeFollowJob(options: { wait?: boolean; logs?: boolean; events?: boolean }, client: ClientHttpApi, created: unknown, write: (value: unknown) => void, commandTimeoutMs?: number) {
  const jobId = getJobId(created);

  if (options.events) {
    // SSE 流式事件模式
    writeJsonLine({ ok: true, event: 'job.created', data: unwrapClientPayload(created) });
    for await (const event of client.events(jobId)) {
      writeJsonLine({ ok: true, ...(event as Record<string, unknown>) });
      if (isObject(event) && typeof event.event === 'string' && ['job.completed', 'job.failed', 'job.cancelled'].includes(event.event)) {
        break;
      }
    }
    return true;
  }

  if (!options.wait) {
    // 立即返回（fire-and-forget）
    write(successEnvelope(unwrapClientPayload(created)));
    return true;
  }

  // 等待模式：等待比客户端进程超时稍长以消除竞态
  const waitTimeoutMs = commandTimeoutMs ? commandTimeoutMs + 10_000 : DEFAULT_WAIT_TIMEOUT_MS;
  const job = await waitForJobCompletion(client, jobId, waitTimeoutMs);
  if (!options.logs) {
    write(successEnvelope(job));
    return true;
  }

  // 等待 + 获取日志
  const logs = unwrapClientPayload(await client.getJobLogs(jobId, 0, 500));
  write(successEnvelope({ job, logs }));
  return true;
}

export function registerJobsCommands(program: Command, deps: JobsDeps): void {
  const jobs = program.command('jobs').description('在客户端上创建和查看命令/脚本执行任务');

  // ==================== run: 执行命令 ====================
  jobs.command('run')
    .description('在客户端上执行命令')
    .requiredOption('--client <clientId>', '客户端 ID')
    .option('--wait', '等待任务完成')
    .option('--logs', '等待完成后获取日志（需要 --wait）')
    .option('--events', '创建后流式获取事件（不能与 --wait 同时使用）')
    .option('--cwd <cwd>', '远程工作目录')
    .option('--timeout-ms <timeoutMs>', '超时时间（毫秒，同时作用于客户端进程和 CLI 等待）')
    .allowUnknownOption(true)
    .allowExcessArguments(true)
    .argument('[cmd...]', '-- 之后的命令')
    .action(async (cmd: string[], options: { client?: string; wait?: boolean; logs?: boolean; events?: boolean; cwd?: string; timeoutMs?: string }) => {
      if (!cmd.length) throw new CliError('ARGUMENT_ERROR', '请在 -- 后指定要执行的命令');
      if (options.logs && !options.wait) throw new CliError('ARGUMENT_ERROR', '--logs 需要 --wait');
      if (options.wait && options.events) throw new CliError('ARGUMENT_ERROR', '--wait 不能与 --events 同时使用');
      const timeoutMs = optionalNumber(options.timeoutMs, '--timeout-ms');
      const clientId = requiredString(options.client, '--client');

      // --wait 模式通过服务端 WebSocket 代理执行
      if (options.wait) {
        const result = await deps.proxyJob(clientId, { command: cmd[0], args: cmd.slice(1), timeoutMs, cwd: options.cwd });
        deps.write(result);
        return;
      }

      // 非等待模式：通过 client HTTP 直接创建（fire-and-forget）
      const client = await deps.discoverClientHttp(clientId);
      const created = await client.createCommandJob({ command: cmd[0], args: cmd.slice(1), cwd: options.cwd, timeoutMs });
      await maybeFollowJob(options, client, created, deps.write, timeoutMs);
    });

  // ==================== script: 执行脚本 ====================
  jobs.command('script')
    .description('在客户端上执行内联脚本或文件脚本')
    .requiredOption('--client <clientId>', '客户端 ID')
    .option('--file <file>', '本地脚本文件路径')
    .option('--inline <script>', '内联脚本内容')
    .option('--runtime <runtime>', '运行环境: node, python, bash, powershell', 'node')
    .option('--cwd <cwd>', '远程工作目录')
    .option('--timeout-ms <timeoutMs>', '超时时间（毫秒）')
    .option('--wait', '等待任务完成')
    .option('--logs', '等待完成后获取日志')
    .option('--events', '创建后流式获取事件')
    .action(async (options: { client?: string; file?: string; inline?: string; runtime?: any; cwd?: string; timeoutMs?: string; wait?: boolean; logs?: boolean; events?: boolean }) => {
      const script = options.inline ?? (options.file ? await readFile(options.file, 'utf8') : undefined);
      if (!script) throw new CliError('ARGUMENT_ERROR', '请通过 --inline 或 --file 提供脚本');
      if (options.logs && !options.wait) throw new CliError('ARGUMENT_ERROR', '--logs 需要 --wait');
      if (options.wait && options.events) throw new CliError('ARGUMENT_ERROR', '--wait 不能与 --events 同时使用');
      const client = await deps.discoverClientHttp(requiredString(options.client, '--client'));
      const created = await client.createScriptJob({ runtime: options.runtime, script, cwd: options.cwd, timeoutMs: optionalNumber(options.timeoutMs, '--timeout-ms') });
      await maybeFollowJob(options, client, created, deps.write);
    });

  // ==================== get: 查询任务状态 ====================
  jobs.command('get')
    .requiredOption('--client <clientId>', '客户端 ID')
    .requiredOption('--job <jobId>', '任务 ID')
    .action(async (options: { client?: string; job?: string }) => {
      const client = await deps.discoverClientHttp(requiredString(options.client, '--client'));
      deps.write(successEnvelope(unwrapClientPayload(await client.getJob(requiredString(options.job, '--job')))));
    });

  // ==================== logs: 获取任务日志 ====================
  jobs.command('logs')
    .requiredOption('--client <clientId>', '客户端 ID')
    .requiredOption('--job <jobId>', '任务 ID')
    .option('--since-seq <sinceSeq>', '从此序号之后开始', '0')
    .option('--limit <limit>', '最多返回条数', '500')
    .action(async (options: { client?: string; job?: string; sinceSeq?: string; limit?: string }) => {
      const client = await deps.discoverClientHttp(requiredString(options.client, '--client'));
      deps.write(successEnvelope(unwrapClientPayload(await client.getJobLogs(requiredString(options.job, '--job'), Number(options.sinceSeq ?? 0), Number(options.limit ?? 500)))));
    });

  // ==================== events: SSE 流式事件 ====================
  jobs.command('events')
    .requiredOption('--client <clientId>', '客户端 ID')
    .requiredOption('--job <jobId>', '任务 ID')
    .action(async (options: { client?: string; job?: string }) => {
      const client = await deps.discoverClientHttp(requiredString(options.client, '--client'));
      for await (const event of client.events(requiredString(options.job, '--job'))) {
        writeJsonLine({ ok: true, ...(event as Record<string, unknown>) });
      }
    });

  // ==================== cancel: 取消任务 ====================
  jobs.command('cancel')
    .requiredOption('--client <clientId>', '客户端 ID')
    .requiredOption('--job <jobId>', '任务 ID')
    .action(async (options: { client?: string; job?: string }) => {
      const client = await deps.discoverClientHttp(requiredString(options.client, '--client'));
      deps.write(successEnvelope(unwrapClientPayload(await client.cancelJob(requiredString(options.job, '--job')))));
    });
}
