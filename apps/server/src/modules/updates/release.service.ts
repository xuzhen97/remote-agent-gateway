import { parseReleaseManifest, selectArtifact } from './release-manifest.js';
import type { ReleaseArtifact } from '@rag/shared';

export function createReleaseService(deps: {
  repo: {
    saveRelease(record: { version: string; manifestJson: string; enabled: boolean; createdAt: number; updatedAt: number }): void;
    getRelease(version: string): { version: string; manifestJson: string; enabled: boolean } | undefined;
    listReleases(): Array<{ version: string; manifestJson: string; enabled: boolean }>;
  };
  now?: () => number;
}) {
  const now = deps.now ?? Date.now;

  return {
    registerRelease(manifestJson: string): { version: string } {
      const manifest = parseReleaseManifest(manifestJson);
      deps.repo.saveRelease({
        version: manifest.version,
        manifestJson,
        enabled: true,
        createdAt: now(),
        updatedAt: now(),
      });
      return { version: manifest.version };
    },

    listReleases() {
      return deps.repo.listReleases().map((r) => ({
        version: r.version,
        enabled: r.enabled,
      }));
    },

    getRelease(version: string) {
      const record = deps.repo.getRelease(version);
      if (!record || !record.enabled) throw new Error(`Release ${version} not found or disabled`);
      return parseReleaseManifest(record.manifestJson);
    },

    resolveArtifact(
      version: string,
      match: { targetType: 'server' | 'client'; platform: 'windows' | 'linux'; arch: string },
    ): ReleaseArtifact {
      const record = deps.repo.getRelease(version);
      if (!record || !record.enabled) throw new Error(`Release ${version} not found or disabled`);
      return selectArtifact(parseReleaseManifest(record.manifestJson), match);
    },
  };
}
