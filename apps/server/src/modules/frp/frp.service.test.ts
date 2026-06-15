import { beforeEach, describe, expect, it, vi } from 'vitest';
import { initDb, getDb } from '../../db/index.js';
import { buildFrpPublicUrl } from '../../config/env.js';
import { FrpService } from './frp.service.js';

const { allocateMock } = vi.hoisted(() => ({
  allocateMock: vi.fn(),
}));

vi.mock('../ports/port-allocator.service.js', () => ({
  portAllocatorService: {
    allocate: allocateMock,
    release: vi.fn(),
  },
}));

describe('FrpService', () => {
  beforeEach(async () => {
    await initDb();
    const db = getDb();
    db.run('DELETE FROM port_mappings');
    allocateMock.mockReset();
  });

  it('delegates automatic remote port selection to the allocator', async () => {
    allocateMock.mockImplementation(async (clientId: string, options?: { reserve?: (port: number, clientId: string) => void | Promise<void> }) => {
      await options?.reserve?.(23010, clientId);
      return 23010;
    });
    const service = new FrpService();

    const mapping = await service.createMapping({
      clientId: 'client-1',
      name: 'http-mapping',
      proxyType: 'http',
      localIp: '127.0.0.1',
      localPort: 3001,
    });

    expect(allocateMock).toHaveBeenCalledWith('client-1', expect.objectContaining({ reserve: expect.any(Function) }));
    expect(mapping.remote_port).toBe(23010);
    expect(mapping.public_url).toBe(buildFrpPublicUrl(23010, { proxyType: 'http' }));
  });

  it('delegates preferred remote port validation to the allocator', async () => {
    allocateMock.mockImplementation(async (clientId: string, options?: { preferredPort?: number; reserve?: (port: number, clientId: string) => void | Promise<void> }) => {
      await options?.reserve?.(23011, clientId);
      return 23011;
    });
    const service = new FrpService();

    const mapping = await service.createMapping({
      clientId: 'client-1',
      name: 'tcp-mapping',
      proxyType: 'tcp',
      localIp: '127.0.0.1',
      localPort: 3000,
      remotePort: 23011,
    });

    expect(allocateMock).toHaveBeenCalledWith('client-1', expect.objectContaining({ preferredPort: 23011, reserve: expect.any(Function) }));
    expect(mapping.remote_port).toBe(23011);
    expect(mapping.public_url).toBe(buildFrpPublicUrl(23011, { proxyType: 'tcp' }));
  });

  it('builds protocol-aware public urls with custom domains', async () => {
    allocateMock.mockImplementation(async (clientId: string, options?: { reserve?: (port: number, clientId: string) => void | Promise<void> }) => {
      await options?.reserve?.(23012, clientId);
      return 23012;
    });
    const service = new FrpService();

    const mapping = await service.createMapping({
      clientId: 'client-1',
      name: 'https-mapping',
      proxyType: 'https',
      localIp: '127.0.0.1',
      localPort: 3002,
      customDomain: 'secure.example.com',
    });

    expect(mapping.public_url).toBe('https://secure.example.com');
  });
});
