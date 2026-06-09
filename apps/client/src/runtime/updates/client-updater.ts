import type { ClientUpdateInput, ClientUpdateResult } from './update-types.js';

export interface UpdaterDeps {
  download(input: { url: string; sha256: string; size: number }): Promise<{ filePath: string; size: number }>;
  verify(filePath: string, expectedSha256: string, expectedSize: number): Promise<void>;
  extract(filePath: string, version: string): Promise<string>;
  stopCurrent(): Promise<void>;
  switchCurrent(version: string): Promise<void>;
  startNew(): Promise<void>;
  rollback(): Promise<void>;
}

export function createClientUpdater(deps: UpdaterDeps) {
  return {
    deps,

    async run(input: ClientUpdateInput): Promise<ClientUpdateResult> {
      try {
        // Phase 1: Download
        const downloaded = await deps.download({
          url: input.downloadUrl,
          sha256: input.expectedSha256,
          size: input.expectedSize,
        });

        // Phase 2: Verify
        try {
          await deps.verify(downloaded.filePath, input.expectedSha256, input.expectedSize);
        } catch (err) {
          await deps.rollback();
          return {
            phase: 'failed',
            errorCode: 'HASH_MISMATCH',
            errorMessage: err instanceof Error ? err.message : 'hash verification failed',
          };
        }

        // Phase 3: Extract
        await deps.extract(downloaded.filePath, input.version);

        // Phase 4-6: Stop, switch, start
        await deps.stopCurrent();
        await deps.switchCurrent(input.version);
        await deps.startNew();

        return { phase: 'verifying' };
      } catch (err) {
        await deps.rollback();
        return {
          phase: 'failed',
          errorCode: 'INSTALL_FAILED',
          errorMessage: err instanceof Error ? err.message : String(err),
        };
      }
    },
  };
}
