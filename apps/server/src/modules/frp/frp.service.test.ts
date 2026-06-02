import { beforeEach, describe, expect, it, vi } from 'vitest';
import { initDb } from '../../db/index.js';
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
    allocateMock.mockReset();
  });

  it('delegates automatic remote port selection to the allocator', async () => {
    allocateMock.mockResolvedValue(23010);
    const service = new FrpService();

    const mapping = await service.createMapping({
      clientId: 'client-1',
      name: 'http-mapping',
      proxyType: 'http',
      localIp: '127.0.0.1',
      localPort: 3001,
    });

    expect(allocateMock).toHaveBeenCalledWith('client-1', undefined);
    expect(mapping.remote_port).toBe(23010);
    expect(mapping.public_url).toBe('http://your-server-ip:23010');
  });

  it('delegates preferred remote port validation to the allocator', async () => {
    allocateMock.mockResolvedValue(23011);
    const service = new FrpService();

    const mapping = await service.createMapping({
      clientId: 'client-1',
      name: 'tcp-mapping',
      proxyType: 'tcp',
      localIp: '127.0.0.1',
      localPort: 3000,
      remotePort: 23011,
    });

    expect(allocateMock).toHaveBeenCalledWith('client-1', { preferredPort: 23011 });
    expect(mapping.remote_port).toBe(23011);
    expect(mapping.public_url).toBe('your-server-ip:23011');
  });

  it('builds protocol-aware public urls with custom domains', async () => {
    allocateMock.mockResolvedValue(23012);
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
