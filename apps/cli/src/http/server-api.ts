/** @file Server API 客户端
 *
 * 封装对 RAG 服务端控制面 API 的 HTTP 调用。
 * 包括客户端发现、任务审计查询、传输管理等功能。
 */
import { CliError } from './http-error.js';

/** Server API 配置 */
export interface ServerApiConfig {
  serverUrl: string;
  token: string;
}

/** 客户端 HTTP 发现结果 */
export interface DiscoveredClientHttp {
  baseUrl: string;
  token: string;
  client: Record<string, unknown>;
}

/**
 * 服务端 API 客户端
 * 所有请求携带 Bearer Token 鉴权。
 */
export class ServerApi {
  constructor(private readonly config: ServerApiConfig) {}

  /** 列出所有注册客户端 */
  async listClients(): Promise<unknown> {
    return this.request('GET', '/api/clients');
  }

  /** 获取单个客户端详情 */
  async getClient(clientId: string): Promise<Record<string, unknown>> {
    return this.request('GET', `/api/clients/${encodeURIComponent(clientId)}`) as Promise<Record<string, unknown>>;
  }

  /**
   * 发现客户端 HTTP 端点
   * 返回 baseUrl 和 token 用于直接调用 client HTTP API。
   * 如果客户端尚未就绪则抛出 CLIENT_DISCOVERY_ERROR。
   */
  async discoverClientHttp(clientId: string): Promise<DiscoveredClientHttp> {
    const client = await this.getClient(clientId);
    const baseUrl = typeof client.clientHttpBaseUrl === 'string' ? client.clientHttpBaseUrl : '';
    const token = typeof client.clientHttpToken === 'string' ? client.clientHttpToken : '';
    if (!baseUrl || !token) {
      throw new CliError('CLIENT_DISCOVERY_ERROR', `客户端 ${clientId} 的 HTTP 端点尚未就绪（缺少 clientHttpBaseUrl/clientHttpToken）`);
    }
    return { baseUrl: baseUrl.replace(/\/+$/, ''), token, client };
  }

  /** 查询任务审计历史 */
  async listTasks(query: Record<string, string | number | undefined> = {}): Promise<unknown> {
    const search = new URLSearchParams();
    for (const [key, value] of Object.entries(query)) {
      if (value !== undefined && value !== '') search.set(key, String(value));
    }
    const suffix = search.size ? `?${search.toString()}` : '';
    return this.request('GET', `/api/tasks${suffix}`);
  }

  /** 获取单条审计记录详情 */
  async getTaskRecord(recordId: string): Promise<unknown> {
    return this.request('GET', `/api/tasks/${encodeURIComponent(recordId)}`);
  }

  /** 创建上传传输任务 */
  async createUploadTransfer(input: Record<string, unknown>): Promise<unknown> {
    return this.request('POST', '/api/transfers/uploads', input);
  }

  /** 查询传输任务状态 */
  async getTransfer(transferId: string): Promise<unknown> {
    return this.request('GET', `/api/transfers/${encodeURIComponent(transferId)}`);
  }

  /** 上报 CLI 上传进度 */
  async reportCliProgress(transferId: string, input: Record<string, unknown>): Promise<unknown> {
    return this.request('POST', `/api/transfers/${encodeURIComponent(transferId)}/cli-progress`, input);
  }

  /** 通知服务端 CLI 上传完成 */
  async completeCliUpload(transferId: string): Promise<unknown> {
    return this.request('POST', `/api/transfers/${encodeURIComponent(transferId)}/cli-upload-complete`, {});
  }

  /** 刷新失效的上传 URL（阿里云盘分片 URL 过期时使用） */
  async refreshUploadUrl(transferId: string, partNumbers: number[]): Promise<unknown> {
    return this.request('POST', `/api/transfers/${encodeURIComponent(transferId)}/refresh-upload-url`, { partNumbers });
  }

  /** 通过服务端代理执行任务（WebSocket 路径） */
  async proxyJob(clientId: string, payload: { command: string; args?: string[]; timeoutMs?: number; cwd?: string; env?: Record<string, string> }): Promise<unknown> {
    return this.request('POST', `/api/clients/${encodeURIComponent(clientId)}/jobs/run`, payload);
  }

  /** 列出所有发布版本 */
  async listUpdateReleases(): Promise<unknown> {
    return this.request('GET', '/admin/updates/releases');
  }

  /** 创建更新编排 */
  async createUpdateCampaign(input: Record<string, unknown>): Promise<unknown> {
    return this.request('POST', '/admin/updates/campaigns', input);
  }

  /** 查询更新编排 */
  async getUpdateCampaign(id: string): Promise<unknown> {
    return this.request('GET', `/admin/updates/campaigns/${encodeURIComponent(id)}`);
  }

  /** 重试更新编排 */
  async retryUpdateCampaign(id: string, input: Record<string, unknown>): Promise<unknown> {
    return this.request('POST', `/admin/updates/campaigns/${encodeURIComponent(id)}/retry`, input);
  }

  /** 通用 HTTP 请求方法 */
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

/**
 * 读取并解析 HTTP 响应
 * @param response - fetch Response 对象
 * @param mode - 响应格式（json / text / bytes）
 * @throws CliError 当响应状态码非 2xx 时
 */
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
