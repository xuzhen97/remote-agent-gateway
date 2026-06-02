import { beforeEach, describe, expect, it, vi } from 'vitest';
import { handleWsClose, handleWsMessage } from './ws-handlers.js';

const {
  upsertClientMock,
  registerConnectionMock,
  autoOnlineMock,
  autoOfflineMock,
  wsSendMock,
  setOfflineMock,
  removeConnectionMock,
} = vi.hoisted(() => ({
  upsertClientMock: vi.fn(),
  registerConnectionMock: vi.fn(),
  autoOnlineMock: vi.fn().mockResolvedValue(undefined),
  autoOfflineMock: vi.fn().mockResolvedValue(undefined),
  wsSendMock: vi.fn(),
  setOfflineMock: vi.fn(),
  removeConnectionMock: vi.fn(),
}));

vi.mock('../modules/clients/clients.service.js', () => ({
  clientsService: {
    upsertClient: upsertClientMock,
    updateHeartbeat: vi.fn(),
    setOffline: setOfflineMock,
  },
}));
vi.mock('../modules/connections/connections.manager.js', () => ({
  connectionManager: { register: registerConnectionMock, remove: removeConnectionMock },
}));
vi.mock('../modules/audit/audit.service.js', () => ({ auditService: { log: vi.fn() } }));
vi.mock('../modules/tasks/tasks.service.js', () => ({ tasksService: { updateTaskStatus: vi.fn(), addLog: vi.fn(), getTask: vi.fn() } }));
vi.mock('../modules/frp/frp.service.js', () => ({ frpService: { getMapping: vi.fn(), updateMappingStatus: vi.fn(), deleteMapping: vi.fn() }, getFrpsConnectionInfo: vi.fn(() => ({ serverAddr: 'frps.example.com', serverPort: 7000, authToken: 'frp-token' })) }));
vi.mock('../modules/auto-mapping/auto-mapping.service.js', () => ({
  autoMappingService: { onClientOnline: autoOnlineMock, onClientOffline: autoOfflineMock },
}));
vi.mock('../db/index.js', () => ({ saveDb: vi.fn() }));

describe('ws handlers auto mapping lifecycle', () => {
  beforeEach(() => {
    upsertClientMock.mockReset();
    registerConnectionMock.mockReset();
    autoOnlineMock.mockReset();
    autoOnlineMock.mockResolvedValue(undefined);
    autoOfflineMock.mockReset();
    autoOfflineMock.mockResolvedValue(undefined);
    wsSendMock.mockReset();
    setOfflineMock.mockReset();
    removeConnectionMock.mockReset();
  });

  it('starts auto mappings after client.register succeeds', async () => {
    const ws = { send: wsSendMock } as never;

    await handleWsMessage(ws, JSON.stringify({
      type: 'client.register',
      requestId: 'reg_1',
      payload: {
        clientId: 'client-1',
        name: 'Client 1',
        hostname: 'client-host',
        os: 'linux',
        arch: 'x64',
        version: '0.1.0',
        tags: [],
      },
    }));

    expect(upsertClientMock).toHaveBeenCalledWith(expect.objectContaining({ clientId: 'client-1' }));
    expect(registerConnectionMock).toHaveBeenCalledWith('client-1', ws);
    expect(autoOnlineMock).toHaveBeenCalledWith('client-1');
    expect(wsSendMock).toHaveBeenCalledWith(expect.stringContaining('server.ack'));
  });

  it('marks auto mappings pending cleanup on websocket close', async () => {
    handleWsClose('client-1');
    await Promise.resolve();
    expect(removeConnectionMock).toHaveBeenCalledWith('client-1');
    expect(setOfflineMock).toHaveBeenCalledWith('client-1');
    expect(autoOfflineMock).toHaveBeenCalledWith('client-1');
  });
});
