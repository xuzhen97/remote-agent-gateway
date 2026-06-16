/** @file 客户端 HTTP 控制面协调器
 *
 * 当客户端注册时，服务端需要为其分配：
 * 1. FRP 远程端口（将客户端的本地 HTTP 服务暴露到公网）
 * 2. 客户端 HTTP Token（用于数据面鉴权）
 * 3. 公网可访问的 Base URL
 */
import type { ClientHttpInfo, ClientHttpCapabilities } from '@rag/shared';
import { env, buildClientHttpPublicUrl } from '../../config/env.js';
import { clientsService } from '../clients/clients.service.js';
import { portAllocatorService } from '../ports/port-allocator.service.js';
import { deriveClientHttpToken } from './client-http-token.service.js';

/** 依赖注入接口，方便测试 */
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
  allocatePort?: (clientId: string, options?: {
    preferredPort?: number;
    reserve?: (port: number, clientId: string) => Promise<void> | void;
  }) => Promise<number>;
}

/** HTTP 控制面协调器 */
export class ClientHttpCoordinatorService {
  private coordinationQueue: Promise<unknown> = Promise.resolve();

  constructor(private readonly deps: Deps = {}) {}

  /**
   * 协调客户端的 HTTP 控制面端点
   * 分配或复用远程端口，生成 Token 和 Base URL
   */
  async coordinate(clientId: string, http: ClientHttpInfo, capabilities?: ClientHttpCapabilities) {
    return this.withLock(async () => {
      // 优先复用该客户端之前使用的远程端口
      const existing = this.deps.getClient
        ? this.deps.getClient(clientId) ?? undefined
        : clientsService.getClient(clientId) as { id: string; http_remote_port?: number | null } | undefined;
      const preferred = existing && typeof existing.http_remote_port === 'number' ? existing.http_remote_port : undefined;
      let remotePort: number;
      let reused = false;

      const token = deriveClientHttpToken({
        tokenSecret: this.deps.tokenSecret ?? env.CLIENT_HTTP_TOKEN_SECRET,
        tokenVersion: this.deps.tokenVersion ?? env.CLIENT_HTTP_TOKEN_VERSION,
        clientId,
      });

      const reservePatch = (port: number, reserveClientId: string): void => {
        const baseUrl = this.deps.frpsPublicHost
          ? `http://${this.deps.frpsPublicHost}:${port}`
          : buildClientHttpPublicUrl(port);
        const patch = {
          localHost: http.localHost,
          localPort: http.localPort,
          remotePort: port,
          baseUrl,
          token,
          capabilities,
          ready: false,
        };
        if (this.deps.updateClientHttp) {
          this.deps.updateClientHttp(reserveClientId, patch);
        } else {
          clientsService.updateHttpEndpoint(reserveClientId, patch);
        }
      };

      if (typeof preferred === 'number' && await this.isAvailable(preferred, clientId)) {
        remotePort = preferred;
        reused = true;
        reservePatch(remotePort, clientId);
      } else {
        remotePort = await (this.deps.allocatePort?.(clientId, { reserve: reservePatch })
          ?? portAllocatorService.allocate(clientId, { reserve: reservePatch }));
      }

      const baseUrl = this.deps.frpsPublicHost
        ? `http://${this.deps.frpsPublicHost}:${remotePort}`
        : buildClientHttpPublicUrl(remotePort);

      return {
        localHost: http.localHost,
        localPort: http.localPort,
        remotePort,
        publicBaseUrl: baseUrl,
        token,
        reused,
      };
    });
  }

  /** 检查端口是否可被客户端 HTTP 复用 */
  private async isAvailable(port: number, clientId: string): Promise<boolean> {
    if (this.deps.isHttpPortAvailable) return this.deps.isHttpPortAvailable(port, clientId);
    return portAllocatorService.isAvailableForClientHttp(port, clientId);
  }

  private async withLock<T>(work: () => Promise<T>): Promise<T> {
    const next = this.coordinationQueue.then(work, work);
    this.coordinationQueue = next.then(() => undefined, () => undefined);
    return next;
  }
}

/** 全局 HTTP 控制面协调器单例 */
export const clientHttpCoordinatorService = new ClientHttpCoordinatorService();
