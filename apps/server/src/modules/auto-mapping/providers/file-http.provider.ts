import { randomBytes } from 'node:crypto';
import { getDb } from '../../../db/index.js';
import { tasksService as defaultTasksService } from '../../tasks/tasks.service.js';
import { connectionManager as defaultConnectionManager } from '../../connections/connections.manager.js';
import { frpService as defaultFrpService, getFrpsConnectionInfo as defaultGetFrpsConnectionInfo } from '../../frp/frp.service.js';

interface FileHttpProviderDeps {
  tasksService: typeof defaultTasksService;
  connectionManager: typeof defaultConnectionManager;
  frpService: typeof defaultFrpService;
  getFrpsConnectionInfo: typeof defaultGetFrpsConnectionInfo;
  waitForTask?: (taskId: string, label: string) => Promise<{ id: string; status: string; result?: string | null; error?: string | null }>;
}

export class FileHttpAutoMappingProvider {
  private readonly deps: FileHttpProviderDeps;

  readonly name = 'file-http';

  constructor(deps?: Partial<FileHttpProviderDeps>) {
    this.deps = {
      tasksService: deps?.tasksService ?? defaultTasksService,
      connectionManager: deps?.connectionManager ?? defaultConnectionManager,
      frpService: deps?.frpService ?? defaultFrpService,
      getFrpsConnectionInfo: deps?.getFrpsConnectionInfo ?? defaultGetFrpsConnectionInfo,
      waitForTask: deps?.waitForTask,
    } as FileHttpProviderDeps;
  }

  async onClientOnline(clientId: string) {
    await this.cleanupPendingMappings(clientId);

    const token = `file_${randomBytes(24).toString('hex')}`;
    const startPayload = { port: 0, token, ttlMs: 30 * 60 * 1000 };
    const startTask = this.deps.tasksService.createTask({
      clientId,
      type: 'file_service_start',
      payload: startPayload,
      createdBy: 'server:auto-mapping',
    });

    const startDispatched = this.deps.connectionManager.sendToClient(clientId, {
      type: 'task.dispatch',
      requestId: startTask.id,
      payload: { taskId: startTask.id, taskType: 'file_service_start', payload: startPayload },
    });
    if (!startDispatched) throw new Error(`Client ${clientId} is offline`);

    const started = await this.waitForTaskSuccess(startTask.id, 'Auto file service start');
    const startResult = JSON.parse(started.result ?? '{}') as { port?: number };
    if (typeof startResult.port !== 'number') throw new Error(`file_service_start for ${clientId} returned no port`);

    const mapping = await this.deps.frpService.createMapping({
      clientId,
      name: `auto-file-http-${clientId}`,
      proxyType: 'http',
      localIp: '127.0.0.1',
      localPort: startResult.port,
    });

    const frpsInfo = this.deps.getFrpsConnectionInfo();
    const frpPayload = {
      mappingId: mapping.id,
      name: mapping.name,
      proxyType: 'http' as const,
      localIp: '127.0.0.1',
      localPort: startResult.port,
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
      createdBy: 'server:auto-mapping',
    });
    const frpDispatched = this.deps.connectionManager.sendToClient(clientId, {
      type: 'task.dispatch',
      requestId: frpTask.id,
      payload: { taskId: frpTask.id, taskType: 'frp_create_proxy', payload: frpPayload },
    });
    if (!frpDispatched) throw new Error(`Client ${clientId} went offline before FRP create`);

    await this.waitForTaskSuccess(frpTask.id, 'Auto file FRP create');

    return {
      mappingId: mapping.id,
      localPort: startResult.port,
      name: mapping.name,
      proxyType: 'http' as const,
    };
  }

  async onClientOffline(_clientId: string, _mappingId: string): Promise<void> {
    // cleanup is deferred until reconnect
  }

  private async cleanupPendingMappings(clientId: string): Promise<void> {
    const stmt = getDb().prepare('SELECT mapping_id FROM auto_mappings WHERE client_id = ? AND provider_name = ? AND status = ? ORDER BY created_at ASC');
    stmt.bind([clientId, this.name, 'cleanup_pending']);
    const staleMappingIds: string[] = [];
    while (stmt.step()) {
      const row = stmt.getAsObject() as { mapping_id: string };
      staleMappingIds.push(row.mapping_id);
    }
    stmt.free();

    for (const mappingId of staleMappingIds) {
      const removeTask = this.deps.tasksService.createTask({
        clientId,
        type: 'frp_remove_proxy',
        payload: { mappingId },
        createdBy: 'server:auto-mapping-cleanup',
      });
      const dispatched = this.deps.connectionManager.sendToClient(clientId, {
        type: 'task.dispatch',
        requestId: removeTask.id,
        payload: { taskId: removeTask.id, taskType: 'frp_remove_proxy', payload: { mappingId } },
      });
      if (dispatched) {
        await this.waitForTaskSuccess(removeTask.id, 'Auto mapping cleanup');
      }
      this.deps.frpService.deleteMapping(mappingId);
      getDb().run('DELETE FROM auto_mappings WHERE mapping_id = ?', [mappingId]);
    }
  }

  private async waitForTaskSuccess(taskId: string, label: string) {
    if (this.deps.waitForTask) return this.deps.waitForTask(taskId, label);

    const startedAt = Date.now();
    while (Date.now() - startedAt < 10_000) {
      const task = this.deps.tasksService.getTask(taskId);
      if (task?.status === 'success') return task;
      if (task?.status === 'failed') throw new Error(task.error ?? `${label} failed`);
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
    throw new Error(`Timed out waiting for ${label}`);
  }
}
