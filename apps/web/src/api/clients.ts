import type { Api } from './http';

export interface ClientSummary {
  id: string;
  name: string;
  version?: string;
  online: boolean;
  status: string;
  httpReady: boolean;
  clientHttpBaseUrl?: string;
  clientHttpRemotePort?: number;
  capabilities?: Record<string, boolean>;
  lastSeenAt?: number;
}

export interface ClientDetail extends ClientSummary {
  clientHttpToken?: string;
}

export function listClients(api: Api): Promise<ClientSummary[]> {
  return api.get('/api/clients');
}

export function getClient(api: Api, clientId: string): Promise<ClientDetail> {
  return api.get(`/api/clients/${encodeURIComponent(clientId)}`);
}
