import { describe, expect, it, vi } from 'vitest';
import { ClientFileSessionsService } from './client-file-sessions.service.js';

describe('ClientFileSessionsService', () => {
  it('creates a start task and FRP mapping when no session exists', async () => {
    const tasksService = {
      createTask: vi.fn()
        .mockReturnValueOnce({ id: 'task_start_file', client_id: 'client-1' })
        .mockReturnValueOnce({ id: 'task_frp_file', client_id: 'client-1' }),
      getTask: vi.fn().mockReturnValue({
        id: 'task_start_file',
        status: 'success',
        result: JSON.stringify({ running: true, host: '127.0.0.1', port: 45123, startedAt: 1000 }),
      }),
    };
    const connectionManager = { sendToClient: vi.fn().mockReturnValue(true) };
    const frpService = {
      createMapping: vi.fn().mockReturnValue({
        id: 'pm_file',
        client_id: 'client-1',
        name: 'file-service-client-1',
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
      toApi: vi.fn((mapping) => ({ publicUrl: mapping.public_url, id: mapping.id })),
    };

    const service = new ClientFileSessionsService({ tasksService, connectionManager, frpService } as never);
    const session = await service.startSession('client-1');

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
      name: 'file-service-client-1',
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
});
