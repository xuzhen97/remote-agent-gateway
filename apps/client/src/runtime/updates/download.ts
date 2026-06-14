import { createWriteStream, mkdirSync, renameSync, rmSync, statSync } from 'node:fs';
import { basename, join } from 'node:path';
import { pipeline } from 'node:stream/promises';
import { Readable } from 'node:stream';

export interface DownloadArtifactInput {
  url: string;
  downloadsDir: string;
  fileName?: string;
  fetchImpl?: typeof fetch;
}

export interface DownloadArtifactResult {
  filePath: string;
  size: number;
}

function safeFileName(input: string): string {
  const name = basename(input);
  if (!name || name === '.' || name === '..') throw new Error('Invalid artifact file name');
  return name;
}

export async function downloadArtifact(input: DownloadArtifactInput): Promise<DownloadArtifactResult> {
  const fetcher = input.fetchImpl ?? fetch;
  const fileName = safeFileName(input.fileName ?? new URL(input.url).pathname);
  mkdirSync(input.downloadsDir, { recursive: true });

  const filePath = join(input.downloadsDir, fileName);
  const tempPath = `${filePath}.download`;
  rmSync(tempPath, { force: true });
  rmSync(filePath, { force: true });

  const response = await fetcher(input.url);
  if (!response.ok || !response.body) {
    rmSync(tempPath, { force: true });
    throw new Error(`HTTP ${response.status}`);
  }

  try {
    const body = Readable.fromWeb(response.body as unknown as Parameters<typeof Readable.fromWeb>[0]);
    await pipeline(body, createWriteStream(tempPath));
    renameSync(tempPath, filePath);
    return { filePath, size: statSync(filePath).size };
  } catch (err) {
    rmSync(tempPath, { force: true });
    rmSync(filePath, { force: true });
    throw err;
  }
}
