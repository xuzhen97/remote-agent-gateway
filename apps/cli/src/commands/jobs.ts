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

export function registerJobsCommands(program: Command, deps: JobsDeps): void {
  const jobs = program.command('jobs').description('Create and inspect live client HTTP jobs');

  jobs.command('run')
    .description('Run a command job on a client')
    .requiredOption('--client <clientId>', 'Client ID')
    .allowUnknownOption(true)
    .allowExcessArguments(true)
    .argument('[cmd...]', 'Command after --')
    .action(async (cmd: string[], options: { client?: string }) => {
      if (!cmd.length) throw new CliError('ARGUMENT_ERROR', 'Command after -- is required');
      const client = await deps.discoverClientHttp(requiredString(options.client, '--client'));
      deps.write(successEnvelope(await client.createCommandJob({ command: cmd[0], args: cmd.slice(1) })));
    });

  jobs.command('script')
    .description('Run an inline or file-backed script job on a client')
    .requiredOption('--client <clientId>', 'Client ID')
    .option('--file <file>', 'Local script file')
    .option('--inline <script>', 'Inline script content')
    .option('--runtime <runtime>', 'node, python, bash, or powershell', 'node')
    .option('--cwd <cwd>', 'Remote working directory')
    .option('--timeout-ms <timeoutMs>', 'Timeout in milliseconds')
    .action(async (options: { client?: string; file?: string; inline?: string; runtime?: any; cwd?: string; timeoutMs?: string }) => {
      const script = options.inline ?? (options.file ? await readFile(options.file, 'utf8') : undefined);
      if (!script) throw new CliError('ARGUMENT_ERROR', '--inline or --file is required');
      const client = await deps.discoverClientHttp(requiredString(options.client, '--client'));
      deps.write(successEnvelope(await client.createScriptJob({ runtime: options.runtime, script, cwd: options.cwd, timeoutMs: optionalNumber(options.timeoutMs, '--timeout-ms') })));
    });

  jobs.command('get')
    .requiredOption('--client <clientId>', 'Client ID')
    .requiredOption('--job <jobId>', 'Job ID')
    .action(async (options: { client?: string; job?: string }) => {
      const client = await deps.discoverClientHttp(requiredString(options.client, '--client'));
      deps.write(successEnvelope(await client.getJob(requiredString(options.job, '--job'))));
    });

  jobs.command('logs')
    .requiredOption('--client <clientId>', 'Client ID')
    .requiredOption('--job <jobId>', 'Job ID')
    .option('--since-seq <sinceSeq>', 'First sequence after this value', '0')
    .option('--limit <limit>', 'Maximum log entries', '500')
    .action(async (options: { client?: string; job?: string; sinceSeq?: string; limit?: string }) => {
      const client = await deps.discoverClientHttp(requiredString(options.client, '--client'));
      deps.write(successEnvelope(await client.getJobLogs(requiredString(options.job, '--job'), Number(options.sinceSeq ?? 0), Number(options.limit ?? 500))));
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
      deps.write(successEnvelope(await client.cancelJob(requiredString(options.job, '--job'))));
    });
}
