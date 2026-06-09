import { join } from 'node:path';

export interface VersionLayout {
  baseDir: string;
  versionsDir: string;
  versionDir: string;
  downloadsDir: string;
  stateDir: string;
  currentVersionFile: string;
  updaterStateFile: string;
}

export function resolveVersionLayout(baseDir: string, version: string): VersionLayout {
  const versionsDir = join(baseDir, 'versions');
  return {
    baseDir,
    versionsDir,
    versionDir: join(versionsDir, version),
    downloadsDir: join(baseDir, 'downloads'),
    stateDir: join(baseDir, 'state'),
    currentVersionFile: join(baseDir, 'state', 'current-version.json'),
    updaterStateFile: join(baseDir, 'state', 'updater-state.json'),
  };
}
