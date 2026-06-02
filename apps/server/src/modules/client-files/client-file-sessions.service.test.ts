import { afterEach, describe, expect, it, vi } from 'vitest';
import { ClientFileSessionsService } from './client-file-sessions.service.js';

const { checkFrpsRegistrationMock } = vi.hoisted(() => ({
  checkFrpsRegistrationMock: vi.fn().mockResolvedValue({ registered: false, dashboardReachable: true, reason: 'not_found' }),
}));

vi.mock('../frp/frps-dashboard.service.js', () => ({
  checkFrpsProxyRegistration: checkFrpsRegistrationMock,
  listFrpsProxies: vi.fn().mockResolvedValue({ dashboardReachable: true, proxies: [] }),
}));

describe('ClientFileSessionsService', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  it('creates a start task and FRP mapping when no session exists', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({ roots: [] }), { status: 200 })));

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

    // Background cleanup: old mapping is deleted from DB immediately
    expect(frpService.deleteMapping).toHaveBeenCalledWith('pm_old_file');
    // Background cleanup: removal task is dispatched
    expect(tasksService.createTask).toHaveBeenCalledWith(expect.objectContaining({
      clientId: 'client-1',
      type: 'frp_remove_proxy',
      payload: { mappingId: 'pm_old_file' },
    }));
    expect(connectionManager.sendToClient).toHaveBeenCalledWith('client-1', expect.objectContaining({
      payload: expect.objectContaining({ taskType: 'frp_remove_proxy' }),
    }));

    // Main flow: file service start
    expect(tasksService.createTask).toHaveBeenCalledWith(expect.objectContaining({
      clientId: 'client-1',
      type: 'file_service_start',
      payload: expect.objectContaining({ token: expect.any(String) }),
    }));
    expect(connectionManager.sendToClient).toHaveBeenCalledWith('client-1', expect.objectContaining({
      payload: expect.objectContaining({ taskType: 'file_service_start' }),
    }));

    // Main flow: FRP mapping created
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

  it('reuses a healthy pre-created session after checking direct URL health', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({ roots: [] }), { status: 200 })));

    const tasksService = { createTask: vi.fn(), getTask: vi.fn() };
    const connectionManager = { sendToClient: vi.fn() };
    const frpService = { listMappings: vi.fn().mockReturnValue([]), deleteMapping: vi.fn(), createMapping: vi.fn(), toApi: vi.fn() };

    const service = new ClientFileSessionsService({ tasksService, connectionManager, frpService } as never);

    // Pre-register a session (simulating what FileHttpAutoMappingProvider does)
    service.registerPreCreatedSession({
      clientId: 'client-1',
      token: 'pre-created-token',
      localPort: 45123,
      mappingId: 'pm-auto',
      publicUrl: 'http://frps.example.com:23001',
      startedAt: Date.now() - 1000,
      expiresAt: Date.now() + 25 * 60 * 1000,
    });

    const session = await service.startSession('client-1');

    // Should reuse the pre-created session only after confirming the direct URL works.
    expect(fetch).toHaveBeenCalledWith('http://frps.example.com:23001/v1/roots', expect.objectContaining({
      headers: { Authorization: 'Bearer pre-created-token' },
    }));
    expect(tasksService.createTask).not.toHaveBeenCalled();
    expect(frpService.createMapping).not.toHaveBeenCalled();
    expect(connectionManager.sendToClient).not.toHaveBeenCalled();
    expect(session).toEqual(expect.objectContaining({
      clientId: 'client-1',
      token: 'pre-created-token',
      mappingId: 'pm-auto',
      publicUrl: 'http://frps.example.com:23001',
    }));
  });

  it('recreates a pre-created session when its direct URL is not reachable', async () => {
    vi.stubGlobal('fetch', vi.fn()
      .mockRejectedValueOnce(new Error('fetch failed'))
      .mockResolvedValue(new Response(JSON.stringify({ roots: [] }), { status: 200 })));

    const tasksService = {
      createTask: vi.fn()
        .mockReturnValueOnce({ id: 'task_start_file', client_id: 'client-1' })
        .mockReturnValueOnce({ id: 'task_frp_file', client_id: 'client-1' }),
      getTask: vi.fn((taskId: string) => ({
        id: taskId,
        status: 'success',
        result: taskId === 'task_start_file'
          ? JSON.stringify({ running: true, host: '127.0.0.1', port: 45200, startedAt: 2000 })
          : JSON.stringify({ ok: true }),
      })),
    };
    const connectionManager = { sendToClient: vi.fn().mockReturnValue(true) };
    const frpService = {
      listMappings: vi.fn().mockReturnValue([]),
      deleteMapping: vi.fn(),
      createMapping: vi.fn().mockReturnValue({
        id: 'pm_new',
        client_id: 'client-1',
        name: 'file-service-client-1-new0001',
        proxy_type: 'tcp',
        local_ip: '127.0.0.1',
        local_port: 45200,
        remote_port: 23010,
        custom_domain: null,
        status: 'inactive',
        public_url: 'http://127.0.0.1:23010',
        created_at: 2000,
        updated_at: 2000,
      }),
      toApi: vi.fn((mapping) => ({ publicUrl: mapping.public_url, id: mapping.id, name: mapping.name, proxyType: mapping.proxy_type, remotePort: mapping.remote_port })),
    };

    const service = new ClientFileSessionsService({ tasksService, connectionManager, frpService } as never);
    service.registerPreCreatedSession({
      clientId: 'client-1',
      token: 'stale-token',
      localPort: 45123,
      mappingId: 'pm-stale',
      publicUrl: 'http://frps.example.com:23001',
      startedAt: Date.now() - 1000,
      expiresAt: Date.now() + 25 * 60 * 1000,
    });

    const session = await service.startSession('client-1');

    expect(frpService.createMapping).toHaveBeenCalledTimes(1);
    expect(session).toEqual(expect.objectContaining({
      clientId: 'client-1',
      mappingId: 'pm_new',
      publicUrl: 'http://127.0.0.1:23010',
    }));
  });

  it('recreates session when pre-created session has expired', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({ roots: [] }), { status: 200 })));

    const tasksService = {
      createTask: vi.fn()
        .mockReturnValueOnce({ id: 'task_start_file', client_id: 'client-1' })
        .mockReturnValueOnce({ id: 'task_frp_file', client_id: 'client-1' }),
      getTask: vi.fn((taskId: string) => ({
        id: taskId,
        status: 'success',
        result: taskId === 'task_start_file'
          ? JSON.stringify({ running: true, host: '127.0.0.1', port: 45200, startedAt: 2000 })
          : JSON.stringify({ ok: true }),
      })),
    };
    const connectionManager = { sendToClient: vi.fn().mockReturnValue(true) };
    const frpService = {
      listMappings: vi.fn().mockReturnValue([]),
      deleteMapping: vi.fn(),
      createMapping: vi.fn().mockReturnValue({
        id: 'pm_new',
        client_id: 'client-1',
        name: 'file-service-client-1-new0001',
        proxy_type: 'tcp',
        local_ip: '127.0.0.1',
        local_port: 45200,
        remote_port: 23010,
        custom_domain: null,
        status: 'inactive',
        public_url: 'http://127.0.0.1:23010',
        created_at: 2000,
        updated_at: 2000,
      }),
      toApi: vi.fn((mapping) => ({ publicUrl: mapping.public_url, id: mapping.id, name: mapping.name, proxyType: mapping.proxy_type, remotePort: mapping.remote_port })),
    };

    const service = new ClientFileSessionsService({ tasksService, connectionManager, frpService } as never);

    // Pre-register an EXPIRED session
    service.registerPreCreatedSession({
      clientId: 'client-1',
      token: 'expired-token',
      localPort: 45123,
      mappingId: 'pm-expired',
      publicUrl: 'http://frps.example.com:23001',
      startedAt: Date.now() - 35 * 60 * 1000, // 35 minutes ago
      expiresAt: Date.now() - 5 * 60 * 1000, // expired 5 minutes ago
    });

    const session = await service.startSession('client-1');

    // Should create a new session since the old one expired
    expect(tasksService.createTask).toHaveBeenCalled();
    expect(frpService.createMapping).toHaveBeenCalled();
    expect(session).toEqual(expect.objectContaining({
      clientId: 'client-1',
      localPort: 45200,
      mappingId: 'pm_new',
    }));
  });

  it('cleans up old file service mappings in the background (fire-and-forget)', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({ roots: [] }), { status: 200 })));

    // When no pre-created session exists, startSession should create one from scratch
    // and clean up old mappings in the background
    let taskCounter = 0;
    const tasksService = {
      createTask: vi.fn().mockImplementation(() => {
        taskCounter++;
        return { id: `task_${taskCounter}`, client_id: 'client-1' };
      }),
      getTask: vi.fn((taskId: string) => {
        const result = taskId === 'task_2' // task_2 = file_service_start
          ? { id: taskId, status: 'success' as const, result: JSON.stringify({ running: true, host: '127.0.0.1', port: 45123, startedAt: 1000 }) }
          : { id: taskId, status: 'success' as const, result: JSON.stringify({ ok: true }) };
        return result;
      }),
    };
    const connectionManager = { sendToClient: vi.fn().mockReturnValue(true) };
    const frpService = {
      listMappings: vi.fn().mockReturnValue([
        { id: 'pm_old_file_1', client_id: 'client-1', name: 'file-service-client-1-stale0001', proxy_type: 'tcp', remote_port: 23000 },
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
    const session = await service.startSession('client-1');

    // Old mappings should be deleted from DB immediately (synchronous in background)
    expect(frpService.deleteMapping).toHaveBeenCalledWith('pm_old_file_1');
    // New file service mapping should be created
    expect(frpService.createMapping).toHaveBeenCalledTimes(1);
    expect(session).toEqual(expect.objectContaining({
      mappingId: 'pm_file',
      localPort: 45123,
    }));
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

  it('reuses a healthy non-pre-created session', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({ roots: [] }), { status: 200 })));

    const tasksService = { createTask: vi.fn(), getTask: vi.fn() };
    const connectionManager = { sendToClient: vi.fn() };
    const frpService = { listMappings: vi.fn().mockReturnValue([]), deleteMapping: vi.fn(), createMapping: vi.fn(), toApi: vi.fn() };

    const service = new ClientFileSessionsService({ tasksService, connectionManager, frpService } as never);
    // Non-pre-created session: startedAt is 0 (legacy), so it goes through health check path
    const existingSession = {
      clientId: 'client-1',
      token: 'healthy-token',
      localPort: 45123,
      mappingId: 'pm_healthy',
      publicUrl: 'http://127.0.0.1:23001',
      startedAt: 0,
      expiresAt: Date.now() + 29 * 60 * 1000,
    };
    (service as unknown as { sessions: Map<string, unknown> }).sessions.set('client-1', existingSession);

    const session = await service.startSession('client-1');

    // Should reuse existing session after health check
    expect(tasksService.createTask).not.toHaveBeenCalled();
    expect(frpService.createMapping).not.toHaveBeenCalled();
    expect(session).toEqual(expect.objectContaining({
      token: 'healthy-token',
      mappingId: 'pm_healthy',
      localPort: 45123,
    }));
  });
});