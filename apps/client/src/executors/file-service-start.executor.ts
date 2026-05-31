import type { FileServiceStartPayload } from '@rag/shared';
import type { ClientConfig } from '../config/client.config.js';
import { startFileHttpServer } from '../runtime/file-http-server.js';

export async function executeFileServiceStart(config: ClientConfig, payload: FileServiceStartPayload): Promise<unknown> {
  return startFileHttpServer({
    workspaceDir: config.workspaceDir,
    allowedRoots: config.allowedRoots,
    port: payload.port ?? 0,
    token: payload.token,
    ttlMs: payload.ttlMs,
  });
}
