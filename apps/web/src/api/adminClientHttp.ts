import type { Api } from './http';

export function healthClientHttp(api: Api, clientId: string) {
  return api.get(`/api/clients/${encodeURIComponent(clientId)}/http/health`);
}

export function listClientMappings(api: Api, clientId: string) {
  return api.get(`/api/clients/${encodeURIComponent(clientId)}/http/frp/mappings`);
}

export function createClientMapping(api: Api, clientId: string, input: Record<string, unknown>) {
  return api.post(`/api/clients/${encodeURIComponent(clientId)}/http/frp/mappings`, input);
}

export function deleteClientMapping(api: Api, clientId: string, mappingId: string) {
  return api.delete(`/api/clients/${encodeURIComponent(clientId)}/http/frp/mappings/${encodeURIComponent(mappingId)}`);
}
