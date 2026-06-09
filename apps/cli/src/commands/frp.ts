/** @file FRP 命令 — 端口映射管理
 *
 * rag frp list    — 查看客户端当前映射
 * rag frp create  — 创建业务映射
 * rag frp delete  — 删除业务映射
 */
import type { Command } from 'commander';
import type { ClientHttpApi, FrpCreatePayload } from '../http/client-http.js';
import { successEnvelope } from '../output/json-output.js';
import { requiredNumber, requiredString } from '../util/args.js';

interface FrpDeps {
  discoverClientHttp(clientId: string): Promise<ClientHttpApi>;
  write(value: unknown): void;
}

export function registerFrpCommands(program: Command, deps: FrpDeps): void {
  const frp = program.command('frp').description('管理客户端的 FRP 端口映射');

  // ==================== list: 查看映射列表 ====================
  frp.command('list').requiredOption('--client <clientId>', '客户端 ID').action(async (options: { client?: string }) => {
    const client = await deps.discoverClientHttp(requiredString(options.client, '--client'));
    deps.write(successEnvelope(await client.listMappings()));
  });

  // ==================== create: 创建映射 ====================
  frp.command('create')
    .requiredOption('--client <clientId>', '客户端 ID')
    .requiredOption('--name <name>', '映射名称')
    .requiredOption('--type <type>', '代理类型: tcp, http, https')
    .option('--local-host <localHost>', '本地服务地址', '127.0.0.1')
    .requiredOption('--local-port <localPort>', '本地服务端口')
    .option('--remote-port <remotePort>', '远程端口（不指定则由服务端分配）')
    .option('--custom-domain <customDomain>', '自定义域名（HTTP/HTTPS 类型需要）')
    .action(async (options: any) => {
      const type = requiredString(options.type, '--type') as FrpCreatePayload['type'];
      const payload: FrpCreatePayload = {
        name: requiredString(options.name, '--name'),
        type,
        localHost: options.localHost ?? '127.0.0.1',
        localPort: requiredNumber(options.localPort, '--local-port'),
        remotePort: options.remotePort === undefined ? undefined : requiredNumber(options.remotePort, '--remote-port'),
        customDomain: options.customDomain,
      };
      const client = await deps.discoverClientHttp(requiredString(options.client, '--client'));
      deps.write(successEnvelope(await client.createMapping(payload)));
    });

  // ==================== delete: 删除映射 ====================
  frp.command('delete').requiredOption('--client <clientId>', '客户端 ID').requiredOption('--mapping <mappingId>', '映射 ID').action(async (options: any) => {
    const client = await deps.discoverClientHttp(requiredString(options.client, '--client'));
    deps.write(successEnvelope(await client.deleteMapping(requiredString(options.mapping, '--mapping'))));
  });
}
