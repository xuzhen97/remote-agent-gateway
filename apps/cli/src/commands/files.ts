import { readFile, writeFile } from 'node:fs/promises';
import type { Command } from 'commander';
import type { ClientHttpApi } from '../http/client-http.js';
import { successEnvelope } from '../output/json-output.js';
import { requiredString } from '../util/args.js';

interface FilesDeps {
  discoverClientHttp(clientId: string): Promise<ClientHttpApi>;
  write(value: unknown): void;
  writeRaw?: (value: string | Uint8Array) => void;
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

  files.command('upload').requiredOption('--client <clientId>').requiredOption('--root <rootId>').requiredOption('--path <path>').requiredOption('--file <file>').option('--filename <filename>').action(async (options: any) => {
    const client = await deps.discoverClientHttp(requiredString(options.client, '--client'));
    const bytes = await readFile(options.file);
    const filename = options.filename ?? options.file.split(/[\\/]/).pop();
    deps.write(successEnvelope(await client.uploadFile(options.root, options.path, filename, bytes)));
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
