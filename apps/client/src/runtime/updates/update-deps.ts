import { mkdirSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import type { ClientConfig } from '../../config/client.config.js';
import type { UpdaterDeps } from './client-updater.js';
import { downloadArtifact } from './download.js';
import { extractArtifact } from './extract.js';
import { verifyArtifact } from './verify.js';

export function resolveDeployRoot(config: ClientConfig): string {
  if (process.env.RAG_DEPLOY_ROOT) return resolve(process.env.RAG_DEPLOY_ROOT);
  if (config.source?.path) return dirname(resolve(config.source.path));
  return process.cwd();
}

function writeJson(filePath: string, value: unknown): void {
  mkdirSync(dirname(filePath), { recursive: true });
  const tmp = `${filePath}.tmp`;
  writeFileSync(tmp, `${JSON.stringify(value, null, 2)}\n`);
  rmSync(filePath, { force: true });
  renameSync(tmp, filePath);
}

export function createUpdateDeps(config: ClientConfig): UpdaterDeps {
  const deployRoot = resolveDeployRoot(config);
  const downloadsDir = join(deployRoot, 'downloads');
  const versionsDir = join(deployRoot, 'versions', 'client');
  const stateDir = join(deployRoot, 'state');

  return {
    async download(input) {
      return downloadArtifact({ url: input.url, downloadsDir });
    },
    async verify(filePath, expectedSha256, expectedSize) {
      await verifyArtifact(filePath, expectedSha256, expectedSize);
    },
    async extract(filePath, version) {
      return extractArtifact({
        archivePath: filePath,
        versionsDir,
        version,
        entrypoint: 'client.bundle.cjs',
      });
    },
    async stopCurrent() {
      // The current process remains active until launcher restart support is enabled.
    },
    async switchCurrent(version) {
      writeJson(join(stateDir, 'client-pending-version.json'), {
        version,
        entrypoint: join('versions', 'client', version, 'client.bundle.cjs'),
        updatedAt: Date.now(),
      });
    },
    async startNew() {
      // Launcher restart is implemented in a later milestone.
    },
    async rollback() {
      rmSync(join(downloadsDir), { recursive: true, force: true });
    },
  };
}
