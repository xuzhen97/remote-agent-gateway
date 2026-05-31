import { getFileHttpServerStatus } from '../runtime/file-http-server.js';

export async function executeFileServiceStatus(): Promise<unknown> {
  return getFileHttpServerStatus();
}
