import type { ClientFileSession } from './client-file-sessions.service.js';

export class ClientFileProxyService {
  async list(session: ClientFileSession, clientPath: string): Promise<unknown> {
    return this.requestJson(session, `/v1/list?path=${encodeURIComponent(clientPath)}`);
  }

  async stat(session: ClientFileSession, clientPath: string): Promise<unknown> {
    return this.requestJson(session, `/v1/stat?path=${encodeURIComponent(clientPath)}`);
  }

  async read(session: ClientFileSession, clientPath: string): Promise<Response> {
    return this.requestRaw(session, `/v1/read?path=${encodeURIComponent(clientPath)}`);
  }

  async download(session: ClientFileSession, clientPath: string): Promise<Response> {
    return this.requestRaw(session, `/v1/download?path=${encodeURIComponent(clientPath)}`);
  }

  async write(session: ClientFileSession, clientPath: string, body: Buffer): Promise<unknown> {
    return this.requestJson(session, `/v1/write?path=${encodeURIComponent(clientPath)}`, { method: 'PUT', body });
  }

  async upload(session: ClientFileSession, clientPath: string, filename: string, body: Buffer): Promise<unknown> {
    return this.requestJson(session, `/v1/upload?path=${encodeURIComponent(clientPath)}&filename=${encodeURIComponent(filename)}`, { method: 'POST', body });
  }

  async mkdir(session: ClientFileSession, payload: { path: string; recursive?: boolean }): Promise<unknown> {
    return this.requestJson(session, '/v1/mkdir', this.jsonInit(payload));
  }

  async delete(session: ClientFileSession, clientPath: string, recursive: boolean): Promise<unknown> {
    return this.requestJson(session, `/v1/delete?path=${encodeURIComponent(clientPath)}&recursive=${recursive ? 'true' : 'false'}`, { method: 'DELETE' });
  }

  async move(session: ClientFileSession, payload: { from: string; to: string; overwrite?: boolean }): Promise<unknown> {
    return this.requestJson(session, '/v1/move', this.jsonInit(payload));
  }

  async copy(session: ClientFileSession, payload: { from: string; to: string; overwrite?: boolean }): Promise<unknown> {
    return this.requestJson(session, '/v1/copy', this.jsonInit(payload));
  }

  private jsonInit(payload: unknown): RequestInit {
    return {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    };
  }

  private async requestJson(session: ClientFileSession, path: string, init?: RequestInit): Promise<unknown> {
    const response = await this.requestRaw(session, path, init);
    const text = await response.text();
    const body = text ? JSON.parse(text) : null;
    if (!response.ok) {
      const message = body && typeof body === 'object' && 'error' in body ? String((body as { error: unknown }).error) : response.statusText;
      throw new Error(`Client file service error ${response.status}: ${message}`);
    }
    return body;
  }

  private async requestRaw(session: ClientFileSession, path: string, init?: RequestInit): Promise<Response> {
    return fetch(`${session.publicUrl}${path}`, {
      ...init,
      headers: {
        Authorization: `Bearer ${session.token}`,
        ...(init?.headers ?? {}),
      },
    });
  }
}

export const clientFileProxyService = new ClientFileProxyService();
