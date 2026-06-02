import { randomBytes } from 'node:crypto';
import { tasksService as defaultTasksService } from '../tasks/tasks.service.js';
import { connectionManager as defaultConnectionManager } from '../connections/connections.manager.js';
import { frpService as defaultFrpService, getFrpsConnectionInfo } from '../frp/frp.service.js';
import { checkFrpsProxyRegistration } from '../frp/frps-dashboard.service.js';
import { env } from '../../config/env.js';

export interface ClientFileSession {
  clientId: string;
  token: string;
  localPort: number;
  mappingId: string;
  publicUrl: string;
  startedAt: number;
  expiresAt: number;
}

interface Deps {
  tasksService: typeof defaultTasksService;
  connectionManager: typeof defaultConnectionManager;
  frpService: typeof defaultFrpService;
}

export class ClientFileSessionsService {
  private sessions = new Map<string, ClientFileSession>();
  private deps: Deps;

  constructor(deps?: Deps) {
    this.deps = deps ?? {
      tasksService: defaultTasksService,
      connectionManager: defaultConnectionManager,
      frpService: defaultFrpService,
    };
  }

  getSession(clientId: string): ClientFileSession | undefined {
    const session = this.sessions.get(clientId);
    if (!session) return undefined;
    if (session.expiresAt <= Date.now()) {
      this.sessions.delete(clientId);
      return undefined;
    }
    return session;
  }

  /**
   * Register a pre-created file session (e.g. from auto-mapping on client connect).
   * This allows startSession() to instantly return the session without creating
   * a new file service or FRP tunnel.
   */
  registerPreCreatedSession(session: ClientFileSession): void {
    console.log(`[file-session] registering pre-created session for ${session.clientId}, url=${session.publicUrl}`);
    this.sessions.set(session.clientId, session);
  }

  async startSession(clientId: string, ttlMs = 30 * 60 * 1000): Promise<ClientFileSession> {
    const existing = this.getSession(clientId);
    if (existing) {
      // Optimistic fast path: if a pre-created session exists, return it immediately
      // without a health check. Pre-created sessions are registered right after the
      // client connects, so they are very likely healthy. If the session turns out to
      // be stale, the proxy layer will return an error and the frontend can retry.
      if (existing.startedAt > 0) {
        console.log(`[file-session] reusing pre-created session for ${clientId}, url=${existing.publicUrl}`);
        return existing;
      }
      // For non-pre-created sessions, do a health check
      const healthy = await this.isSessionHealthy(existing);
      if (healthy) return existing;
      this.sessions.delete(clientId);
      // Fire-and-forget cleanup of stale session; don't block the new session
      this.removeExistingFileServiceMappings(clientId).catch((err) => {
        console.warn(`[file-session] background cleanup of stale mappings for ${clientId} failed:`, err instanceof Error ? err.message : err);
      });
    } else {
      // Even without a cached session, clean up any orphaned mappings in the background
      this.removeExistingFileServiceMappings(clientId).catch((err) => {
        console.warn(`[file-session] background cleanup of orphaned mappings for ${clientId} failed:`, err instanceof Error ? err.message : err);
      });
    }

    const token = `file_${randomBytes(24).toString('hex')}`;
    const mappingName = this.buildFileServiceName(clientId, token);
    const payload = { port: 0, token, ttlMs };
    const startTask = this.deps.tasksService.createTask({
      clientId,
      type: 'file_service_start',
      payload,
      createdBy: 'server:file-session',
    });

    const dispatched = this.deps.connectionManager.sendToClient(clientId, {
      type: 'task.dispatch',
      requestId: startTask.id,
      payload: {
        taskId: startTask.id,
        taskType: 'file_service_start',
        payload,
      },
    });

    if (!dispatched) throw new Error(`Client ${clientId} is offline`);

    const result = await this.waitForStartResult(startTask.id);
    const mapping = await this.deps.frpService.createMapping({
      clientId,
      name: mappingName,
      proxyType: 'tcp',
      localIp: '127.0.0.1',
      localPort: result.port,
    });

    const frpsInfo = getFrpsConnectionInfo();
    const frpPayload = {
      mappingId: mapping.id,
      name: mappingName,
      proxyType: 'tcp',
      localIp: '127.0.0.1',
      localPort: result.port,
      remotePort: mapping.remote_port,
      customDomain: mapping.custom_domain ?? undefined,
      serverAddr: frpsInfo.serverAddr,
      serverPort: frpsInfo.serverPort,
      authToken: frpsInfo.authToken,
    };
    const frpTask = this.deps.tasksService.createTask({
      clientId,
      type: 'frp_create_proxy',
      payload: frpPayload,
      createdBy: 'server:file-session',
    });

    const frpDispatched = this.deps.connectionManager.sendToClient(clientId, {
      type: 'task.dispatch',
      requestId: frpTask.id,
      payload: {
        taskId: frpTask.id,
        taskType: 'frp_create_proxy',
        payload: frpPayload,
      },
    });

    if (!frpDispatched) throw new Error(`Client ${clientId} is offline`);
    await this.waitForTaskSuccess(frpTask.id, 'FRP file service mapping');

    const apiMapping = this.deps.frpService.toApi(mapping) as { id: string; publicUrl?: string };
    if (!apiMapping.publicUrl) throw new Error('FRP mapping did not provide publicUrl');

    const session: ClientFileSession = {
      clientId,
      token,
      localPort: result.port,
      mappingId: mapping.id,
      publicUrl: this.toHttpUrl(apiMapping.publicUrl),
      startedAt: result.startedAt,
      expiresAt: Date.now() + ttlMs,
    };
    this.sessions.set(clientId, session);
    return session;
  }

  async stopSession(clientId: string): Promise<ClientFileSession | undefined> {
    const session = this.sessions.get(clientId);
    if (!session) return undefined;

    const removeTask = this.deps.tasksService.createTask({
      clientId,
      type: 'frp_remove_proxy',
      payload: { mappingId: session.mappingId },
      createdBy: 'server:file-session',
    });

    const removeDispatched = this.deps.connectionManager.sendToClient(clientId, {
      type: 'task.dispatch',
      requestId: removeTask.id,
      payload: {
        taskId: removeTask.id,
        taskType: 'frp_remove_proxy',
        payload: { mappingId: session.mappingId },
      },
    });

    if (removeDispatched) {
      await this.waitForTaskSuccess(removeTask.id, 'File session FRP removal');
    }
    this.deps.frpService.deleteMapping(session.mappingId);

    const stopTask = this.deps.tasksService.createTask({
      clientId,
      type: 'file_service_stop',
      payload: {},
      createdBy: 'server:file-session',
    });

    const stopDispatched = this.deps.connectionManager.sendToClient(clientId, {
      type: 'task.dispatch',
      requestId: stopTask.id,
      payload: {
        taskId: stopTask.id,
        taskType: 'file_service_stop',
        payload: {},
      },
    });

    if (stopDispatched) {
      await this.waitForTaskSuccess(stopTask.id, 'File session service stop');
    }

    this.sessions.delete(clientId);
    return session;
  }

  private async isSessionHealthy(session: ClientFileSession): Promise<boolean> {
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 5_000);
      const response = await fetch(`${session.publicUrl}/v1/roots`, {
        headers: { Authorization: `Bearer ${session.token}` },
        signal: controller.signal,
      });
      clearTimeout(timeout);
      if (!response.ok) {
        console.warn(`[file-session] health check failed for ${session.clientId}: HTTP ${response.status}`);
      }
      return response.ok;
    } catch (err) {
      console.warn(`[file-session] health check failed for ${session.clientId}:`, err instanceof Error ? err.message : err);
      return false;
    }
  }

  private async removeExistingFileServiceMappings(clientId: string): Promise<void> {
    const mappings = this.deps.frpService.listMappings(clientId)
      .filter((mapping) => mapping.name?.startsWith(`file-service-${clientId}`));

    if (mappings.length === 0) return;

    // Remove mappings from DB immediately so new session doesn't see stale entries
    for (const mapping of mappings) {
      this.deps.frpService.deleteMapping(mapping.id);
    }

    // Dispatch removal tasks to client in the background
    for (const mapping of mappings) {
      const removeTask = this.deps.tasksService.createTask({
        clientId,
        type: 'frp_remove_proxy',
        payload: { mappingId: mapping.id },
        createdBy: 'server:file-session',
      });

      this.deps.connectionManager.sendToClient(clientId, {
        type: 'task.dispatch',
        requestId: removeTask.id,
        payload: {
          taskId: removeTask.id,
          taskType: 'frp_remove_proxy',
          payload: { mappingId: mapping.id },
        },
      });
      // Don't wait for result; the proxy will stop on its own
    }

    // Best-effort: wait for frps to release the old proxy, but with a short timeout
    const representative = mappings[0];
    try {
      await this.waitForProxyUnregistered({
        name: representative.name,
        proxyType: representative.proxy_type as 'tcp' | 'http' | 'https',
        remotePort: representative.remote_port,
      }, 3_000); // Short 3s timeout for background cleanup
    } catch (err) {
      console.warn(`[file-session] old proxy release not confirmed for ${clientId}; continuing:`, err instanceof Error ? err.message : err);
    }
  }

  private buildFileServiceName(clientId: string, token: string): string {
    return `file-service-${clientId}-${token.slice(-8)}`;
  }

  private async waitForProxyUnregistered(mapping: { name: string; proxyType: 'tcp' | 'http' | 'https'; remotePort?: number | null }, timeoutMs = 30_000): Promise<void> {
    const startedAt = Date.now();
    while (Date.now() - startedAt < timeoutMs) {
      const result = await checkFrpsProxyRegistration({
        dashboard: {
          scheme: env.FRPS_DASHBOARD_SCHEME,
          host: env.FRPS_DASHBOARD_HOST,
          port: env.FRPS_DASHBOARD_PORT,
          user: env.FRPS_DASHBOARD_USER,
          password: env.FRPS_DASHBOARD_PASSWORD,
        },
        mapping,
      });

      if (!result.dashboardReachable) {
        throw new Error(`Cannot confirm proxy removal from frps: ${result.detail ?? result.reason}`);
      }
      if (!result.registered) {
        return;
      }

      await new Promise((resolve) => setTimeout(resolve, 250));
    }
    throw new Error(`Timed out waiting for frps to release proxy ${mapping.name}`);
  }

  private toHttpUrl(publicUrl: string): string {
    if (/^https?:\/\//.test(publicUrl)) return publicUrl;
    return `http://${publicUrl}`;
  }

  private async waitForStartResult(taskId: string): Promise<{ port: number; startedAt: number }> {
    const task = await this.waitForTaskSuccess(taskId, 'File service start');
    const result = typeof task.result === 'string' ? JSON.parse(task.result) : task.result;
    if (typeof result.port === 'number' && typeof result.startedAt === 'number') {
      return { port: result.port, startedAt: result.startedAt };
    }
    throw new Error(`File service start task ${taskId} returned invalid result`);
  }

  private async waitForTaskSuccess(taskId: string, label: string) {
    const startedAt = Date.now();
    while (Date.now() - startedAt < 10_000) {
      const task = this.deps.tasksService.getTask(taskId);
      if (task?.status === 'success') return task;
      if (task?.status === 'failed') {
        throw new Error(task.error ?? `${label} failed`);
      }
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
    throw new Error(`Timed out waiting for ${label} task ${taskId}`);
  }
}

export const clientFileSessionsService = new ClientFileSessionsService();
