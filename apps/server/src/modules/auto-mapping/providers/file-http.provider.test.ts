import { beforeEach, describe, expect, it, vi } from 'vitest';
import { initDb, getDb } from '../../../db/index.js';
import { FileHttpAutoMappingProvider } from './file-http.provider.js';

describe('FileHttpAutoMappingProvider', () => {
  beforeEach(async () => {
    await initDb();
    const db = getDb();
    db.run('DELETE FROM auto_mappings');
    db.run('DELETE FROM port_mappings');
  });

  it('starts the file service, creates a mapping, and dispatches frp_create_proxy', async () => {
    const tasksService = {
      createTask: vi.fn()
        .mockReturnValueOnce({ id: 'task_start_file' })
        .mockReturnValueOnce({ id: 'task_frp_file' }),
      getTask: vi.fn((taskId: string) => ({
        id: taskId,
        status: 'success',
        result: taskId === 'task_start_file'
          ? JSON.stringify({ running: true, host: '127.0.0.1', port: 45123, startedAt: 1000 })
          : JSON.stringify({ ok: true }),
      })),
    };

    const connectionManager = { sendToClient: vi.fn().mockReturnValue(true) };
    const frpService = {
      createMapping: vi.fn().mockResolvedValue({
        id: 'pm-auto',
        client_id: 'client-1',
        name: 'auto-file-http-client-1',
        proxy_type: 'http',
        local_ip: '127.0.0.1',
        local_port: 45123,
        remote_port: 23001,
        custom_domain: null,
        status: 'inactive',
        public_url: 'http://frps.example.com:23001',
        created_at: 1000,
        updated_at: 1000,
      }),
      deleteMapping: vi.fn(),
    };

    const provider = new FileHttpAutoMappingProvider({
      tasksService: tasksService as never,
      connectionManager: connectionManager as never,
      frpService: frpService as never,
      getFrpsConnectionInfo: () => ({ serverAddr: 'frps.example.com', serverPort: 7000, authToken: 'frp-token' }),
      waitForTask: async (taskId: string) => tasksService.getTask(taskId),
    });

    const result = await provider.onClientOnline('client-1');

    expect(tasksService.createTask).toHaveBeenNthCalledWith(1, expect.objectContaining({
      clientId: 'client-1',
      type: 'file_service_start',
      payload: expect.objectContaining({ token: expect.any(String), ttlMs: 30 * 60 * 1000 }),
    }));
    expect(frpService.createMapping).toHaveBeenCalledWith(expect.objectContaining({
      clientId: 'client-1',
      proxyType: 'http',
      localPort: 45123,
      localIp: '127.0.0.1',
    }));
    expect(tasksService.createTask).toHaveBeenNthCalledWith(2, expect.objectContaining({
      clientId: 'client-1',
      type: 'frp_create_proxy',
      payload: expect.objectContaining({ mappingId: 'pm-auto', remotePort: 23001 }),
    }));
    expect(result).toEqual({
      mappingId: 'pm-auto',
      localPort: 45123,
      name: 'auto-file-http-client-1',
      proxyType: 'http',
    });
  });

  it('cleans up cleanup_pending mappings before creating a new one', async () => {
    const now = Date.now();
    getDb().run(
      `INSERT INTO auto_mappings (id, client_id, provider_name, mapping_id, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)`,
      ['am-1', 'client-1', 'file-http', 'pm-stale', 'cleanup_pending', now, now],
    );

    const tasksService = {
      createTask: vi.fn()
        .mockReturnValueOnce({ id: 'task_cleanup_proxy' })
        .mockReturnValueOnce({ id: 'task_start_file' })
        .mockReturnValueOnce({ id: 'task_frp_file' }),
      getTask: vi.fn((taskId: string) => ({
        id: taskId,
        status: 'success',
        result: taskId === 'task_start_file'
          ? JSON.stringify({ running: true, host: '127.0.0.1', port: 45123, startedAt: 1000 })
          : JSON.stringify({ ok: true }),
      })),
    };
    const connectionManager = { sendToClient: vi.fn().mockReturnValue(true) };
    const frpService = {
      createMapping: vi.fn().mockResolvedValue({
        id: 'pm-auto',
        client_id: 'client-1',
        name: 'auto-file-http-client-1',
        proxy_type: 'http',
        local_ip: '127.0.0.1',
        local_port: 45123,
        remote_port: 23001,
        custom_domain: null,
        status: 'inactive',
        public_url: 'http://frps.example.com:23001',
        created_at: 1000,
        updated_at: 1000,
      }),
      deleteMapping: vi.fn(),
    };

    const provider = new FileHttpAutoMappingProvider({
      tasksService: tasksService as never,
      connectionManager: connectionManager as never,
      frpService: frpService as never,
      getFrpsConnectionInfo: () => ({ serverAddr: 'frps.example.com', serverPort: 7000, authToken: 'frp-token' }),
      waitForTask: async (taskId: string) => tasksService.getTask(taskId),
    });

    await provider.onClientOnline('client-1');

    expect(tasksService.createTask).toHaveBeenNthCalledWith(1, expect.objectContaining({
      clientId: 'client-1',
      type: 'frp_remove_proxy',
      payload: { mappingId: 'pm-stale' },
    }));
    expect(frpService.deleteMapping).toHaveBeenCalledWith('pm-stale');

    const stmt = getDb().prepare('SELECT * FROM auto_mappings WHERE mapping_id = ?');
    stmt.bind(['pm-stale']);
    expect(stmt.step()).toBe(false);
    stmt.free();
  });
});
