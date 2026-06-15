import { createHash } from 'node:crypto';
import { createReadStream, createWriteStream, existsSync, mkdirSync, renameSync, rmSync, statSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { spawnSync } from 'node:child_process';
import {
  writePendingServerUpdateContext,
  writePendingServerVersion,
} from './server-version-state.js';

export interface ServerUpdaterInput {
  campaignId: string;
  targetId: string;
  attemptId: string;
  version: string;
  downloadUrl: string;
  expectedSha256: string;
  expectedSize: number;
}

export interface ServerUpdater {
  run(input: ServerUpdaterInput): Promise<void>;
}

export interface ServerUpdaterDeps {
  deployRoot: string;
  currentVersion: string;
  saveDb?: () => void;
  restart?: () => void;
  fetchImpl?: typeof fetch;
  extractArtifact?: (archivePath: string, versionsDir: string, version: string) => string;
}

export const SERVER_EXIT_UPDATE_RESTART = 20;

function normalizeVersion(version: string): string {
  return version.trim().replace(/^v/i, '');
}

function safeFileName(input: string): string {
  const name = basename(input);
  if (!name || name === '.' || name === '..') throw new Error('Invalid artifact file name');
  return name;
}

async function downloadArtifact(input: { url: string; downloadsDir: string; fetchImpl?: typeof fetch }): Promise<string> {
  const fetcher = input.fetchImpl ?? fetch;
  const fileName = safeFileName(new URL(input.url).pathname);
  mkdirSync(input.downloadsDir, { recursive: true });
  const filePath = join(input.downloadsDir, fileName);
  const tempPath = `${filePath}.download`;
  rmSync(tempPath, { force: true });
  rmSync(filePath, { force: true });

  const response = await fetcher(input.url);
  if (!response.ok || !response.body) throw new Error(`HTTP ${response.status}`);
  try {
    await pipeline(Readable.fromWeb(response.body as unknown as Parameters<typeof Readable.fromWeb>[0]), createWriteStream(tempPath));
    renameSync(tempPath, filePath);
    return filePath;
  } catch (err) {
    rmSync(tempPath, { force: true });
    rmSync(filePath, { force: true });
    throw err;
  }
}

async function sha256(filePath: string): Promise<string> {
  const hash = createHash('sha256');
  await new Promise<void>((resolve, reject) => {
    const stream = createReadStream(filePath);
    stream.on('data', (chunk) => hash.update(chunk));
    stream.on('error', reject);
    stream.on('end', resolve);
  });
  return hash.digest('hex');
}

async function verifyArtifact(filePath: string, expectedSha256: string, expectedSize: number): Promise<void> {
  const actualSize = statSync(filePath).size;
  if (actualSize !== expectedSize) throw new Error(`size mismatch: expected ${expectedSize}, got ${actualSize}`);
  const actualSha256 = await sha256(filePath);
  if (actualSha256.toLowerCase() !== expectedSha256.toLowerCase()) {
    throw new Error(`sha256 mismatch: expected ${expectedSha256}, got ${actualSha256}`);
  }
}

function extractArchive(archivePath: string, stagingDir: string): void {
  if (archivePath.toLowerCase().endsWith('.zip')) {
    const result = spawnSync('powershell', ['-NoProfile', '-Command', `Expand-Archive -Path "${archivePath}" -DestinationPath "${stagingDir}" -Force`], { stdio: 'inherit' });
    if (result.status !== 0) throw new Error(`Failed to extract zip: ${archivePath}`);
    return;
  }
  if (archivePath.toLowerCase().endsWith('.tar.gz') || archivePath.toLowerCase().endsWith('.tgz')) {
    const result = spawnSync('tar', ['-xzf', archivePath, '-C', stagingDir], { stdio: 'inherit' });
    if (result.status !== 0) throw new Error(`Failed to extract tar.gz: ${archivePath}`);
    return;
  }
  throw new Error(`Unsupported archive type: ${archivePath}`);
}

function extractServerArtifact(archivePath: string, versionsDir: string, version: string): string {
  const stagingDir = join(versionsDir, `${version}.staging`);
  const versionDir = join(versionsDir, version);
  rmSync(stagingDir, { recursive: true, force: true });
  rmSync(versionDir, { recursive: true, force: true });
  mkdirSync(stagingDir, { recursive: true });
  try {
    extractArchive(archivePath, stagingDir);
    if (!existsSync(join(stagingDir, 'server.bundle.cjs'))) throw new Error('entrypoint not found: server.bundle.cjs');
    renameSync(stagingDir, versionDir);
    return versionDir;
  } catch (err) {
    rmSync(stagingDir, { recursive: true, force: true });
    rmSync(versionDir, { recursive: true, force: true });
    throw err;
  }
}

export function createServerUpdater(deps: ServerUpdaterDeps): ServerUpdater {
  return {
    async run(input: ServerUpdaterInput): Promise<void> {
      const normalizedVersion = normalizeVersion(input.version);
      const downloadsDir = join(deps.deployRoot, 'downloads');
      const versionsDir = join(deps.deployRoot, 'versions', 'server');
      const artifactPath = await downloadArtifact({ url: input.downloadUrl, downloadsDir, fetchImpl: deps.fetchImpl });
      await verifyArtifact(artifactPath, input.expectedSha256, input.expectedSize);
      (deps.extractArtifact ?? extractServerArtifact)(artifactPath, versionsDir, normalizedVersion);
      writePendingServerVersion(deps.deployRoot, {
        version: normalizedVersion,
        entrypoint: join('versions', 'server', normalizedVersion, 'server.bundle.cjs'),
      });
      writePendingServerUpdateContext(deps.deployRoot, {
        campaignId: input.campaignId,
        targetId: input.targetId,
        attemptId: input.attemptId,
        fromVersion: normalizeVersion(deps.currentVersion),
        targetVersion: normalizedVersion,
      });
      deps.saveDb?.();
      (deps.restart ?? (() => setTimeout(() => process.exit(SERVER_EXIT_UPDATE_RESTART), 100)))();
    },
  };
}

export function createNoopServerUpdater(): ServerUpdater {
  return {
    async run(input: ServerUpdaterInput) {
      await createServerUpdater({ deployRoot: process.env.RAG_DEPLOY_ROOT ?? process.cwd(), currentVersion: '0.0.0' }).run(input);
    },
  };
}
