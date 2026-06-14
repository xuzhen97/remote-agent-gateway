import type { ClientUpdateInput, ClientUpdatePhase, ClientUpdateResult } from './update-types.js';

export interface UpdaterDeps {
  download(input: { url: string; sha256: string; size: number }): Promise<{ filePath: string; size: number }>;
  verify(filePath: string, expectedSha256: string, expectedSize: number): Promise<void>;
  extract(filePath: string, version: string): Promise<string>;
  stopCurrent(): Promise<void>;
  switchCurrent(version: string): Promise<void>;
  startNew(): Promise<void>;
  rollback(): Promise<void>;
  onPhase?: (phase: ClientUpdatePhase, extra?: Record<string, unknown>) => void | Promise<void>;
}

export function createClientUpdater(deps: UpdaterDeps) {
  return {
    deps,

    async run(input: ClientUpdateInput): Promise<ClientUpdateResult> {
      const emit = async (phase: ClientUpdatePhase, extra?: Record<string, unknown>) => {
        await deps.onPhase?.(phase, extra);
      };

      try {
        // Phase 1: Download
        await emit('downloading');
        const downloaded = await deps.download({
          url: input.downloadUrl,
          sha256: input.expectedSha256,
          size: input.expectedSize,
        });
        await emit('downloaded', { filePath: downloaded.filePath, size: downloaded.size });

        // Phase 2: Verify
        try {
          await deps.verify(downloaded.filePath, input.expectedSha256, input.expectedSize);
        } catch (err) {
          await deps.rollback();
          const result: ClientUpdateResult = {
            phase: 'failed',
            errorCode: 'HASH_MISMATCH',
            errorMessage: err instanceof Error ? err.message : 'hash verification failed',
          };
          await emit('failed', { errorCode: result.errorCode, errorMessage: result.errorMessage });
          return result;
        }

        // Phase 3: Extract
        await emit('installing');
        const versionDir = await deps.extract(downloaded.filePath, input.version);
        await emit('installed', { versionDir });

        // Phase 4-6: Stop, switch, start
        await emit('restarting');
        await deps.stopCurrent();
        await deps.switchCurrent(input.version);
        await deps.startNew();

        await emit('verifying');
        return { phase: 'verifying' };
      } catch (err) {
        await deps.rollback();
        const result: ClientUpdateResult = {
          phase: 'failed',
          errorCode: 'INSTALL_FAILED',
          errorMessage: err instanceof Error ? err.message : String(err),
        };
        await emit('failed', { errorCode: result.errorCode, errorMessage: result.errorMessage });
        return result;
      }
    },
  };
}
