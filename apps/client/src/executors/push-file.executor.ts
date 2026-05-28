import * as path from 'node:path';
import * as fs from 'node:fs';
import type { ConnectionManager } from '../core/connection.js';
import type { ClientConfig } from '../config/client.config.js';
import type { PushFilePayload } from '@rag/shared';
import { resolveWorkspace } from '../runtime/workspace.js';

export async function executePushFile(
  conn: ConnectionManager,
  config: ClientConfig,
  taskId: string,
  payload: PushFilePayload,
): Promise<unknown> {
  const { fileId, targetPath, fileName } = payload;

  // Download file from server
  const downloadUrl = `${config.apiBaseUrl}/api/files/${fileId}/download`;

  conn.send({
    type: 'task.log',
    payload: { taskId, stream: 'stdout', content: `Downloading ${fileName} from ${downloadUrl}\n` },
  });

  const response = await fetch(downloadUrl, {
    headers: { Authorization: `Bearer ${config.token}` },
  });

  if (!response.ok) {
    throw new Error(`Failed to download file: ${response.status} ${response.statusText}`);
  }

  const buffer = Buffer.from(await response.arrayBuffer());

  // Resolve target directory within workspace
  const workspacePath = resolveWorkspace(config.workspaceDir, targetPath);
  fs.mkdirSync(workspacePath, { recursive: true });

  const filePath = path.join(workspacePath, fileName);
  fs.writeFileSync(filePath, buffer);

  conn.send({
    type: 'task.log',
    payload: { taskId, stream: 'stdout', content: `File saved to ${filePath} (${buffer.length} bytes)\n` },
  });

  return { filePath, size: buffer.length };
}
