import { writeFile, stat } from 'node:fs/promises';
import type { Command } from 'commander';
import type { ClientHttpApi } from '../http/client-http.js';
import { uploadFileWithProgress } from '../http/upload-transfer.js';
import { uploadFileToAliyunDrive, type AliyunUploadPlan } from '../http/aliyundrive-upload.js';
import { successEnvelope } from '../output/json-output.js';
import { requiredString } from '../util/args.js';

export interface FilesDeps {
  discoverClientHttp(clientId: string): Promise<ClientHttpApi>;
  write(value: unknown): void;
  writeRaw?: (value: string | Uint8Array) => void;
  serverApi?: {
    createUploadTransfer(input: Record<string, unknown>): Promise<unknown>;
    getTransfer(transferId: string): Promise<unknown>;
    reportCliProgress(transferId: string, input: Record<string, unknown>): Promise<unknown>;
    completeCliUpload(transferId: string): Promise<unknown>;
    refreshUploadUrl(transferId: string, partNumbers: number[]): Promise<unknown>;
  };
}

function rawWriter(value: string | Uint8Array): void {
  process.stdout.write(value);
  if (typeof value === 'string' && !value.endsWith('\n')) process.stdout.write('\n');
}

export function registerFilesCommands(program: Command, deps: FilesDeps): void {
  const files = program.command('files').description('Operate client files through client HTTP');
  const writeRaw = deps.writeRaw ?? rawWriter;

  files.command('roots').requiredOption('--client <clientId>').action(async (options: { client?: string }) => {
    const client = await deps.discoverClientHttp(requiredString(options.client, '--client'));
    deps.write(successEnvelope(await client.roots()));
  });

  files.command('list').requiredOption('--client <clientId>').requiredOption('--root <rootId>').requiredOption('--path <path>').action(async (options: any) => {
    const client = await deps.discoverClientHttp(requiredString(options.client, '--client'));
    deps.write(successEnvelope(await client.listFiles(options.root, options.path)));
  });

  files.command('stat').requiredOption('--client <clientId>').requiredOption('--root <rootId>').requiredOption('--path <path>').action(async (options: any) => {
    const client = await deps.discoverClientHttp(requiredString(options.client, '--client'));
    deps.write(successEnvelope(await client.statFile(options.root, options.path)));
  });

  files.command('read').requiredOption('--client <clientId>').requiredOption('--root <rootId>').requiredOption('--path <path>').option('--raw').action(async (options: any) => {
    const client = await deps.discoverClientHttp(requiredString(options.client, '--client'));
    const content = await client.readFile(options.root, options.path);
    if (options.raw) writeRaw(content);
    else deps.write(successEnvelope({ rootId: options.root, path: options.path, content }));
  });

  files.command('write').requiredOption('--client <clientId>').requiredOption('--root <rootId>').requiredOption('--path <path>').option('--content <content>').option('--stdin').action(async (options: any) => {
    const client = await deps.discoverClientHttp(requiredString(options.client, '--client'));
    const content = options.stdin ? await readStdinText() : requiredString(options.content, '--content or --stdin');
    deps.write(successEnvelope(await client.writeFile(options.root, options.path, content)));
  });

  files.command('upload')
    .requiredOption('--client <clientId>')
    .requiredOption('--root <rootId>')
    .requiredOption('--path <path>')
    .requiredOption('--file <file>')
    .option('--filename <filename>')
    .option('--transfer <mode>', 'auto | aliyundrive | direct', 'auto')
    .action(async (options: any) => {
      const filename = options.filename ?? options.file.split(/[\\/]/).pop();
      const transferMode: 'auto' | 'aliyundrive' | 'direct' = options.transfer;

      // If server API is available, try aliyundrive path first
      if (deps.serverApi && transferMode !== 'direct') {
        const result = await deps.serverApi.createUploadTransfer({
          clientId: requiredString(options.client, '--client'),
          rootId: options.root,
          path: options.path,
          filename,
          size: (await stat(options.file)).size,
          transfer: transferMode,
        });

        if ((result as any).mode === 'aliyundrive') {
          const plan = result as AliyunUploadPlan;
          process.stderr.write(`[1/5] 创建传输任务 ${plan.transferId}\n`);
          await uploadFileToAliyunDrive({
            filePath: options.file,
            plan,
            serverApi: deps.serverApi,
            onProgress: (progress) => {
              const percent = ((progress.uploadedBytes / progress.totalBytes) * 100).toFixed(1);
              process.stderr.write(`\r[2/5] 上传到阿里云盘 ${percent}% | part ${progress.partNumber}/${progress.partCount} | ETA ${Math.ceil((progress.totalBytes - progress.uploadedBytes) / Math.max(progress.rateBytesPerSecond, 1))}s`);
              if (progress.uploadedBytes === progress.totalBytes) process.stderr.write('\n');
            },
          });
          process.stderr.write(`[3/5] 阿里云盘合并完成\n`);
          process.stderr.write(`[4/5] 等待 client 下载...\n`);

          // Poll until transfer completes or fails
          for (let i = 0; i < 600; i += 1) {
            const job = await deps.serverApi.getTransfer(plan.transferId) as any;
            if (job.status === 'completed') {
              process.stderr.write(`[5/5] 写入完成 root=${job.rootId} path=${job.targetDir}/${job.filename} size=${job.size}\n`);
              deps.write(successEnvelope({
                transferId: plan.transferId,
                mode: 'aliyundrive',
                clientId: options.client,
                rootId: options.root,
                path: options.path,
                filename,
                size: job.size,
                status: 'completed',
              }));
              return;
            }
            if (job.status === 'failed') {
              throw new Error(`Transfer failed: ${job.errorMessage ?? 'unknown error'}`);
            }
            if (job.phase === 'client_downloading') {
              const pct = job.totalBytes > 0 ? ((job.downloadedBytes / job.totalBytes) * 100).toFixed(1) : '0';
              process.stderr.write(`\r[4/5] Client 下载 ${pct}%`);
            }
            await new Promise((r) => setTimeout(r, 2000));
          }
          throw new Error('Transfer timed out after 20 minutes');
        }
      }

      // Fallback: direct chunked upload through frps/frpc
      const client = await deps.discoverClientHttp(requiredString(options.client, '--client'));
      const result = await uploadFileWithProgress(client, {
        rootId: options.root,
        path: options.path,
        filePath: options.file,
        filename,
        onProgress: (progress) => {
          const percent = ((progress.uploadedBytes / progress.totalBytes) * 100).toFixed(1);
          const kbPerSecond = (progress.rateBytesPerSecond / 1024).toFixed(1);
          const remainingBytes = progress.totalBytes - progress.uploadedBytes;
          const etaSeconds = progress.rateBytesPerSecond <= 0 ? 0 : Math.ceil(remainingBytes / progress.rateBytesPerSecond);
          process.stderr.write(
            `\rUploading ${progress.filename} ${percent}% (${progress.uploadedBytes}/${progress.totalBytes}) | ${kbPerSecond} KB/s | ETA ${etaSeconds}s | chunk ${progress.partNumber + 1}/${progress.partCount}`,
          );
          if (progress.uploadedBytes === progress.totalBytes) process.stderr.write('\n');
        },
      });
      deps.write(successEnvelope(result));
    });

  files.command('download').requiredOption('--client <clientId>').requiredOption('--root <rootId>').requiredOption('--path <path>').requiredOption('--output <output>').action(async (options: any) => {
    const client = await deps.discoverClientHttp(requiredString(options.client, '--client'));
    const bytes = await client.downloadFile(options.root, options.path);
    await writeFile(options.output, bytes);
    deps.write(successEnvelope({ rootId: options.root, path: options.path, output: options.output, size: bytes.length }));
  });

  files.command('mkdir').requiredOption('--client <clientId>').requiredOption('--root <rootId>').requiredOption('--path <path>').option('--recursive').action(async (options: any) => {
    const client = await deps.discoverClientHttp(requiredString(options.client, '--client'));
    deps.write(successEnvelope(await client.mkdir(options.root, options.path, options.recursive !== false)));
  });

  files.command('delete').requiredOption('--client <clientId>').requiredOption('--root <rootId>').requiredOption('--path <path>').option('--recursive').action(async (options: any) => {
    const client = await deps.discoverClientHttp(requiredString(options.client, '--client'));
    deps.write(successEnvelope(await client.deleteFile(options.root, options.path, options.recursive === true)));
  });

  files.command('move').requiredOption('--client <clientId>').requiredOption('--root <rootId>').requiredOption('--from <from>').requiredOption('--to <to>').option('--overwrite').action(async (options: any) => {
    const client = await deps.discoverClientHttp(requiredString(options.client, '--client'));
    deps.write(successEnvelope(await client.move(options.root, options.from, options.to, options.overwrite === true)));
  });

  files.command('copy').requiredOption('--client <clientId>').requiredOption('--root <rootId>').requiredOption('--from <from>').requiredOption('--to <to>').option('--overwrite').action(async (options: any) => {
    const client = await deps.discoverClientHttp(requiredString(options.client, '--client'));
    deps.write(successEnvelope(await client.copy(options.root, options.from, options.to, options.overwrite === true)));
  });
}

async function readStdinText(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  return Buffer.concat(chunks).toString('utf8');
}
