import { join } from 'node:path';

export interface ReleaseStorageLayout {
  releasesDir: string;
  releaseManifestPath(version: string): string;
  artifactDir(version: string): string;
  artifactPath(version: string, fileName: string): string;
}

export function createReleaseStorage(baseDir: string): ReleaseStorageLayout {
  return {
    releasesDir: baseDir,
    releaseManifestPath(version: string) {
      return join(baseDir, 'manifests', `${version}.json`);
    },
    artifactDir(version: string) {
      return join(baseDir, 'artifacts', version);
    },
    artifactPath(version: string, fileName: string) {
      return join(baseDir, 'artifacts', version, fileName);
    },
  };
}
