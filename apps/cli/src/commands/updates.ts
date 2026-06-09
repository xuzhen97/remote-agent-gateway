import type { Command } from 'commander';
import { successEnvelope } from '../output/json-output.js';
import { requiredString } from '../util/args.js';

interface UpdatesDeps {
  serverApi: {
    listUpdateReleases(): Promise<unknown>;
    createUpdateCampaign(input: Record<string, unknown>): Promise<unknown>;
    getUpdateCampaign(id: string): Promise<unknown>;
    retryUpdateCampaign(id: string, input: Record<string, unknown>): Promise<unknown>;
  };
  write(value: unknown): void;
}

export function registerUpdatesCommands(program: Command, deps: UpdatesDeps): void {
  const updates = program.command('updates').description('一键更新管理');

  const releases = updates.command('releases').description('版本管理');
  releases.command('list')
    .description('列出所有可用版本')
    .action(async () => {
      const data = await deps.serverApi.listUpdateReleases();
      deps.write(successEnvelope(data));
    });

  const campaigns = updates.command('campaigns').description('更新编排管理');
  campaigns.command('start')
    .description('创建一次更新编排')
    .requiredOption('--version <version>', '目标版本')
    .option('--all-clients', '更新所有客户端')
    .option('--batch-size <size>', '批次大小', '10')
    .option('--concurrency <n>', '批次并发数', '5')
    .action(async (options: { version: string; allClients?: boolean; batchSize?: string; concurrency?: string }) => {
      const data = await deps.serverApi.createUpdateCampaign({
        targetVersion: requiredString(options.version, '--version'),
        includeServer: true,
        batchSize: Number(options.batchSize ?? 10),
        maxConcurrency: Number(options.concurrency ?? 5),
        scope: { all: Boolean(options.allClients) },
        createdBy: 'cli',
      });
      deps.write(successEnvelope(data));
    });

  campaigns.command('get')
    .description('查询更新编排状态')
    .requiredOption('--campaign <campaignId>', '编排 ID')
    .action(async (options: { campaign: string }) => {
      const data = await deps.serverApi.getUpdateCampaign(requiredString(options.campaign, '--campaign'));
      deps.write(successEnvelope(data));
    });

  campaigns.command('retry')
    .description('重试失败的更新对象')
    .requiredOption('--campaign <campaignId>', '编排 ID')
    .option('--failed', '重试失败项')
    .option('--offline-skipped', '重试离线跳过项')
    .option('--all', '重试所有未成功项')
    .action(async (options: { campaign: string; failed?: boolean; offlineSkipped?: boolean; all?: boolean }) => {
      const mode = options.all ? 'all' : options.offlineSkipped ? 'offline_skipped' : 'failed';
      const data = await deps.serverApi.retryUpdateCampaign(
        requiredString(options.campaign, '--campaign'),
        { mode },
      );
      deps.write(successEnvelope(data));
    });
}
