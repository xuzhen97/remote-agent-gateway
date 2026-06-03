import type { ClientHttpInfo, ClientHttpCapabilities } from '@rag/shared';
import { env, buildClientHttpPublicUrl } from '../../config/env.js';
import { clientsService } from '../clients/clients.service.js';
import { portAllocatorService } from '../ports/port-allocator.service.js';
import { deriveClientHttpToken } from './client-http-token.service.js';

interface Deps {
  frpsPublicHost?: string;
  tokenSecret?: string;
  tokenVersion?: number;
  getClient?: (clientId: string) => { id: string; http_remote_port?: number | null } | undefined | null;
  updateClientHttp?: (clientId: string, patch: {
    localHost: string;
    localPort: number;
    remotePort: number;
    baseUrl: string;
    token: string;
    capabilities?: ClientHttpCapabilities;
    ready?: boolean;
  }) => void;
  isHttpPortAvailable?: (port: number, clientId: string) => Promise<boolean>;
  allocatePort?: (clientId: string) => Promise<number>;
}

export class ClientHttpCoordinatorService {
  constructor(private readonly deps: Deps = {}) {}

  async coordinate(clientId: string, http: ClientHttpInfo, capabilities?: ClientHttpCapabilities) {
    const existing = this.deps.getClient
      ? this.deps.getClient(clientId) ?? undefined
      : clientsService.getClient(clientId) as { id: string; http_remote_port?: number | null } | undefined;
    const preferred = existing && typeof existing.http_remote_port === 'number' ? existing.http_remote_port : undefined;
    let remotePort: number;
    let reused = false;

    if (typeof preferred === 'number' && await this.isAvailable(preferred, clientId)) {
      remotePort = preferred;
      reused = true;
    } else {
      remotePort = await (this.deps.allocatePort?.(clientId) ?? portAllocatorService.allocate(clientId, {}));
    }

    const baseUrl = this.deps.frpsPublicHost
      ? `http://${this.deps.frpsPublicHost}:${remotePort}`
      : buildClientHttpPublicUrl(remotePort);
    const token = deriveClientHttpToken({
      tokenSecret: this.deps.tokenSecret ?? env.CLIENT_HTTP_TOKEN_SECRET,
      tokenVersion: this.deps.tokenVersion ?? env.CLIENT_HTTP_TOKEN_VERSION,
      clientId,
    });

    const patch = {
      localHost: http.localHost,
      localPort: http.localPort,
      remotePort,
      baseUrl,
      token,
      capabilities,
      ready: false,
    };
    if (this.deps.updateClientHttp) {
      this.deps.updateClientHttp(clientId, patch);
    } else {
      clientsService.updateHttpEndpoint(clientId, patch);
    }

    return {
      localHost: http.localHost,
      localPort: http.localPort,
      remotePort,
      publicBaseUrl: baseUrl,
      token,
      reused,
    };
  }

  private async isAvailable(port: number, clientId: string): Promise<boolean> {
    if (this.deps.isHttpPortAvailable) return this.deps.isHttpPortAvailable(port, clientId);
    return portAllocatorService.isAvailableForClientHttp(port, clientId);
  }
}

export const clientHttpCoordinatorService = new ClientHttpCoordinatorService();
