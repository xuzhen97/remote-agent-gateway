import { beforeEach, describe, expect, it, vi } from 'vitest';
import { initDb, getDb } from '../../db/index.js';
import { NoAvailablePortError, PortAllocatorService } from './port-allocator.service.js';

describe('PortAllocatorService', () => {
  beforeEach(async () => {
    await initDb();
    const db = getDb();
    db.run('DELETE FROM port_mappings');
    db.run('DELETE FROM audit_logs');
  });

  it('returns the first free port when db and dashboard are empty', async () => {
    const service = new PortAllocatorService({
      portRange: { start: 23000, end: 23002 },
      listFrpsProxies: vi.fn().mockResolvedValue({ dashboardReachable: true, proxies: [] }),
      auditLog: vi.fn(),
    });

    await expect(service.allocate('client-1')).resolves.toBe(23000);
  });

  it('skips db-used ports and dashboard-used ports', async () => {
    const db = getDb();
    const now = Date.now();
    db.run(
      `INSERT INTO port_mappings (id, client_id, name, proxy_type, local_ip, local_port, remote_port, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ['pm-used', 'client-1', 'used', 'tcp', '127.0.0.1', 3000, 23000, 'active', now, now],
    );

    const service = new PortAllocatorService({
      portRange: { start: 23000, end: 23002 },
      listFrpsProxies: vi.fn().mockResolvedValue({
        dashboardReachable: true,
        proxies: [{ name: 'external-http', proxyType: 'http', remotePort: 23001 }],
      }),
      auditLog: vi.fn(),
    });

    await expect(service.allocate('client-1')).resolves.toBe(23002);
  });

  it('writes an audit log when dashboard shows an external occupied port', async () => {
    const auditLog = vi.fn();
    const service = new PortAllocatorService({
      portRange: { start: 23000, end: 23001 },
      listFrpsProxies: vi.fn().mockResolvedValue({
        dashboardReachable: true,
        proxies: [{ name: 'manual-proxy', proxyType: 'tcp', remotePort: 23000 }],
      }),
      auditLog,
    });

    await expect(service.allocate('client-1')).resolves.toBe(23001);
    expect(auditLog).toHaveBeenCalledWith(expect.objectContaining({
      action: 'port_allocator.external_occupy',
      detail: expect.stringContaining('23000'),
    }));
  });

  it('falls back to db-only allocation when dashboard is unreachable', async () => {
    const auditLog = vi.fn();
    const service = new PortAllocatorService({
      portRange: { start: 23000, end: 23001 },
      listFrpsProxies: vi.fn().mockResolvedValue({
        dashboardReachable: false,
        proxies: [],
        detail: 'connect ECONNREFUSED',
      }),
      auditLog,
    });

    await expect(service.allocate('client-1')).resolves.toBe(23000);
    expect(auditLog).toHaveBeenCalledWith(expect.objectContaining({
      action: 'port_allocator.dashboard_unreachable',
    }));
  });

  it('throws a PortConflictError when preferred port is already used', async () => {
    const service = new PortAllocatorService({
      portRange: { start: 23000, end: 23002 },
      listFrpsProxies: vi.fn().mockResolvedValue({
        dashboardReachable: true,
        proxies: [{ name: 'manual-proxy', proxyType: 'tcp', remotePort: 23001 }],
      }),
      auditLog: vi.fn(),
    });

    await expect(service.allocate('client-1', { preferredPort: 23001 })).rejects.toMatchObject({
      name: 'PortConflictError',
      source: 'dashboard',
      port: 23001,
    });
  });

  it('throws NoAvailablePortError when the range is exhausted', async () => {
    const service = new PortAllocatorService({
      portRange: { start: 23000, end: 23000 },
      listFrpsProxies: vi.fn().mockResolvedValue({
        dashboardReachable: true,
        proxies: [{ name: 'manual-proxy', proxyType: 'tcp', remotePort: 23000 }],
      }),
      auditLog: vi.fn(),
    });

    await expect(service.allocate('client-1')).rejects.toBeInstanceOf(NoAvailablePortError);
  });

  it('serializes concurrent allocations so they never return the same port', async () => {
    const service = new PortAllocatorService({
      portRange: { start: 23000, end: 23002 },
      listFrpsProxies: vi.fn().mockResolvedValue({ dashboardReachable: true, proxies: [] }),
      auditLog: vi.fn(),
      reservePort: vi.fn(async (port: number) => {
        getDb().run(
          `INSERT INTO port_mappings (id, client_id, name, proxy_type, local_ip, local_port, remote_port, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [`pm-${port}`, 'client-1', `mapping-${port}`, 'tcp', '127.0.0.1', 3000, port, 'inactive', Date.now(), Date.now()],
        );
      }),
    });

    const [first, second] = await Promise.all([
      service.allocate('client-1'),
      service.allocate('client-1'),
    ]);

    expect(first).toBe(23000);
    expect(second).toBe(23001);
  });

  it('allows a client http control port to remain sticky for the same client when only its own control proxy uses that port', async () => {
    const db = getDb();
    const now = Date.now();
    db.run(
      `INSERT INTO clients (id, name, status, http_remote_port, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)`,
      ['client-1', 'client-1', 'online', 23000, now, now],
    );

    const service = new PortAllocatorService({
      portRange: { start: 23000, end: 23002 },
      listFrpsProxies: vi.fn().mockResolvedValue({
        dashboardReachable: true,
        proxies: [{ name: 'rag-client-1-http-control', proxyType: 'tcp', remotePort: 23000 }],
      }),
      auditLog: vi.fn(),
    });

    await expect(service.isAvailableForClientHttp(23000, 'client-1')).resolves.toBe(true);
  });

  it('rejects a sticky client http port reuse when a business mapping already uses that port', async () => {
    const db = getDb();
    const now = Date.now();
    db.run('DELETE FROM clients');
    db.run(
      `INSERT INTO clients (id, name, status, http_remote_port, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)`,
      ['client-1', 'client-1', 'online', 23000, now, now],
    );
    db.run(
      `INSERT INTO port_mappings (id, client_id, name, proxy_type, local_ip, local_port, remote_port, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ['pm-used', 'other-client', 'used', 'tcp', '127.0.0.1', 3000, 23000, 'active', now, now],
    );

    const service = new PortAllocatorService({
      portRange: { start: 23000, end: 23002 },
      listFrpsProxies: vi.fn().mockResolvedValue({
        dashboardReachable: true,
        proxies: [{ name: 'rag-client-1-http-control', proxyType: 'tcp', remotePort: 23000 }],
      }),
      auditLog: vi.fn(),
    });

    await expect(service.isAvailableForClientHttp(23000, 'client-1')).resolves.toBe(false);
  });
});
