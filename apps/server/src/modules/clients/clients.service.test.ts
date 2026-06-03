import { beforeEach, describe, expect, it, vi } from 'vitest';
import initSqlJs, { type Database } from 'sql.js';
import { migrate } from '../../db/migrate.js';

const state = vi.hoisted(() => ({
  db: null as Database | null,
}));

vi.mock('../../db/index.js', () => ({
  getDb: () => {
    if (!state.db) throw new Error('test database not initialized');
    return state.db;
  },
}));

import { ClientsService } from './clients.service.js';

function insertClient(params: { id: string; status: 'online' | 'offline'; updatedAt: number }): void {
  state.db!.run(
    `INSERT INTO clients (id, name, status, last_seen_at, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)`,
    [params.id, params.id, params.status, params.updatedAt, params.updatedAt, params.updatedAt],
  );
}

function insertMapping(params: { id: string; clientId: string; remotePort: number }): void {
  const now = 1_000_000;
  state.db!.run(
    `INSERT INTO port_mappings (id, client_id, name, proxy_type, local_ip, local_port, remote_port, status, public_url, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [params.id, params.clientId, params.id, 'tcp', '127.0.0.1', 3000, params.remotePort, 'inactive', `127.0.0.1:${params.remotePort}`, now, now],
  );
}

describe('ClientsService', () => {
  let service: ClientsService;

  beforeEach(async () => {
    const SQL = await initSqlJs();
    state.db = new SQL.Database();
    migrate(state.db);
    service = new ClientsService();
  });

  it('deletes only offline clients older than the retention window', () => {
    const now = 1_000_000;
    insertClient({ id: 'stale-offline', status: 'offline', updatedAt: now - 120_000 });
    insertClient({ id: 'fresh-offline', status: 'offline', updatedAt: now - 10_000 });
    insertClient({ id: 'stale-online', status: 'online', updatedAt: now - 120_000 });

    const deleted = service.deleteOfflineClientsOlderThan(now - 60_000);

    expect(deleted).toBe(1);
    expect(service.getClient('stale-offline')).toBeUndefined();
    expect(service.getClient('fresh-offline')).toBeDefined();
    expect(service.getClient('stale-online')).toBeDefined();
  });

  it('deletes a client and related mappings, leaving other clients intact', () => {
    insertClient({ id: 'offline-client', status: 'offline', updatedAt: 1_000_000 });
    insertClient({ id: 'other-client', status: 'offline', updatedAt: 1_000_000 });
    insertMapping({ id: 'pm_offline', clientId: 'offline-client', remotePort: 20001 });
    insertMapping({ id: 'pm_other', clientId: 'other-client', remotePort: 20002 });

    const summary = service.deleteClientCascade('offline-client');

    expect(summary).toEqual({ deletedMappings: 1 });
    expect(service.getClient('offline-client')).toBeUndefined();
    expect(service.getClient('other-client')).toBeDefined();

    const pmResult = state.db!.exec("SELECT id FROM port_mappings WHERE client_id = 'offline-client'");
    expect(pmResult.length).toBe(0);

    const pmOther = state.db!.exec("SELECT id FROM port_mappings WHERE client_id = 'other-client'");
    expect(pmOther[0].values).toEqual([['pm_other']]);
  });

  it('does not delete unrelated data when deleting a missing client', () => {
    insertClient({ id: 'other-client', status: 'offline', updatedAt: 1_000_000 });

    const summary = service.deleteClientCascade('missing-client');

    expect(summary).toEqual({ deletedMappings: 0 });
    expect(service.getClient('missing-client')).toBeUndefined();
    expect(service.getClient('other-client')).toBeDefined();
  });

  it('keeps online status visible for callers that must reject online deletion before cleanup', () => {
    insertClient({ id: 'online-client', status: 'online', updatedAt: 1_000_000 });

    const client = service.getClient('online-client');

    expect(client?.status).toBe('online');
  });
});
