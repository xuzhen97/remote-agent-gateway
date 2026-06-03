import type { ServerResponse } from 'node:http';

export function setCorsHeaders(res: ServerResponse): void {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type, Last-Event-ID, Accept');
}

export function sendJson(res: ServerResponse, status: number, body: unknown): void {
  setCorsHeaders(res);
  const payload = Buffer.from(JSON.stringify(body));
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Content-Length': payload.length });
  res.end(payload);
}

export function sendOk(res: ServerResponse, data: unknown): void {
  sendJson(res, 200, { ok: true, data });
}

export function sendError(res: ServerResponse, status: number, code: string, message: string): void {
  sendJson(res, status, { ok: false, error: { code, message } });
}

export async function readBody(req: AsyncIterable<Buffer>): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  return Buffer.concat(chunks);
}

export async function readJson<T>(req: AsyncIterable<Buffer>): Promise<T> {
  return JSON.parse((await readBody(req)).toString('utf-8')) as T;
}
