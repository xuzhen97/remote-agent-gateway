import { afterEach, describe, expect, it, vi } from 'vitest';
import { ClientFileSessionsService } from './client-file-sessions.service.js';

const { checkFrpsRegistrationMock } = vi.hoisted(() => ({
  checkFrpsRegistrationMock: vi.fn().mockResolvedValue({ registered: false, dashboardReachable: true, reason: 'not_found' }),
}));

vi.mock('../frp/frps-dashboard.service.js', () => ({
  checkFrpsProxyRegistration: checkFrpsRegistrationMock,
}));

describe('ClientFileSessionsService', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  it('creates a start task and FRP mapping when no session exists', async () => {
    const tasksService = {
      createTask: vi.fn()
        .mockReturnValueOnce({ id: 'task_remove_old_file', client_id: 'client-1' })
        .mockReturnValueOnce({ id: 'task_start_file', client_id: 'client-1' })
        .mockReturnValueOnce({ id: 'task_frp_file', client_id: 'client-1' }),
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
      listMappings: vi.fn().mockReturnValue([{ id: 'pm_old_file', client_id: 'client-1', name: 'file-service-client-1-stale0001', proxy_type: 'tcp', remote_port: 23000 }]),
      deleteMapping: vi.fn(),
      createMapping: vi.fn().mockReturnValue({
        id: 'pm_file',
        client_id: 'client-1',
        name: 'file-service-client-1-live0001',
        proxy_type: 'tcp',
        local_ip: '127.0.0.1',
        local_port: 45123,
        remote_port: 23001,
        custom_domain: null,
        status: 'inactive',
        public_url: 'http://127.0.0.1:23001',
        created_at: 1000,
        updated_at: 1000,
      }),
      toApi: vi.fn((mapping) => ({ publicUrl: mapping.public_url, id: mapping.id, name: mapping.name, proxyType: mapping.proxy_type, remotePort: mapping.remote_port })),
    };

    const service = new ClientFileSessionsService({ tasksService, connectionManager, frpService } as never);
    const session = await service.startSession('client-1');

    expect(tasksService.createTask).toHaveBeenCalledWith(expect.objectContaining({
      clientId: 'client-1',
      type: 'frp_remove_proxy',
      payload: { mappingId: 'pm_old_file' },
    }));
    expect(connectionManager.sendToClient).toHaveBeenCalledWith('client-1', expect.objectContaining({
      payload: expect.objectContaining({ taskType: 'frp_remove_proxy' }),
    }));
    expect(frpService.deleteMapping).toHaveBeenCalledWith('pm_old_file');
    expect(tasksService.createTask).toHaveBeenCalledWith(expect.objectContaining({
      clientId: 'client-1',
      type: 'file_service_start',
      payload: expect.objectContaining({ token: expect.any(String) }),
    }));
    expect(connectionManager.sendToClient).toHaveBeenCalledWith('client-1', expect.objectContaining({
      payload: expect.objectContaining({ taskType: 'file_service_start' }),
    }));
    expect(frpService.createMapping).toHaveBeenCalledWith(expect.objectContaining({
      clientId: 'client-1',
      name: expect.stringMatching(/^file-service-client-1-/),
      proxyType: 'tcp',
      localIp: '127.0.0.1',
      localPort: 45123,
    }));
    expect(tasksService.createTask).toHaveBeenCalledWith(expect.objectContaining({
      clientId: 'client-1',
      type: 'frp_create_proxy',
      payload: expect.objectContaining({
        mappingId: 'pm_file',
        localPort: 45123,
        remotePort: 23001,
      }),
    }));
    expect(connectionManager.sendToClient).toHaveBeenCalledWith('client-1', expect.objectContaining({
      payload: expect.objectContaining({ taskType: 'frp_create_proxy' }),
    }));
    expect(session).toEqual(expect.objectContaining({
      clientId: 'client-1',
      localPort: 45123,
      mappingId: 'pm_file',
      publicUrl: 'http://127.0.0.1:23001',
    }));
  });

  it('recreates an unhealthy existing session instead of reusing it', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('ECONNRESET')));
    checkFrpsRegistrationMock.mockResolvedValueOnce({ registered: false, dashboardReachable: true, reason: 'not_found' });

    const tasksService = {
      createTask: vi.fn()
        .mockReturnValueOnce({ id: 'task_remove_old_file', client_id: 'client-1' })
        .mockReturnValueOnce({ id: 'task_start_file', client_id: 'client-1' })
        .mockReturnValueOnce({ id: 'task_frp_file', client_id: 'client-1' }),
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
      listMappings: vi.fn().mockReturnValue([{ id: 'pm_old_file', client_id: 'client-1', name: 'file-service-client-1-stale0001', proxy_type: 'tcp', remote_port: 23000 }]),
      deleteMapping: vi.fn(),
      createMapping: vi.fn().mockReturnValue({
        id: 'pm_file',
        client_id: 'client-1',
        name: 'file-service-client-1-live0001',
        proxy_type: 'tcp',
        local_ip: '127.0.0.1',
        local_port: 45123,
        remote_port: 23001,
        custom_domain: null,
        status: 'inactive',
        public_url: 'http://127.0.0.1:23001',
        created_at: 1000,
        updated_at: 1000,
      }),
      toApi: vi.fn((mapping) => ({ publicUrl: mapping.public_url, id: mapping.id, name: mapping.name, proxyType: mapping.proxy_type, remotePort: mapping.remote_port })),
    };

    const service = new ClientFileSessionsService({ tasksService, connectionManager, frpService } as never);
    (service as unknown as { sessions: Map<string, unknown> }).sessions.set('client-1', {
      clientId: 'client-1',
      token: 'stale-token',
      localPort: 11111,
      mappingId: 'pm_old_file',
      publicUrl: 'http://127.0.0.1:21000',
      startedAt: 1,
      expiresAt: Date.now() + 60_000,
    });

    const session = await service.startSession('client-1');

    expect(tasksService.createTask).toHaveBeenCalled();
    expect(checkFrpsRegistrationMock).toHaveBeenCalledWith(expect.objectContaining({
      mapping: expect.objectContaining({
        name: 'file-service-client-1-stale0001',
        proxyType: 'tcp',
        remotePort: 23000,
      }),
    }));
    expect(frpService.deleteMapping).toHaveBeenCalledWith('pm_old_file');
    expect(session).toEqual(expect.objectContaining({
      token: expect.any(String),
      mappingId: 'pm_file',
      localPort: 45123,
    }));
  });

  it('waits for all same-name old frps proxies to disappear before recreating a new file service proxy', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('ECONNRESET')));
    checkFrpsRegistrationMock
      .mockResolvedValueOnce({ registered: true, dashboardReachable: true, reason: 'registered' })
      .mockResolvedValueOnce({ registered: false, dashboardReachable: true, reason: 'not_found' });

    const tasksService = {
      createTask: vi.fn()
        .mockReturnValueOnce({ id: 'task_remove_old_file_1', client_id: 'client-1' })
        .mockReturnValueOnce({ id: 'task_remove_old_file_2', client_id: 'client-1' })
        .mockReturnValueOnce({ id: 'task_start_file', client_id: 'client-1' })
        .mockReturnValueOnce({ id: 'task_frp_file', client_id: 'client-1' }),
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
      listMappings: vi.fn().mockReturnValue([
        { id: 'pm_old_file_1', client_id: 'client-1', name: 'file-service-client-1-stale0001', proxy_type: 'tcp', remote_port: 23000 },
        { id: 'pm_old_file_2', client_id: 'client-1', name: 'file-service-client-1-stale0002', proxy_type: 'tcp', remote_port: 23001 },
      ]),
      deleteMapping: vi.fn(),
      createMapping: vi.fn().mockReturnValue({
        id: 'pm_file',
        client_id: 'client-1',
        name: 'file-service-client-1-live0001',
        proxy_type: 'tcp',
        local_ip: '127.0.0.1',
        local_port: 45123,
        remote_port: 23002,
        custom_domain: null,
        status: 'inactive',
        public_url: 'http://127.0.0.1:23002',
        created_at: 1000,
        updated_at: 1000,
      }),
      toApi: vi.fn((mapping) => ({ publicUrl: mapping.public_url, id: mapping.id, name: mapping.name, proxyType: mapping.proxy_type, remotePort: mapping.remote_port })),
    };

    const service = new ClientFileSessionsService({ tasksService, connectionManager, frpService } as never);
    (service as unknown as { sessions: Map<string, unknown> }).sessions.set('client-1', {
      clientId: 'client-1',
      token: 'stale-token',
      localPort: 11111,
      mappingId: 'pm_old_file_1',
      publicUrl: 'http://127.0.0.1:21000',
      startedAt: 1,
      expiresAt: Date.now() + 60_000,
    });

    await service.startSession('client-1');

    expect(frpService.deleteMapping).toHaveBeenCalledWith('pm_old_file_1');
    expect(frpService.deleteMapping).toHaveBeenCalledWith('pm_old_file_2');
    expect(checkFrpsRegistrationMock).toHaveBeenCalledTimes(2);
    expect(frpService.createMapping).toHaveBeenCalledTimes(1);
  });

  it('stopSession dispatches frp_remove_proxy and file_service_stop before clearing memory session', async () => {
    const tasksService = {
      createTask: vi.fn()
        .mockReturnValueOnce({ id: 'task_remove_proxy', client_id: 'client-1' })
        .mockReturnValueOnce({ id: 'task_stop_file', client_id: 'client-1' }),
      getTask: vi.fn((taskId: string) => ({ id: taskId, status: 'success', result: JSON.stringify({ ok: true }) })),
    };
    const connectionManager = { sendToClient: vi.fn().mockReturnValue(true) };
    const frpService = {
      listMappings: vi.fn(),
      deleteMapping: vi.fn(),
      createMapping: vi.fn(),
      toApi: vi.fn(),
    };

    const service = new ClientFileSessionsService({ tasksService, connectionManager, frpService } as never);
    (service as unknown as { sessions: Map<string, unknown> }).sessions.set('client-1', {
      clientId: 'client-1',
      token: 'active-token',
      localPort: 45123,
      mappingId: 'pm_file',
      publicUrl: 'http://127.0.0.1:23001',
      startedAt: 1,
      expiresAt: Date.now() + 60_000,
    });

    const stopped = await service.stopSession('client-1');

    expect(tasksService.createTask).toHaveBeenNthCalledWith(1, expect.objectContaining({
      clientId: 'client-1',
      type: 'frp_remove_proxy',
      payload: { mappingId: 'pm_file' },
    }));
    expect(tasksService.createTask).toHaveBeenNthCalledWith(2, expect.objectContaining({
      clientId: 'client-1',
      type: 'file_service_stop',
      payload: {},
    }));
    expect(connectionManager.sendToClient).toHaveBeenCalledWith('client-1', expect.objectContaining({
      payload: expect.objectContaining({ taskType: 'frp_remove_proxy' }),
    }));
    expect(connectionManager.sendToClient).toHaveBeenCalledWith('client-1', expect.objectContaining({
      payload: expect.objectContaining({ taskType: 'file_service_stop' }),
    }));
    expect(stopped).toEqual(expect.objectContaining({ mappingId: 'pm_file' }));
    expect(service.getSession('client-1')).toBeUndefined();
  });
});
