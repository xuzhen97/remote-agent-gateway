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

function insertTask(params: { id: string; clientId: string }): void {
  const now = 1_000_000;
  state.db!.run(
    `INSERT INTO tasks (id, client_id, type, status, payload, created_at) VALUES (?, ?, ?, ?, ?, ?)`,
    [params.id, params.clientId, 'exec_script', 'pending', '{}', now],
  );
}

function insertTaskLog(params: { taskId: string; content: string }): void {
  state.db!.run(
    `INSERT INTO task_logs (task_id, stream, content, created_at) VALUES (?, ?, ?, ?)`,
    [params.taskId, 'stdout', params.content, 1_000_000],
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

  it('deletes a client and all related mappings, tasks, and task logs, leaving other clients intact', () => {
    insertClient({ id: 'offline-client', status: 'offline', updatedAt: 1_000_000 });
    insertClient({ id: 'other-client', status: 'offline', updatedAt: 1_000_000 });
    insertMapping({ id: 'pm_offline', clientId: 'offline-client', remotePort: 20001 });
    insertMapping({ id: 'pm_other', clientId: 'other-client', remotePort: 20002 });
    insertTask({ id: 'task_offline', clientId: 'offline-client' });
    insertTask({ id: 'task_other', clientId: 'other-client' });
    insertTaskLog({ taskId: 'task_offline', content: 'offline-log' });
    insertTaskLog({ taskId: 'task_other', content: 'other-log' });

    const summary = service.deleteClientCascade('offline-client');

    expect(summary).toEqual({ deletedMappings: 1, deletedTasks: 1, deletedLogs: 1 });
    expect(service.getClient('offline-client')).toBeUndefined();
    expect(service.getClient('other-client')).toBeDefined();

    // Verify target data is gone
    const pmResult = state.db!.exec("SELECT id FROM port_mappings WHERE client_id = 'offline-client'");
    expect(pmResult.length).toBe(0);

    const taskResult = state.db!.exec("SELECT id FROM tasks WHERE client_id = 'offline-client'");
    expect(taskResult.length).toBe(0);

    const logResult = state.db!.exec("SELECT id FROM task_logs WHERE task_id = 'task_offline'");
    expect(logResult.length).toBe(0);

    // Verify other client data is untouched
    const pmOther = state.db!.exec("SELECT id FROM port_mappings WHERE client_id = 'other-client'");
    expect(pmOther[0].values).toEqual([['pm_other']]);

    const taskOther = state.db!.exec("SELECT id FROM tasks WHERE client_id = 'other-client'");
    expect(taskOther[0].values).toEqual([['task_other']]);

    const logOther = state.db!.exec("SELECT content FROM task_logs WHERE task_id = 'task_other'");
    expect(logOther[0].values).toEqual([['other-log']]);
  });

  it('does not delete unrelated data when deleting a missing client', () => {
    // Insert some data for another client to ensure it stays
    insertClient({ id: 'other-client', status: 'offline', updatedAt: 1_000_000 });
    insertTask({ id: 'task_other', clientId: 'other-client' });

    const summary = service.deleteClientCascade('missing-client');

    expect(summary).toEqual({ deletedMappings: 0, deletedTasks: 0, deletedLogs: 0 });
    expect(service.getClient('missing-client')).toBeUndefined();
    // Other data untouched
    expect(service.getClient('other-client')).toBeDefined();
  });

  it('keeps online status visible for callers that must reject online deletion before cleanup', () => {
    insertClient({ id: 'online-client', status: 'online', updatedAt: 1_000_000 });

    const client = service.getClient('online-client');

    expect(client?.status).toBe('online');
  });
});
