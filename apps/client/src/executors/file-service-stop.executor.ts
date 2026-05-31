import { stopFileHttpServer } from '../runtime/file-http-server.js';

export async function executeFileServiceStop(): Promise<unknown> {
  await stopFileHttpServer();
  return { stopped: true };
}
