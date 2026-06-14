import { existsSync, mkdirSync, renameSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

export interface ExtractArtifactInput {
  archivePath: string;
  versionsDir: string;
  version: string;
  entrypoint: string;
  extractArchive?: (archivePath: string, stagingDir: string) => Promise<void>;
}

function assertSafeRelativePath(value: string, label: string): void {
  if (!value || value.includes('..') || value.startsWith('/') || /^[a-zA-Z]:/.test(value)) {
    throw new Error(`Invalid ${label}: ${value}`);
  }
}

async function defaultExtractArchive(archivePath: string, stagingDir: string): Promise<void> {
  if (archivePath.toLowerCase().endsWith('.zip')) {
    const result = spawnSync('powershell', [
      '-NoProfile',
      '-Command',
      `Expand-Archive -Path "${archivePath}" -DestinationPath "${stagingDir}" -Force`,
    ], { stdio: 'inherit' });
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

export async function extractArtifact(input: ExtractArtifactInput): Promise<string> {
  assertSafeRelativePath(input.version, 'version');
  assertSafeRelativePath(input.entrypoint, 'entrypoint');

  mkdirSync(input.versionsDir, { recursive: true });
  const stagingDir = join(input.versionsDir, `${input.version}.staging`);
  const versionDir = join(input.versionsDir, input.version);

  rmSync(stagingDir, { recursive: true, force: true });
  rmSync(versionDir, { recursive: true, force: true });
  mkdirSync(stagingDir, { recursive: true });

  try {
    await (input.extractArchive ?? defaultExtractArchive)(input.archivePath, stagingDir);
    const entrypointPath = join(stagingDir, input.entrypoint);
    if (!existsSync(entrypointPath)) {
      throw new Error(`entrypoint not found: ${input.entrypoint}`);
    }
    renameSync(stagingDir, versionDir);
    return versionDir;
  } catch (err) {
    rmSync(stagingDir, { recursive: true, force: true });
    rmSync(versionDir, { recursive: true, force: true });
    throw err;
  }
}
