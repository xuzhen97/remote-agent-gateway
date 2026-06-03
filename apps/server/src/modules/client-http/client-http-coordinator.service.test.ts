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
});
