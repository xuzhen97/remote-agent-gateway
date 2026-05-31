import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { startFileHttpServer, stopFileHttpServer } from './file-http-server.js';

const token = 'tok_1234567890123456';
let workspace: string;
let baseUrl: string;

async function request(pathname: string, init?: RequestInit) {
  return fetch(`${baseUrl}${pathname}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      ...(init?.headers ?? {}),
    },
  });
}

describe('file HTTP server', () => {
  beforeEach(async () => {
    workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'rag-file-http-'));
    const server = await startFileHttpServer({ workspaceDir: workspace, port: 0, token });
    baseUrl = `http://${server.host}:${server.port}`;
  });

  afterEach(async () => {
    await stopFileHttpServer();
    fs.rmSync(workspace, { recursive: true, force: true });
  });

  it('requires bearer token', async () => {
    const response = await fetch(`${baseUrl}/v1/health`);
    expect(response.status).toBe(401);
  });

  it('creates directories, writes files, lists entries, reads files, and stats files', async () => {
    expect((await request('/v1/mkdir', {
      method: 'POST',
      body: JSON.stringify({ path: 'notes', recursive: true }),
      headers: { 'Content-Type': 'application/json' },
    })).status).toBe(200);

    expect((await request('/v1/write?path=notes/a.txt', {
      method: 'PUT',
      body: 'hello file plane',
    })).status).toBe(200);

    const listResponse = await request('/v1/list?path=notes');
    expect(listResponse.status).toBe(200);
    const listBody = await listResponse.json() as { entries: { name: string; path: string; type: string }[] };
    expect(listBody.entries).toContainEqual(expect.objectContaining({ name: 'a.txt', path: 'notes/a.txt', type: 'file' }));

    const readResponse = await request('/v1/read?path=notes/a.txt');
    expect(await readResponse.text()).toBe('hello file plane');

    const statResponse = await request('/v1/stat?path=notes/a.txt');
    const statBody = await statResponse.json() as { path: string; type: string; size: number };
    expect(statBody).toEqual(expect.objectContaining({ path: 'notes/a.txt', type: 'file', size: 16 }));
  });

  it('moves, copies, and deletes files', async () => {
    await request('/v1/mkdir', {
      method: 'POST',
      body: JSON.stringify({ path: 'notes', recursive: true }),
      headers: { 'Content-Type': 'application/json' },
    });
    await request('/v1/write?path=notes/a.txt', { method: 'PUT', body: 'abc' });

    const moveResponse = await request('/v1/move', {
      method: 'POST',
      body: JSON.stringify({ from: 'notes/a.txt', to: 'notes/b.txt', overwrite: false }),
      headers: { 'Content-Type': 'application/json' },
    });
    expect(moveResponse.status).toBe(200);

    const copyResponse = await request('/v1/copy', {
      method: 'POST',
      body: JSON.stringify({ from: 'notes/b.txt', to: 'notes/c.txt', overwrite: false }),
      headers: { 'Content-Type': 'application/json' },
    });
    expect(copyResponse.status).toBe(200);

    expect(await (await request('/v1/read?path=notes/c.txt')).text()).toBe('abc');

    const deleteResponse = await request('/v1/delete?path=notes/b.txt', { method: 'DELETE' });
    expect(deleteResponse.status).toBe(200);

    expect((await request('/v1/stat?path=notes/b.txt')).status).toBe(404);
  });

  it('rejects traversal paths', async () => {
    const response = await request('/v1/read?path=../secret.txt');
    expect(response.status).toBe(400);
  });
});
