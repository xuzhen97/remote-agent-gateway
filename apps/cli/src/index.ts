/** @file CLI 入口
 *
 * 使用 commander.js 构建命令行界面。
 * 所有外部依赖通过依赖注入（Deps）传递，便于测试。
 *
 * 命令结构：
 *   rag config show     查看配置
 *   rag doctor          诊断连通性
 *   rag clients list|get   客户端发现
 *   rag tasks list|get     审计历史
 *   rag jobs run|script|get|logs|events|cancel   命令/脚本执行
 *   rag files roots|list|read|write|upload|...   文件管理
 *   rag frp list|create|delete   端口映射管理
 */
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
import { registerUpdatesCommands } from './commands/updates.js';

const VERSION = '0.1.0';

/**
 * 构建 CLI 程序（依赖注入模式）
 * @param input - 可注入的依赖，便于测试
 */
export function buildProgram(input: { argv?: string[]; env?: Record<string, string | undefined>; cwd?: string; write?: (value: unknown) => void } = {}): Command {
  // 解析配置（优先级：CLI 参数 > 环境变量）
  const config = resolveConfig({ argv: input.argv ?? process.argv.slice(2), env: input.env ?? process.env, cwd: input.cwd ?? process.cwd() });
  const write = input.write ?? writeJson;
  const program = new Command();
  program
    .name('rag')
    .description('Remote Agent Gateway 面向 AI Agent 的远程控制 CLI')
    .version(VERSION)
    .option('--server <url>', 'RAG 服务端 URL')
    .option('--token <token>', 'RAG API Token');

  // ==================== config 命令 ====================
  program.command('config')
    .description('配置管理命令')
    .command('show')
    .description('显示当前配置（Token 脱敏）')
    .action(() => {
      write(successEnvelope({ serverUrl: config.serverUrl || null, token: maskToken(config.token) }));
    });

  // ==================== ServerApi 懒加载 ====================
  let cachedServerApi: ServerApi | undefined;
  function requireServerApi(): ServerApi {
    if (!config.serverUrl) throw new CliError('CONFIG_ERROR', '缺少 RAG 服务端 URL。请设置 RAG_SERVER_URL 或 --server 参数。');
    if (!config.token) throw new CliError('CONFIG_ERROR', '缺少 RAG Token。请设置 RAG_AGENT_TOKEN 或 --token 参数。');
    cachedServerApi ??= new ServerApi({ serverUrl: config.serverUrl, token: config.token });
    return cachedServerApi;
  }

  // 注册服务端 API 相关命令的依赖
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

  /** 发现客户端 HTTP 端点（用于直接调用 client HTTP API） */
  async function discoverClientHttp(clientId: string): Promise<ClientHttpApi> {
    const discovered = await deps.serverApi.discoverClientHttp(clientId);
    return new ClientHttpApi({ baseUrl: discovered.baseUrl, token: discovered.token });
  }

  // 注册客户端操作命令（需要发现 client HTTP）
  registerJobsCommands(program, {
    discoverClientHttp,
    proxyJob: (clientId, payload) => requireServerApi().proxyJob(clientId, payload),
    write,
  });
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
  registerUpdatesCommands(program, {
    serverApi: {
      listUpdateReleases: () => requireServerApi().listUpdateReleases(),
      createUpdateCampaign: (input) => requireServerApi().createUpdateCampaign(input),
      getUpdateCampaign: (id) => requireServerApi().getUpdateCampaign(id),
      retryUpdateCampaign: (id, input) => requireServerApi().retryUpdateCampaign(id, input),
    },
    write,
  });

  return program;
}

/** CLI 运行入口 */
export async function run(argv = process.argv.slice(2)): Promise<void> {
  try {
    await buildProgram({ argv }).parseAsync(argv, { from: 'user' });
  } catch (error) {
    writeJson(errorEnvelope(error), process.stderr);
    process.exitCode = exitCodeFor(error);
  }
}

// 直接执行时运行
if (typeof require !== 'undefined' && require.main === module) {
  run().catch((error) => {
    writeJson(errorEnvelope(error), process.stderr);
    process.exitCode = exitCodeFor(error);
  });
}
