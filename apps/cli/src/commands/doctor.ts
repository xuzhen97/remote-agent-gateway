/** @file Doctor 命令 — 连通性诊断
 *
 * rag doctor              — 检查服务端连通性
 * rag doctor --client id  — 检查服务端+客户端 HTTP 连通性（含健康检查/文件根/FTP 映射）
 */
import type { Command } from 'commander';
import { ClientHttpApi } from '../http/client-http.js';
import { successEnvelope } from '../output/json-output.js';

interface DoctorDeps {
  serverApi: {
    listClients(): Promise<unknown>;
    discoverClientHttp(clientId: string): Promise<{ baseUrl: string; token: string; client: Record<string, unknown> }>;
  };
  clientHttpFactory?: (input: { baseUrl: string; token: string }) => Pick<ClientHttpApi, 'health' | 'roots' | 'listMappings'>;
  write(value: unknown): void;
}

export function registerDoctorCommand(program: Command, deps: DoctorDeps): void {
  program.command('doctor')
    .description('检查 RAG 服务端和可选客户端 HTTP 连通性')
    .option('--client <clientId>', '要检查的客户端 ID')
    .action(async (options: { client?: string }) => {
      if (!options.client) {
        // 仅检查服务端连通性
        const clients = await deps.serverApi.listClients() as unknown[];
        deps.write(successEnvelope({ server: { reachable: true }, clients: { reachable: true, count: Array.isArray(clients) ? clients.length : null } }));
        return;
      }

      // 检查服务端 + 客户端 HTTP 连通性
      const discovered = await deps.serverApi.discoverClientHttp(options.client);
      const factory = deps.clientHttpFactory ?? ((input) => new ClientHttpApi(input));
      const clientHttp = factory({ baseUrl: discovered.baseUrl, token: discovered.token });
      const [health, roots, mappings] = await Promise.all([
        clientHttp.health(),    // 客户端健康检查
        clientHttp.roots(),      // 文件根目录
        clientHttp.listMappings(), // FRP 映射列表
      ]);

      deps.write(successEnvelope({
        server: { reachable: true },
        client: discovered.client,
        clientHttp: { reachable: true, health },
        files: { rootsCount: Array.isArray((roots as any).roots) ? (roots as any).roots.length : null },
        frp: { mappingsCount: Array.isArray((mappings as any).mappings) ? (mappings as any).mappings.length : null },
      }));
    });
}
