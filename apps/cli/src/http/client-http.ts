import type {
  ClientFileUploadAbortResult,
  ClientFileUploadCompleteResult,
  ClientFileUploadInitPayload,
  ClientFileUploadInitResult,
  ClientFileUploadPartResult,
  ClientFileUploadStatusResult,
} from '@rag/shared';
import { CliError } from './http-error.js';
import { readResponse } from './server-api.js';

export interface ClientHttpApiConfig {
  baseUrl: string;
  token: string;
}

export interface CommandJobPayload {
  command: string;
  args?: string[];
  cwd?: string;
  timeoutMs?: number;
  env?: Record<string, string>;
}

export interface ScriptJobPayload {
  runtime?: 'node' | 'python' | 'bash' | 'powershell';
  script: string;
  cwd?: string;
  timeoutMs?: number;
  env?: Record<string, string>;
}

export interface FrpCreatePayload {
  name: string;
  type: 'tcp' | 'http' | 'https';
  localHost?: string;
  localPort: number;
  remotePort?: number | null;
  customDomain?: string;
}

export class ClientHttpApi {
  constructor(private readonly config: ClientHttpApiConfig) {}

  health(): Promise<unknown> { return this.request('GET', '/health'); }
  createCommandJob(payload: CommandJobPayload): Promise<unknown> { return this.request('POST', '/jobs/command', payload); }
  createScriptJob(payload: ScriptJobPayload): Promise<unknown> { return this.request('POST', '/jobs/script', payload); }
  getJob(jobId: string): Promise<unknown> { return this.request('GET', `/jobs/${encodeURIComponent(jobId)}`); }
  getJobLogs(jobId: string, sinceSeq = 0, limit = 500): Promise<unknown> { return this.request('GET', `/jobs/${encodeURIComponent(jobId)}/logs?${new URLSearchParams({ sinceSeq: String(sinceSeq), limit: String(limit) })}`); }
  cancelJob(jobId: string): Promise<unknown> { return this.request('POST', `/jobs/${encodeURIComponent(jobId)}/cancel`, {}); }
  roots(): Promise<unknown> { return this.request('GET', '/files/roots'); }
  listFiles(rootId: string, path: string): Promise<unknown> { return this.request('GET', `/files?${this.pathQuery(rootId, path)}`); }
  statFile(rootId: string, path: string): Promise<unknown> { return this.request('GET', `/files/stat?${this.pathQuery(rootId, path)}`); }
  readFile(rootId: string, path: string): Promise<string> { return this.request('GET', `/files/read?${this.pathQuery(rootId, path)}`, undefined, 'text') as Promise<string>; }
  downloadFile(rootId: string, path: string): Promise<Uint8Array> { return this.request('GET', `/files/download?${this.pathQuery(rootId, path)}`, undefined, 'bytes') as Promise<Uint8Array>; }
  writeFile(rootId: string, path: string, body: string | Uint8Array): Promise<unknown> { return this.request('PUT', `/files/write?${this.pathQuery(rootId, path)}`, body, 'json', 'application/octet-stream'); }
  initUploadSession(payload: ClientFileUploadInitPayload): Promise<ClientFileUploadInitResult> {
    return this.request('POST', '/files/uploads/init', payload) as Promise<ClientFileUploadInitResult>;
  }
  getUploadStatus(uploadId: string): Promise<ClientFileUploadStatusResult> {
    return this.request('GET', `/files/uploads/${encodeURIComponent(uploadId)}/status`) as Promise<ClientFileUploadStatusResult>;
  }
  uploadPart(uploadId: string, partNumber: number, body: Uint8Array, options: { offset: number; size: number }): Promise<ClientFileUploadPartResult> {
    const search = new URLSearchParams({ offset: String(options.offset), size: String(options.size) });
    return this.request('PUT', `/files/uploads/${encodeURIComponent(uploadId)}/parts/${partNumber}?${search.toString()}`, body, 'json', 'application/octet-stream') as Promise<ClientFileUploadPartResult>;
  }
  completeUploadSession(uploadId: string): Promise<ClientFileUploadCompleteResult> {
    return this.request('POST', `/files/uploads/${encodeURIComponent(uploadId)}/complete`, {}) as Promise<ClientFileUploadCompleteResult>;
  }
  abortUploadSession(uploadId: string): Promise<ClientFileUploadAbortResult> {
    return this.request('DELETE', `/files/uploads/${encodeURIComponent(uploadId)}`) as Promise<ClientFileUploadAbortResult>;
  }
  mkdir(rootId: string, path: string, recursive: boolean): Promise<unknown> { return this.request('POST', '/files/mkdir', { rootId, path, recursive }); }
  deleteFile(rootId: string, path: string, recursive: boolean): Promise<unknown> { return this.request('DELETE', `/files?${this.deleteQuery(rootId, path, recursive)}`); }
  move(rootId: string, from: string, to: string, overwrite: boolean): Promise<unknown> { return this.request('POST', '/files/move', { rootId, from, to, overwrite }); }
  copy(rootId: string, from: string, to: string, overwrite: boolean): Promise<unknown> { return this.request('POST', '/files/copy', { rootId, from, to, overwrite }); }
  listMappings(): Promise<unknown> { return this.request('GET', '/frp/mappings'); }
  createMapping(payload: FrpCreatePayload): Promise<unknown> { return this.request('POST', '/frp/mappings', payload); }
  deleteMapping(mappingId: string): Promise<unknown> { return this.request('DELETE', `/frp/mappings/${encodeURIComponent(mappingId)}`); }

  async *events(jobId: string): AsyncGenerator<unknown> {
    const controller = new AbortController();
    const response = await fetch(`${this.config.baseUrl}/jobs/${encodeURIComponent(jobId)}/events`, {
      method: 'GET',
      headers: { Authorization: `Bearer ${this.config.token}` },
      signal: controller.signal,
    });
    if (!response.ok) await readResponse(response);
    const reader = response.body?.getReader();
    if (!reader) throw new CliError('PARSE_ERROR', 'SSE response has no readable body');
    const decoder = new TextDecoder();
    let buffer = '';
    try {
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        let index;
        while ((index = buffer.indexOf('\n\n')) >= 0) {
          const frame = buffer.slice(0, index);
          buffer = buffer.slice(index + 2);
          const parsed = parseSseFrame(frame);
          if (parsed) yield parsed;
        }
      }
    } finally {
      controller.abort();
      try { await reader.cancel(); } catch {}
    }
  }

  private pathQuery(rootId: string, path: string): string {
    return new URLSearchParams({ rootId, path }).toString();
  }

  private deleteQuery(rootId: string, path: string, recursive: boolean): string {
    return new URLSearchParams({ rootId, path, recursive: String(recursive) }).toString();
  }

  private async request(method: string, path: string, body?: unknown, mode: 'json' | 'text' | 'bytes' = 'json', contentType = 'application/json'): Promise<unknown> {
    let response: Response;
    try {
      response = await fetch(`${this.config.baseUrl}${path}`, {
        method,
        headers: {
          Authorization: `Bearer ${this.config.token}`,
          ...(body === undefined ? {} : { 'Content-Type': contentType }),
        },
        body: body === undefined ? undefined : contentType === 'application/json' ? JSON.stringify(body) : body as BodyInit,
      });
    } catch (error) {
      throw new CliError('NETWORK_ERROR', error instanceof Error ? error.message : String(error));
    }
    return readResponse(response, mode);
  }
}

function parseSseFrame(frame: string): unknown | null {
  let event = 'message';
  let data = '';
  for (const line of frame.split(/\r?\n/)) {
    if (line.startsWith('event:')) event = line.slice('event:'.length).trim();
    if (line.startsWith('data:')) data += line.slice('data:'.length).trim();
  }
  if (!data) return null;
  try {
    return { event, data: JSON.parse(data) };
  } catch {
    return { event, data };
  }
}
