/** @file HTTP 响应工具函数
 *
 * 提供了标准化的响应格式（JSON/CORS/SSE）和请求体解析。
 * 所有 API 响应统一格式：{ ok: true, data: ... } 或 { ok: false, error: { code, message } }
 */
import type { ServerResponse } from 'node:http';

/** 设置跨域头部 */
export function setCorsHeaders(res: ServerResponse): void {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type, Last-Event-ID, Accept');
}

/** 发送 JSON 响应 */
export function sendJson(res: ServerResponse, status: number, body: unknown): void {
  setCorsHeaders(res);
  const payload = Buffer.from(JSON.stringify(body));
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Content-Length': payload.length });
  res.end(payload);
}

/** 发送 200 成功响应（{ ok: true, data }） */
export function sendOk(res: ServerResponse, data: unknown): void {
  sendJson(res, 200, { ok: true, data });
}

/** 发送错误响应（{ ok: false, error: { code, message } }） */
export function sendError(res: ServerResponse, status: number, code: string, message: string): void {
  sendJson(res, status, { ok: false, error: { code, message } });
}

/** 读取请求体（二进制） */
export async function readBody(req: AsyncIterable<Buffer>): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  return Buffer.concat(chunks);
}

/** 读取并解析 JSON 请求体 */
export async function readJson<T>(req: AsyncIterable<Buffer>): Promise<T> {
  return JSON.parse((await readBody(req)).toString('utf-8')) as T;
}
