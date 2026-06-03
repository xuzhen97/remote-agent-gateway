import { env } from '../../config/env.js';
import { clientsService } from '../clients/clients.service.js';

export class ClientHttpAdminService {
  async request(clientId: string, input: { method: string; path: string; body?: unknown }): Promise<{ status: number; body: unknown }> {
    const client = clientsService.getClient(clientId);
    if (!client?.http_base_url || !client.http_token) {
      return { status: 409, body: { ok: false, error: { code: 'CLIENT_HTTP_UNAVAILABLE', message: 'Client HTTP endpoint is not ready' } } };
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), env.CLIENT_HTTP_REQUEST_TIMEOUT_MS);
    try {
      const response = await fetch(`${client.http_base_url}${input.path}`, {
        method: input.method,
        headers: {
          Authorization: `Bearer ${client.http_token}`,
          ...(input.body ? { 'Content-Type': 'application/json' } : {}),
        },
        body: input.body ? JSON.stringify(input.body) : undefined,
        signal: controller.signal,
      });
      const text = await response.text();
      let body: unknown = text;
      try { body = JSON.parse(text); } catch { body = text; }
      return { status: response.status, body };
    } catch {
      return { status: 502, body: { ok: false, error: { code: 'CLIENT_HTTP_UNREACHABLE', message: 'Failed to reach client HTTP endpoint' } } };
    } finally {
      clearTimeout(timer);
    }
  }
}

export const clientHttpAdminService = new ClientHttpAdminService();
