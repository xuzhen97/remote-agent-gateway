import { describe, expect, it } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { EventEmitter } from 'node:events';
import { ControlHttpRouter } from './router.js';
import { registerFileRoutes } from './file-routes.js';

function makeWorkDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rag-file-routes-upload-'));
  fs.mkdirSync(path.join(dir, 'workspace'), { recursive: true });
  return dir;
}

function jsonRequest(method: string, url: string, payload: unknown) {
  const body = Buffer.from(JSON.stringify(payload));
  return {
    method,
    url,
    headers: {
      authorization: 'Bearer test-token',
      'content-type': 'application/json',
      'content-length': String(body.length),
    },
    async *[Symbol.asyncIterator]() {
      yield body;
    },
  };
}

function binaryRequest(method: string, url: string, payload: string, extraHeaders: Record<string, string> = {}) {
  const body = Buffer.from(payload, 'utf8');
  return {
    method,
    url,
    headers: {
      authorization: 'Bearer test-token',
      'content-type': 'application/octet-stream',
      'content-length': String(body.length),
      ...extraHeaders,
    },
    async *[Symbol.asyncIterator]() {
      yield body;
    },
  };
}

function createResponseCapture() {
  let statusCode = 0;
  let body = '';
  const res = new EventEmitter() as any;
  res.setHeader = () => undefined;
  res.writeHead = (code: number) => { statusCode = code; };
  res.end = (chunk?: Buffer | string) => {
    body = chunk ? String(chunk) : '';
    res.emit('finish');
  };
  return {
    res,
    get statusCode() { return statusCode; },
    get json() { return body ? JSON.parse(body) : null; },
  };
}

describe('upload routes', () => {
  it('supports init, part upload, status, complete, and abort', async () => {
    const workDir = makeWorkDir();
    const router = new ControlHttpRouter();

    registerFileRoutes(router, {
      token: 'test-token',
      workspaceDir: path.join(workDir, 'workspace'),
      allowedRoots: [path.join(workDir, 'workspace')],
      clientId: 'client-1',
    }, {
      execute: async ({ run }: any) => {
        const result = await run();
        return result.body;
      },
    } as any);

    const initRes = createResponseCapture();
    await router.handle(jsonRequest('POST', '/files/uploads/init', {
      rootId: 'root-0', path: 'drop', filename: 'demo.jar', size: 8, chunkSize: 4, fingerprint: 'fp-1',
    }) as any, initRes.res as any);
    const uploadId = initRes.json.data.uploadId as string;

    const part0 = createResponseCapture();
    await router.handle(binaryRequest('PUT', `/files/uploads/${uploadId}/parts/0?offset=0&size=4`, 'ABCD') as any, part0.res as any);

    const statusRes = createResponseCapture();
    await router.handle({ method: 'GET', url: `/files/uploads/${uploadId}/status`, headers: { authorization: 'Bearer test-token' }, async *[Symbol.asyncIterator]() {} } as any, statusRes.res as any);

    const part1 = createResponseCapture();
    await router.handle(binaryRequest('PUT', `/files/uploads/${uploadId}/parts/1?offset=4&size=4`, 'EFGH') as any, part1.res as any);

    const completeRes = createResponseCapture();
    await router.handle(jsonRequest('POST', `/files/uploads/${uploadId}/complete`, {}) as any, completeRes.res as any);

    expect(initRes.statusCode).toBe(200);
    expect(part0.json.data.uploadedBytes).toBe(4);
    expect(statusRes.json.data.uploadedParts).toEqual([0]);
    expect(completeRes.json.data.path).toBe('drop/demo.jar');
    expect(fs.readFileSync(path.join(workDir, 'workspace', 'drop', 'demo.jar'), 'utf8')).toBe('ABCDEFGH');
  });
});
