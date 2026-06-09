/** @file Clients 命令 — 客户端发现
 *
 * rag clients list   — 列出所有注册客户端
 * rag clients get    — 获取单个客户端详情（含 HTTP 端点信息）
 */
import type { Command } from 'commander';
import { successEnvelope } from '../output/json-output.js';
import { requiredString } from '../util/args.js';

interface ClientsDeps {
  serverApi: {
    listClients(): Promise<unknown>;
    getClient(clientId: string): Promise<unknown>;
  };
  write(value: unknown): void;
}

export function registerClientsCommands(program: Command, deps: ClientsDeps): void {
  const clients = program.command('clients').description('列出和查看已注册的客户端');

  clients.command('list')
    .description('列出所有客户端')
    .action(async () => {
      deps.write(successEnvelope(await deps.serverApi.listClients()));
    });

  clients.command('get')
    .description('获取单个客户端详情（客户端 HTTP 就绪时包含连接信息）')
    .requiredOption('--client <clientId>', '客户端 ID')
    .action(async (options: { client?: string }) => {
      deps.write(successEnvelope(await deps.serverApi.getClient(requiredString(options.client, '--client'))));
    });
}
