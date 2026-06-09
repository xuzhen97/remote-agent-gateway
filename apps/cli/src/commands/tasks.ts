/** @file Tasks 命令 — 任务审计历史
 *
 * rag tasks list — 查询审计历史记录（支持多种筛选条件）
 * rag tasks get  — 获取单条审计记录详情
 */
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
  const tasks = program.command('tasks').description('查看服务端的任务审计历史');

  // ==================== list: 查询审计记录 ====================
  tasks.command('list')
    .description('查询任务审计历史记录')
    .option('--client <clientId>', '按客户端 ID 筛选')
    .option('--action <actionType>', '按操作类型筛选')
    .option('--status <status>', '按状态筛选')
    .option('--resource <resourceType>', '按资源类型筛选')
    .option('--source <sourceType>', '按来源类型筛选')
    .option('--keyword <keyword>', '关键词搜索')
    .option('--page <page>', '页码')
    .option('--page-size <pageSize>', '每页条数')
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

  // ==================== get: 查看单条记录 ====================
  tasks.command('get')
    .description('获取单条任务审计记录详情')
    .requiredOption('--record <recordId>', '记录 ID')
    .action(async (options: { record?: string }) => {
      deps.write(successEnvelope(await deps.serverApi.getTaskRecord(requiredString(options.record, '--record'))));
    });
}
