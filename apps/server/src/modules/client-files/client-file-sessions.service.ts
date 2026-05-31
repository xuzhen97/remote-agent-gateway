import { randomBytes } from 'node:crypto';
import { tasksService as defaultTasksService } from '../tasks/tasks.service.js';
import { connectionManager as defaultConnectionManager } from '../connections/connections.manager.js';
import { frpService as defaultFrpService, getFrpsConnectionInfo } from '../frp/frp.service.js';

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

  async startSession(clientId: string, ttlMs = 30 * 60 * 1000): Promise<ClientFileSession> {
    const existing = this.getSession(clientId);
    if (existing) return existing;

    const token = `file_${randomBytes(24).toString('hex')}`;
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
    const mapping = this.deps.frpService.createMapping({
      clientId,
      name: `file-service-${clientId}`,
      proxyType: 'tcp',
      localIp: '127.0.0.1',
      localPort: result.port,
    });

    const frpsInfo = getFrpsConnectionInfo();
    const frpPayload = {
      mappingId: mapping.id,
      name: `file-service-${clientId}`,
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

  stopSession(clientId: string): ClientFileSession | undefined {
    const session = this.sessions.get(clientId);
    this.sessions.delete(clientId);
    return session;
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
