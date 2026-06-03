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
  markHttpReadyMock,
  markHttpFailedMock,
} = vi.hoisted(() => ({
  upsertClientMock: vi.fn(),
  registerConnectionMock: vi.fn(),
  autoOnlineMock: vi.fn().mockResolvedValue(undefined),
  autoOfflineMock: vi.fn().mockResolvedValue(undefined),
  wsSendMock: vi.fn(),
  setOfflineMock: vi.fn(),
  removeConnectionMock: vi.fn(),
  markHttpReadyMock: vi.fn(),
  markHttpFailedMock: vi.fn(),
}));

vi.mock('../modules/clients/clients.service.js', () => ({
  clientsService: {
    upsertClient: upsertClientMock,
    updateHeartbeat: vi.fn(),
    setOffline: setOfflineMock,
    markHttpReady: markHttpReadyMock,
    markHttpFailed: markHttpFailedMock,
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
    vi.clearAllMocks();
    autoOnlineMock.mockResolvedValue(undefined);
    autoOfflineMock.mockResolvedValue(undefined);
  });

  it('sends registration ack with FRP config before starting auto mappings', async () => {
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
    const ackCall = wsSendMock.mock.calls.find(([payload]) => String(payload).includes('server.ack'));
    expect(ackCall?.[0]).toContain('frps.example.com');
    expect(autoOnlineMock).toHaveBeenCalledWith('client-1');

    const ackOrder = wsSendMock.mock.invocationCallOrder[0];
    const autoOrder = autoOnlineMock.mock.invocationCallOrder[0];
    expect(ackOrder).toBeLessThan(autoOrder);
  });

  it('marks auto mappings pending cleanup on websocket close', async () => {
    handleWsClose('client-1');
    await Promise.resolve();
    expect(removeConnectionMock).toHaveBeenCalledWith('client-1');
    expect(setOfflineMock).toHaveBeenCalledWith('client-1');
    expect(autoOfflineMock).toHaveBeenCalledWith('client-1');
  });

  it('ignores task.log messages for tasks that were already deleted', async () => {
    const { tasksService } = await import('../modules/tasks/tasks.service.js');
    const addLogMock = vi.mocked(tasksService.addLog);
    const getTaskMock = vi.mocked(tasksService.getTask);

    addLogMock.mockReset();
    getTaskMock.mockReset();
    getTaskMock.mockReturnValue(undefined);

    const ws = { send: wsSendMock } as never;

    await handleWsMessage(ws, JSON.stringify({
      type: 'task.log',
      requestId: 'log_1',
      payload: {
        taskId: 'task_deleted',
        stream: 'stdout',
        content: 'still running on client',
      },
    }));

    expect(getTaskMock).toHaveBeenCalledWith('task_deleted');
    expect(addLogMock).not.toHaveBeenCalled();
    expect(wsSendMock).not.toHaveBeenCalledWith(expect.stringContaining('server.error'));
  });
});

describe('client HTTP control over WS', () => {
  const { clientHttpCoordinatorService } = vi.hoisted(() => {
    const coordinateMock = vi.fn(async (clientId: string, http: unknown) => ({
      localHost: '127.0.0.1',
      localPort: 17890,
      remotePort: 20317,
      publicBaseUrl: 'http://frps.example.com:20317',
      token: 'client-token-client-token',
      reused: false,
    }));
    return { clientHttpCoordinatorService: { coordinate: coordinateMock } };
  });

  vi.mock('../modules/client-http/client-http-coordinator.service.js', () => ({
    clientHttpCoordinatorService,
  }));

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns HTTP control coordination in register ack', async () => {
    const ws = { send: wsSendMock } as never;

    await handleWsMessage(ws, JSON.stringify({
      type: 'client.register',
      requestId: 'reg_1',
      payload: {
        clientId: 'client-1',
        name: 'Client 1',
        http: { localHost: '127.0.0.1', localPort: 17890, protocol: 'http' },
        capabilities: { httpControl: true, jobs: true, sse: true, files: true, frpMappings: true },
      },
    }));

    const sent = JSON.parse(wsSendMock.mock.calls.at(-1)![0]);
    expect(sent.type).toBe('server.ack');
    expect(sent.payload.httpControl.remotePort).toBe(20317);
    expect(sent.payload.httpControl.publicBaseUrl).toMatch(/^http:\/\//);
    expect(sent.payload.httpControl.token).toBeTruthy();
  });

  it('marks client HTTP ready', async () => {
    const ws = { send: wsSendMock } as never;
    await handleWsMessage(ws, JSON.stringify({
      type: 'client.http_ready',
      requestId: 'ready_1',
      payload: { clientId: 'client-1', remotePort: 20317, baseUrl: 'http://frps.example.com:20317' },
    }));

    const sent = JSON.parse(wsSendMock.mock.calls.at(-1)![0]);
    expect(sent.payload.message).toBe('HTTP endpoint ready');
    expect(markHttpReadyMock).toHaveBeenCalledWith('client-1', 'http://frps.example.com:20317', 20317);
  });

  it('marks client HTTP failure', async () => {
    const ws = { send: wsSendMock } as never;
    await handleWsMessage(ws, JSON.stringify({
      type: 'client.http_failed',
      requestId: 'failed_1',
      payload: { clientId: 'client-1', remotePort: 20317, reason: 'frpc failed' },
    }));

    const sent = JSON.parse(wsSendMock.mock.calls.at(-1)![0]);
    expect(sent.payload.message).toBe('HTTP endpoint failure recorded');
    expect(markHttpFailedMock).toHaveBeenCalledWith('client-1');
  });
});
