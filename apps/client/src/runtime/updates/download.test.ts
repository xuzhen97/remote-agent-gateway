import { createServer, type Server } from 'node:http';
import { mkdtempSync, rmSync, existsSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { downloadArtifact } from './download.js';

const tempRoots: string[] = [];
const servers: Server[] = [];

function makeTempRoot(): string {
  const root = mkdtempSync(join(tmpdir(), 'rag-download-'));
  tempRoots.push(root);
  return root;
}

function listen(server: Server): Promise<number> {
  servers.push(server);
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      if (typeof address === 'object' && address) resolve(address.port);
    });
  });
}

afterEach(async () => {
  for (const server of servers.splice(0)) await new Promise<void>((resolve) => server.close(() => resolve()));
  for (const root of tempRoots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe('downloadArtifact', () => {
  it('streams an artifact into the downloads directory', async () => {
    const server = createServer((_req, res) => {
      res.writeHead(200, { 'content-length': '11' });
      res.end('hello-world');
    });
    const port = await listen(server);
    const downloadsDir = makeTempRoot();

    const result = await downloadArtifact({
      url: `http://127.0.0.1:${port}/artifact.zip`,
      downloadsDir,
      fileName: 'artifact.zip',
    });

    expect(result.size).toBe(11);
    expect(result.filePath).toBe(join(downloadsDir, 'artifact.zip'));
    expect(readFileSync(result.filePath, 'utf8')).toBe('hello-world');
    expect(existsSync(`${result.filePath}.download`)).toBe(false);
  });

  it('removes partial files when the server returns an error', async () => {
    const server = createServer((_req, res) => {
      res.writeHead(500);
      res.end('nope');
    });
    const port = await listen(server);
    const downloadsDir = makeTempRoot();

    await expect(downloadArtifact({
      url: `http://127.0.0.1:${port}/artifact.zip`,
      downloadsDir,
      fileName: 'artifact.zip',
    })).rejects.toThrow('HTTP 500');

    expect(existsSync(join(downloadsDir, 'artifact.zip'))).toBe(false);
    expect(existsSync(join(downloadsDir, 'artifact.zip.download'))).toBe(false);
  });
});
