import { readFile } from 'node:fs/promises';
import type { Command } from 'commander';
import type { ClientHttpApi } from '../http/client-http.js';
import { CliError } from '../http/http-error.js';
import { successEnvelope, writeJsonLine } from '../output/json-output.js';
import { optionalNumber, requiredString } from '../util/args.js';

interface JobsDeps {
  discoverClientHttp(clientId: string): Promise<ClientHttpApi>;
  write(value: unknown): void;
}

const TERMINAL_JOB_STATUSES = new Set(['success', 'failed', 'cancelled']);
const DEFAULT_WAIT_TIMEOUT_MS = 300_000;
const DEFAULT_POLL_INTERVAL_MS = 500;

function isObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function unwrapClientPayload(value: unknown): unknown {
  if (isObject(value) && value.ok === true && 'data' in value) {
    return value.data;
  }
  return value;
}

function getJobId(value: unknown): string {
  const unwrapped = unwrapClientPayload(value);
  if (!isObject(unwrapped) || typeof unwrapped.jobId !== 'string' || !unwrapped.jobId) {
    throw new CliError('PARSE_ERROR', 'Job creation response did not include jobId');
  }
  return unwrapped.jobId;
}

async function waitForJobCompletion(client: ClientHttpApi, jobId: string, timeoutMs = DEFAULT_WAIT_TIMEOUT_MS): Promise<unknown> {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    const job = unwrapClientPayload(await client.getJob(jobId));
    if (isObject(job) && typeof job.status === 'string' && TERMINAL_JOB_STATUSES.has(job.status)) {
      return job;
    }
    await new Promise((resolve) => setTimeout(resolve, DEFAULT_POLL_INTERVAL_MS));
  }
  throw new CliError('NETWORK_ERROR', `Timed out waiting for job ${jobId} to finish`);
}

async function maybeFollowJob(options: { wait?: boolean; logs?: boolean; events?: boolean }, client: ClientHttpApi, created: unknown, write: (value: unknown) => void, commandTimeoutMs?: number) {
  const jobId = getJobId(created);

  if (options.events) {
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
    write(successEnvelope(unwrapClientPayload(created)));
    return true;
  }

  // Wait slightly longer than the client-side process timeout to avoid race conditions
  const waitTimeoutMs = commandTimeoutMs ? commandTimeoutMs + 10_000 : DEFAULT_WAIT_TIMEOUT_MS;
  const job = await waitForJobCompletion(client, jobId, waitTimeoutMs);
  if (!options.logs) {
    write(successEnvelope(job));
    return true;
  }

  const logs = unwrapClientPayload(await client.getJobLogs(jobId, 0, 500));
  write(successEnvelope({ job, logs }));
  return true;
}

export function registerJobsCommands(program: Command, deps: JobsDeps): void {
  const jobs = program.command('jobs').description('Create and inspect live client HTTP jobs');

  jobs.command('run')
    .description('Run a command job on a client')
    .requiredOption('--client <clientId>', 'Client ID')
    .option('--wait', 'Wait for the job to finish')
    .option('--logs', 'Fetch logs after waiting for completion')
    .option('--events', 'Stream job events after creation')
    .option('--timeout-ms <timeoutMs>', 'Timeout in milliseconds (client-side process kill + CLI wait)')
    .allowUnknownOption(true)
    .allowExcessArguments(true)
    .argument('[cmd...]', 'Command after --')
    .action(async (cmd: string[], options: { client?: string; wait?: boolean; logs?: boolean; events?: boolean; timeoutMs?: string }) => {
      if (!cmd.length) throw new CliError('ARGUMENT_ERROR', 'Command after -- is required');
      if (options.logs && !options.wait) throw new CliError('ARGUMENT_ERROR', '--logs requires --wait');
      if (options.wait && options.events) throw new CliError('ARGUMENT_ERROR', '--wait cannot be combined with --events');
      const timeoutMs = optionalNumber(options.timeoutMs, '--timeout-ms');
      const client = await deps.discoverClientHttp(requiredString(options.client, '--client'));
      const created = await client.createCommandJob({ command: cmd[0], args: cmd.slice(1), timeoutMs });
      await maybeFollowJob(options, client, created, deps.write, timeoutMs);
    });

  jobs.command('script')
    .description('Run an inline or file-backed script job on a client')
    .requiredOption('--client <clientId>', 'Client ID')
    .option('--file <file>', 'Local script file')
    .option('--inline <script>', 'Inline script content')
    .option('--runtime <runtime>', 'node, python, bash, or powershell', 'node')
    .option('--cwd <cwd>', 'Remote working directory')
    .option('--timeout-ms <timeoutMs>', 'Timeout in milliseconds')
    .option('--wait', 'Wait for the job to finish')
    .option('--logs', 'Fetch logs after waiting for completion')
    .option('--events', 'Stream job events after creation')
    .action(async (options: { client?: string; file?: string; inline?: string; runtime?: any; cwd?: string; timeoutMs?: string; wait?: boolean; logs?: boolean; events?: boolean }) => {
      const script = options.inline ?? (options.file ? await readFile(options.file, 'utf8') : undefined);
      if (!script) throw new CliError('ARGUMENT_ERROR', '--inline or --file is required');
      if (options.logs && !options.wait) throw new CliError('ARGUMENT_ERROR', '--logs requires --wait');
      if (options.wait && options.events) throw new CliError('ARGUMENT_ERROR', '--wait cannot be combined with --events');
      const client = await deps.discoverClientHttp(requiredString(options.client, '--client'));
      const created = await client.createScriptJob({ runtime: options.runtime, script, cwd: options.cwd, timeoutMs: optionalNumber(options.timeoutMs, '--timeout-ms') });
      await maybeFollowJob(options, client, created, deps.write);
    });

  jobs.command('get')
    .requiredOption('--client <clientId>', 'Client ID')
    .requiredOption('--job <jobId>', 'Job ID')
    .action(async (options: { client?: string; job?: string }) => {
      const client = await deps.discoverClientHttp(requiredString(options.client, '--client'));
      deps.write(successEnvelope(unwrapClientPayload(await client.getJob(requiredString(options.job, '--job')))));
    });

  jobs.command('logs')
    .requiredOption('--client <clientId>', 'Client ID')
    .requiredOption('--job <jobId>', 'Job ID')
    .option('--since-seq <sinceSeq>', 'First sequence after this value', '0')
    .option('--limit <limit>', 'Maximum log entries', '500')
    .action(async (options: { client?: string; job?: string; sinceSeq?: string; limit?: string }) => {
      const client = await deps.discoverClientHttp(requiredString(options.client, '--client'));
      deps.write(successEnvelope(unwrapClientPayload(await client.getJobLogs(requiredString(options.job, '--job'), Number(options.sinceSeq ?? 0), Number(options.limit ?? 500)))));
    });

  jobs.command('events')
    .requiredOption('--client <clientId>', 'Client ID')
    .requiredOption('--job <jobId>', 'Job ID')
    .action(async (options: { client?: string; job?: string }) => {
      const client = await deps.discoverClientHttp(requiredString(options.client, '--client'));
      for await (const event of client.events(requiredString(options.job, '--job'))) {
        writeJsonLine({ ok: true, ...(event as Record<string, unknown>) });
      }
    });

  jobs.command('cancel')
    .requiredOption('--client <clientId>', 'Client ID')
    .requiredOption('--job <jobId>', 'Job ID')
    .action(async (options: { client?: string; job?: string }) => {
      const client = await deps.discoverClientHttp(requiredString(options.client, '--client'));
      deps.write(successEnvelope(unwrapClientPayload(await client.cancelJob(requiredString(options.job, '--job')))));
    });
}
