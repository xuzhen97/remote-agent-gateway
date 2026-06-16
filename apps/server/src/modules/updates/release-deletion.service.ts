import path from 'node:path';
import {
  DeleteConsistencyFailedError,
  ReleaseNotFoundError,
} from './update-delete-errors.js';
import { assertReleaseDeletionAllowed, isActiveCampaignStatus } from './update-delete-policy.js';

export function createReleaseDeletionService(deps: {
  repo: {
    getRelease(version: string): { version: string } | undefined;
    listCampaignsByTargetVersion(version: string): Array<{ id: string; status: string }>;
    listTargetsByCampaignIds(campaignIds: string[]): Array<{ id: string }>;
    deleteAttemptsByTargetIds(targetIds: string[]): number;
    deleteTargetsByCampaignIds(campaignIds: string[]): number;
    deleteCampaignsByIds(campaignIds: string[]): number;
    deleteRelease(version: string): number;
    withTransaction<T>(fn: () => T): T;
  };
  storage: {
    releasesDir: string;
    artifactDir(version: string): string;
  };
  fileOps: {
    renameSync(from: string, to: string): void;
    rmSync(target: string, options: { recursive: true; force: true }): void;
    readdirSync(target: string): string[];
    mkdirSync(target: string, options: { recursive: true }): void;
  };
  idFactory: () => string;
}) {
  function cleanupEmptyParents(startDir: string): void {
    const boundary = path.resolve(deps.storage.releasesDir);
    let current = path.resolve(path.dirname(startDir));

    while (current.startsWith(boundary) && current !== boundary) {
      if (deps.fileOps.readdirSync(current).length > 0) break;
      deps.fileOps.rmSync(current, { recursive: true, force: true });
      current = path.dirname(current);
    }
  }

  return {
    deleteRelease(input: { version: string; force: boolean }) {
      const release = deps.repo.getRelease(input.version);
      if (!release) throw new ReleaseNotFoundError(input.version);

      const campaigns = deps.repo.listCampaignsByTargetVersion(input.version);
      const activeReferences = campaigns.filter((c) => isActiveCampaignStatus(c.status));
      const inactiveReferences = campaigns.filter((c) => !isActiveCampaignStatus(c.status));
      assertReleaseDeletionAllowed({
        activeReferences: activeReferences.length,
        inactiveReferences: inactiveReferences.length,
        force: input.force,
      });

      const campaignIds = input.force ? inactiveReferences.map((c) => c.id) : [];
      const targetIds = deps.repo.listTargetsByCampaignIds(campaignIds).map((t) => t.id);
      const artifactDir = deps.storage.artifactDir(input.version);
      const trashRoot = path.join(deps.storage.releasesDir, '.trash');
      const trashDir = path.join(trashRoot, `${deps.idFactory()}-${input.version}`);
      let artifactStashed = false;

      deps.fileOps.mkdirSync(trashRoot, { recursive: true });
      try {
        deps.fileOps.renameSync(artifactDir, trashDir);
        artifactStashed = true;
      } catch {
        artifactStashed = false;
      }

      try {
        const result = deps.repo.withTransaction(() => {
          const deletedAttemptCount = deps.repo.deleteAttemptsByTargetIds(targetIds);
          const deletedTargetCount = deps.repo.deleteTargetsByCampaignIds(campaignIds);
          const deletedCampaignCount = deps.repo.deleteCampaignsByIds(campaignIds);
          deps.repo.deleteRelease(input.version);
          return {
            version: input.version,
            force: input.force,
            deletedCampaignCount,
            deletedTargetCount,
            deletedAttemptCount,
            deletedArtifactDir: artifactStashed,
          };
        });

        if (artifactStashed) {
          deps.fileOps.rmSync(trashDir, { recursive: true, force: true });
          cleanupEmptyParents(artifactDir);
        }
        return result;
      } catch (error) {
        if (artifactStashed) {
          try {
            deps.fileOps.renameSync(trashDir, artifactDir);
          } catch (rollbackError) {
            throw new DeleteConsistencyFailedError('Failed to restore release artifacts after transaction error', {
              version: input.version,
              cause: error instanceof Error ? error.message : String(error),
              rollbackCause: rollbackError instanceof Error ? rollbackError.message : String(rollbackError),
            });
          }
        }
        throw error;
      }
    },
  };
}
