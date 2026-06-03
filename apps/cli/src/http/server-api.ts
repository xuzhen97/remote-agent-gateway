import { CliError } from './http-error.js';

export interface ServerApiConfig {
  serverUrl: string;
  token: string;
}

export interface DiscoveredClientHttp {
  baseUrl: string;
  token: string;
  client: Record<string, unknown>;
}

export class ServerApi {
  constructor(private readonly config: ServerApiConfig) {}

  async listClients(): Promise<unknown> {
    return this.request('GET', '/api/clients');
  }

  async getClient(clientId: string): Promise<Record<string, unknown>> {
    return this.request('GET', `/api/clients/${encodeURIComponent(clientId)}`) as Promise<Record<string, unknown>>;
  }

  async discoverClientHttp(clientId: string): Promise<DiscoveredClientHttp> {
    const client = await this.getClient(clientId);
    const baseUrl = typeof client.clientHttpBaseUrl === 'string' ? client.clientHttpBaseUrl : '';
    const token = typeof client.clientHttpToken === 'string' ? client.clientHttpToken : '';
    if (!baseUrl || !token) {
      throw new CliError('CLIENT_DISCOVERY_ERROR', `Client ${clientId} is missing ready clientHttpBaseUrl/clientHttpToken`);
    }
    return { baseUrl: baseUrl.replace(/\/+$/, ''), token, client };
  }

  async listTasks(query: Record<string, string | number | undefined> = {}): Promise<unknown> {
    const search = new URLSearchParams();
    for (const [key, value] of Object.entries(query)) {
      if (value !== undefined && value !== '') search.set(key, String(value));
    }
    const suffix = search.size ? `?${search.toString()}` : '';
    return this.request('GET', `/api/tasks${suffix}`);
  }

  async getTaskRecord(recordId: string): Promise<unknown> {
    return this.request('GET', `/api/tasks/${encodeURIComponent(recordId)}`);
  }

  private async request(method: string, path: string, body?: unknown): Promise<unknown> {
    let response: Response;
    try {
      response = await fetch(`${this.config.serverUrl}${path}`, {
        method,
        headers: {
          Authorization: `Bearer ${this.config.token}`,
          ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
        },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
    } catch (error) {
      throw new CliError('NETWORK_ERROR', error instanceof Error ? error.message : String(error));
    }
    return readResponse(response);
  }
}

export async function readResponse(response: Response, mode: 'json' | 'text' | 'bytes' = 'json'): Promise<unknown> {
  if (!response.ok) {
    const text = await response.text();
    let message = text;
    try {
      const parsed = JSON.parse(text) as { error?: string; message?: string };
      message = parsed.error ?? parsed.message ?? text;
    } catch {}
    throw new CliError('HTTP_ERROR', message, response.status);
  }

  if (mode === 'text') return response.text();
  if (mode === 'bytes') return new Uint8Array(await response.arrayBuffer());

  const text = await response.text();
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch (error) {
    throw new CliError('PARSE_ERROR', error instanceof Error ? error.message : String(error));
  }
}
