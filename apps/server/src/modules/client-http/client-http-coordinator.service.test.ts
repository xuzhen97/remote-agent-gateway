import { describe, expect, it, vi } from 'vitest';
import { ClientHttpCoordinatorService } from './client-http-coordinator.service.js';

function makeService(overrides: Partial<ConstructorParameters<typeof ClientHttpCoordinatorService>[0]> = {}) {
  const clients = new Map<string, any>();
  return new ClientHttpCoordinatorService({
    frpsPublicHost: 'frps.example.com',
    tokenSecret: 'secret',
    tokenVersion: 1,
    getClient: (clientId) => clients.get(clientId) ?? undefined,
    updateClientHttp: (clientId, patch) => {
      const current = clients.get(clientId) ?? { id: clientId };
      clients.set(clientId, { ...current, ...patch });
    },
    isHttpPortAvailable: vi.fn(async (port: number, _clientId: string) => port !== 20002),
    allocatePort: vi.fn(async () => 20003),
    ...overrides,
  });
}

describe('ClientHttpCoordinatorService', () => {
  it('allocates a new sticky HTTP endpoint for first registration', async () => {
    const allocatePort = vi.fn(async () => 20001);
    const service = makeService({ allocatePort });
    const result = await service.coordinate('client-1', { localHost: '127.0.0.1', localPort: 17890, protocol: 'http' });

    expect(result.remotePort).toBe(20001);
    expect(result.publicBaseUrl).toBe('http://frps.example.com:20001');
    expect(result.reused).toBe(false);
  });

  it('reuses historical port when available', async () => {
    const getClient = vi.fn(() => ({ id: 'client-1', http_remote_port: 20001 }));
    const service = makeService({ getClient, isHttpPortAvailable: vi.fn(async () => true) });
    const result = await service.coordinate('client-1', { localHost: '127.0.0.1', localPort: 17890, protocol: 'http' });

    expect(result.remotePort).toBe(20001);
    expect(result.reused).toBe(true);
  });

  it('reallocates when historical port conflicts', async () => {
    const getClient = vi.fn(() => ({ id: 'client-1', http_remote_port: 20002 }));
    const allocatePort = vi.fn(async () => 20004);
    const service = makeService({ getClient, isHttpPortAvailable: vi.fn(async () => false), allocatePort });
    const result = await service.coordinate('client-1', { localHost: '127.0.0.1', localPort: 17890, protocol: 'http' });

    expect(result.remotePort).toBe(20004);
    expect(result.reused).toBe(false);
  });

  it('reserves allocated http ports during coordination so concurrent clients do not receive the same port', async () => {
    const clients = new Map<string, any>();
    const usedPorts = new Set<number>();
    const allocatePort = vi.fn(async (_clientId: string, options?: { preferredPort?: number; reserve?: (port: number, clientId: string) => Promise<void> | void }) => {
      const port = usedPorts.has(20001) ? 20002 : 20001;
      if (options?.reserve) {
        await options.reserve(port, _clientId);
        usedPorts.add(port);
      }
      return port;
    });
    const service = new ClientHttpCoordinatorService({
      frpsPublicHost: 'frps.example.com',
      tokenSecret: 'secret',
      tokenVersion: 1,
      getClient: (clientId) => clients.get(clientId) ?? undefined,
      updateClientHttp: (clientId, patch) => {
        const current = clients.get(clientId) ?? { id: clientId };
        clients.set(clientId, { ...current, ...patch });
      },
      isHttpPortAvailable: vi.fn(async () => false),
      allocatePort: allocatePort as any,
    });

    const [first, second] = await Promise.all([
      service.coordinate('client-1', { localHost: '127.0.0.1', localPort: 17890, protocol: 'http' }),
      service.coordinate('client-2', { localHost: '127.0.0.1', localPort: 17891, protocol: 'http' }),
    ]);

    expect(new Set([first.remotePort, second.remotePort])).toEqual(new Set([20001, 20002]));
    expect(usedPorts).toEqual(new Set([20001, 20002]));
    expect(clients.get('client-1')?.remotePort).toBe(20001);
    expect(clients.get('client-2')?.remotePort).toBe(20002);
    expect(allocatePort).toHaveBeenCalledWith('client-1', expect.objectContaining({ reserve: expect.any(Function) }));
    expect(allocatePort).toHaveBeenCalledWith('client-2', expect.objectContaining({ reserve: expect.any(Function) }));
  });
});
