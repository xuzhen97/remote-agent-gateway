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

  it('returns CORS headers so browsers can access directly', async () => {
    const response = await request('/v1/health');
    expect(response.headers.get('access-control-allow-origin')).toBe('*');
  });

  it('handles CORS preflight OPTIONS requests', async () => {
    const response = await fetch(`${baseUrl}/v1/roots`, {
      method: 'OPTIONS',
      headers: {
        Origin: 'http://localhost:3000',
        'Access-Control-Request-Method': 'GET',
      },
    });
    expect(response.status).toBe(204);
    expect(response.headers.get('access-control-allow-origin')).toBe('*');
    expect(response.headers.get('access-control-allow-methods')).toContain('GET');
  });

  it('lists configured roots and performs file operations inside the selected root', async () => {
    const rootsResponse = await request('/v1/roots');
    expect(rootsResponse.status).toBe(200);
    const rootsBody = await rootsResponse.json() as { roots: { id: string; label: string }[] };
    const rootId = rootsBody.roots[0]?.id;
    expect(rootId).toBeTruthy();

    expect((await request('/v1/mkdir', {
      method: 'POST',
      body: JSON.stringify({ rootId, path: 'nested', recursive: true }),
      headers: { 'Content-Type': 'application/json' },
    })).status).toBe(200);

    expect((await request(`/v1/write?rootId=${rootId}&path=nested/a.txt`, {
      method: 'PUT',
      body: 'hello roots',
    })).status).toBe(200);

    const listResponse = await request(`/v1/list?rootId=${rootId}&path=nested`);
    expect(listResponse.status).toBe(200);
    const listBody = await listResponse.json() as { entries: { name: string; path: string; type: string }[] };
    expect(listBody.entries).toContainEqual(expect.objectContaining({ name: 'a.txt', path: 'nested/a.txt', type: 'file' }));
  });

  it('moves, copies, and deletes files', async () => {
    const rootsBody = await (await request('/v1/roots')).json() as { roots: { id: string }[] };
    const rootId = rootsBody.roots[0]?.id;

    await request('/v1/mkdir', {
      method: 'POST',
      body: JSON.stringify({ rootId, path: 'notes', recursive: true }),
      headers: { 'Content-Type': 'application/json' },
    });
    await request(`/v1/write?rootId=${rootId}&path=notes/a.txt`, { method: 'PUT', body: 'abc' });

    const moveResponse = await request('/v1/move', {
      method: 'POST',
      body: JSON.stringify({ rootId, from: 'notes/a.txt', to: 'notes/b.txt', overwrite: false }),
      headers: { 'Content-Type': 'application/json' },
    });
    expect(moveResponse.status).toBe(200);

    const copyResponse = await request('/v1/copy', {
      method: 'POST',
      body: JSON.stringify({ rootId, from: 'notes/b.txt', to: 'notes/c.txt', overwrite: false }),
      headers: { 'Content-Type': 'application/json' },
    });
    expect(copyResponse.status).toBe(200);

    expect(await (await request(`/v1/read?rootId=${rootId}&path=notes/c.txt`)).text()).toBe('abc');

    const deleteResponse = await request(`/v1/delete?rootId=${rootId}&path=notes/b.txt`, { method: 'DELETE' });
    expect(deleteResponse.status).toBe(200);

    expect((await request(`/v1/stat?rootId=${rootId}&path=notes/b.txt`)).status).toBe(404);
  });

  it('rejects traversal paths', async () => {
    const rootsBody = await (await request('/v1/roots')).json() as { roots: { id: string }[] };
    const rootId = rootsBody.roots[0]?.id;
    const response = await request(`/v1/read?rootId=${rootId}&path=../secret.txt`);
    expect(response.status).toBe(400);
  });
});
