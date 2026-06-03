export interface ApiClientOptions {
  baseUrl?: string;
  getToken: () => string;
  fetchImpl?: typeof fetch;
}

export function createApiClient(options: ApiClientOptions) {
  const fetcher = options.fetchImpl ?? fetch;
  const baseUrl = options.baseUrl ?? window.location.origin;

  async function request(method: string, path: string, body?: unknown) {
    const headers: Record<string, string> = { Authorization: `Bearer ${options.getToken()}` };
    const init: RequestInit = { method, headers };
    if (body !== undefined) {
      headers['Content-Type'] = 'application/json';
      init.body = JSON.stringify(body);
    }
    const res = await fetcher(`${baseUrl}${path}`, init);
    const text = await res.text();
    const data = text ? JSON.parse(text) : null;
    if (!res.ok) {
      const msg = data?.error?.message ?? data?.error ?? `HTTP ${res.status}`;
      throw new Error(typeof msg === 'string' ? msg : JSON.stringify(msg));
    }
    return data;
  }

  return {
    get: (path: string) => request('GET', path),
    post: (path: string, body?: unknown) => request('POST', path, body),
    delete: (path: string) => request('DELETE', path),
  };
}

export type Api = ReturnType<typeof createApiClient>;
