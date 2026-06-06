#!/usr/bin/env node
import { Command } from 'commander';
import { resolveConfig, maskToken } from './config/config.js';
import { ServerApi } from './http/server-api.js';
import { CliError } from './http/http-error.js';
import { errorEnvelope, exitCodeFor, successEnvelope, writeJson } from './output/json-output.js';
import { ClientHttpApi } from './http/client-http.js';
import { registerClientsCommands } from './commands/clients.js';
import { registerDoctorCommand } from './commands/doctor.js';
import { registerFilesCommands } from './commands/files.js';
import { registerFrpCommands } from './commands/frp.js';
import { registerJobsCommands } from './commands/jobs.js';
import { registerTasksCommands } from './commands/tasks.js';

const VERSION = '0.1.0';

export function buildProgram(input: { argv?: string[]; env?: Record<string, string | undefined>; cwd?: string; write?: (value: unknown) => void } = {}): Command {
  const config = resolveConfig({ argv: input.argv ?? process.argv.slice(2), env: input.env ?? process.env, cwd: input.cwd ?? process.cwd() });
  const write = input.write ?? writeJson;
  const program = new Command();
  program
    .name('rag')
    .description('Remote Agent Gateway AI-agent-first CLI')
    .version(VERSION)
    .option('--server <url>', 'RAG server URL')
    .option('--token <token>', 'RAG API token');

  program.command('config')
    .description('Configuration commands')
    .command('show')
    .description('Show resolved configuration with masked token')
    .action(() => {
      write(successEnvelope({ serverUrl: config.serverUrl || null, token: maskToken(config.token) }));
    });

  let cachedServerApi: ServerApi | undefined;
  function requireServerApi(): ServerApi {
    if (!config.serverUrl) throw new CliError('CONFIG_ERROR', 'RAG server URL is missing. Set RAG_SERVER_URL or pass --server.');
    if (!config.token) throw new CliError('CONFIG_ERROR', 'RAG token is missing. Set RAG_AGENT_TOKEN or pass --token.');
    cachedServerApi ??= new ServerApi({ serverUrl: config.serverUrl, token: config.token });
    return cachedServerApi;
  }

  const deps = {
    serverApi: {
      listClients: () => requireServerApi().listClients(),
      getClient: (clientId: string) => requireServerApi().getClient(clientId),
      discoverClientHttp: (clientId: string) => requireServerApi().discoverClientHttp(clientId),
      listTasks: (query: Record<string, string | number | undefined>) => requireServerApi().listTasks(query),
      getTaskRecord: (recordId: string) => requireServerApi().getTaskRecord(recordId),
    },
    write,
  };
  registerClientsCommands(program, deps);
  registerTasksCommands(program, deps);
  registerDoctorCommand(program, deps);

  async function discoverClientHttp(clientId: string): Promise<ClientHttpApi> {
    const discovered = await deps.serverApi.discoverClientHttp(clientId);
    return new ClientHttpApi({ baseUrl: discovered.baseUrl, token: discovered.token });
  }

  registerJobsCommands(program, { discoverClientHttp, write });
  registerFilesCommands(program, {
    discoverClientHttp,
    write,
    serverApi: {
      createUploadTransfer: (input) => requireServerApi().createUploadTransfer(input),
      getTransfer: (id) => requireServerApi().getTransfer(id),
      reportCliProgress: (id, input) => requireServerApi().reportCliProgress(id, input),
      completeCliUpload: (id) => requireServerApi().completeCliUpload(id),
      refreshUploadUrl: (id, partNumbers) => requireServerApi().refreshUploadUrl(id, partNumbers),
    },
  });
  registerFrpCommands(program, { discoverClientHttp, write });

  return program;
}

export async function run(argv = process.argv.slice(2)): Promise<void> {
  try {
    await buildProgram({ argv }).parseAsync(argv, { from: 'user' });
  } catch (error) {
    writeJson(errorEnvelope(error), process.stderr);
    process.exitCode = exitCodeFor(error);
  }
}

if (typeof require !== 'undefined' && require.main === module) {
  run().catch((error) => {
    writeJson(errorEnvelope(error), process.stderr);
    process.exitCode = exitCodeFor(error);
  });
}
