import type { Command } from 'commander';
import { successEnvelope } from '../output/json-output.js';
import { optionalNumber, requiredString } from '../util/args.js';

interface TasksDeps {
  serverApi: {
    listTasks(query: Record<string, string | number | undefined>): Promise<unknown>;
    getTaskRecord(recordId: string): Promise<unknown>;
  };
  write(value: unknown): void;
}

export function registerTasksCommands(program: Command, deps: TasksDeps): void {
  const tasks = program.command('tasks').description('Inspect server-side task audit history');

  tasks.command('list')
    .description('List task audit history records')
    .option('--client <clientId>', 'Filter by client ID')
    .option('--action <actionType>', 'Filter by action type')
    .option('--status <status>', 'Filter by status')
    .option('--resource <resourceType>', 'Filter by resource type')
    .option('--source <sourceType>', 'Filter by source type')
    .option('--keyword <keyword>', 'Keyword search')
    .option('--page <page>', 'Page number')
    .option('--page-size <pageSize>', 'Page size')
    .action(async (options: Record<string, string | undefined>) => {
      deps.write(successEnvelope(await deps.serverApi.listTasks({
        clientId: options.client,
        actionType: options.action,
        status: options.status,
        resourceType: options.resource,
        sourceType: options.source,
        keyword: options.keyword,
        page: optionalNumber(options.page, '--page'),
        pageSize: optionalNumber(options.pageSize, '--page-size'),
      })));
    });

  tasks.command('get')
    .description('Get one task audit history record')
    .requiredOption('--record <recordId>', 'Record ID')
    .action(async (options: { record?: string }) => {
      deps.write(successEnvelope(await deps.serverApi.getTaskRecord(requiredString(options.record, '--record'))));
    });
}
