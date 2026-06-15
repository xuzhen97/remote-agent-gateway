import { describe, it, expect, beforeAll } from 'vitest';
import initSqlJs, { type Database } from 'sql.js';
import { migrate } from '../migrate.js';

function queryAll(db: Database, sql: string, params?: unknown[]): unknown[] {
  const stmt = db.prepare(sql);
  if (params) stmt.bind(params);
  const results: unknown[] = [];
  while (stmt.step()) {
    results.push(stmt.getAsObject());
  }
  stmt.free();
  return results;
}

function queryOne(db: Database, sql: string, params?: unknown[]): unknown | undefined {
  const results = queryAll(db, sql, params);
  return results[0];
}

function run(db: Database, sql: string, params?: unknown[]): void {
  if (params) db.run(sql, params);
  else db.run(sql);
}

describe('database schema', () => {
  let db: Database;

  beforeAll(async () => {
    const SQL = await initSqlJs();
    db = new SQL.Database();
    migrate(db);
  });

  it('inserts and queries a client', () => {
    const now = Date.now();
    run(db, `INSERT INTO clients (id, name, hostname, os, arch, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      ['test-client-1', 'Test Client', 'test-machine', 'linux', 'x64', 'online', now, now]);

    const row = queryOne(db, 'SELECT * FROM clients WHERE id = ?', ['test-client-1']) as Record<string, unknown>;
    expect(row).toBeDefined();
    expect(row.name).toBe('Test Client');
    expect(row.status).toBe('online');
  });

  it('inserts and queries a file record', () => {
    const now = Date.now();
    run(db, `INSERT INTO files (id, original_name, stored_path, size, sha256, mime_type, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)`,
      ['file-test-1', 'test.zip', '/storage/files/test.zip', 1024, 'abc123', 'application/zip', now]);

    const row = queryOne(db, 'SELECT * FROM files WHERE id = ?', ['file-test-1']) as Record<string, unknown>;
    expect(row).toBeDefined();
    expect(row.original_name).toBe('test.zip');
    expect(row.sha256).toBe('abc123');
  });

  it('inserts and queries a port mapping', () => {
    const now = Date.now();
    run(db, `INSERT INTO port_mappings (id, client_id, name, proxy_type, local_ip, local_port, remote_port, status, public_url, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ['pm-test-1', 'test-client-1', 'web-preview', 'tcp', '127.0.0.1', 3000, 23000, 'active', '127.0.0.1:23000', now, now]);

    const row = queryOne(db, 'SELECT * FROM port_mappings WHERE id = ?', ['pm-test-1']) as Record<string, unknown>;
    expect(row).toBeDefined();
    expect(row.remote_port).toBe(23000);
    expect(row.status).toBe('active');
  });

  it('inserts and queries an audit log', () => {
    const now = Date.now();
    run(db, `INSERT INTO audit_logs (actor, action, target_type, target_id, detail, created_at) VALUES (?, ?, ?, ?, ?, ?)`,
      ['admin', 'client_http.frp_mapping.create', 'port_mapping', 'pm-test-1', 'Created TCP mapping', now]);

    const rows = queryAll(db, 'SELECT * FROM audit_logs');
    expect(rows.length).toBeGreaterThanOrEqual(1);
    const row = rows[0] as Record<string, unknown>;
    expect(row.action).toBe('client_http.frp_mapping.create');
  });

  it('enforces unique remote ports for business mappings', () => {
    const now = Date.now();
    run(db, `INSERT INTO port_mappings (id, client_id, name, proxy_type, local_ip, local_port, remote_port, status, public_url, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ['pm-test-dup-a', 'test-client-1', 'dup-a', 'tcp', '127.0.0.1', 3001, 23010, 'active', '127.0.0.1:23010', now, now]);

    expect(() => run(db, `INSERT INTO port_mappings (id, client_id, name, proxy_type, local_ip, local_port, remote_port, status, public_url, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ['pm-test-dup-b', 'test-client-2', 'dup-b', 'tcp', '127.0.0.1', 3002, 23010, 'active', '127.0.0.1:23010', now, now])).toThrow();
  });

  it('reconciles duplicate remote ports before creating the unique index', async () => {
    const SQL = await initSqlJs();
    const legacyDb = new SQL.Database();

    legacyDb.run(`
      CREATE TABLE port_mappings (
        id TEXT PRIMARY KEY,
        client_id TEXT NOT NULL,
        name TEXT NOT NULL,
        proxy_type TEXT NOT NULL,
        local_ip TEXT NOT NULL,
        local_port INTEGER NOT NULL,
        remote_port INTEGER,
        custom_domain TEXT,
        status TEXT NOT NULL DEFAULT 'inactive',
        public_url TEXT,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        kind TEXT DEFAULT 'business',
        protected INTEGER DEFAULT 0,
        source TEXT DEFAULT 'client_http'
      );
    `);

    const now = Date.now();
    legacyDb.run(`INSERT INTO port_mappings (id, client_id, name, proxy_type, local_ip, local_port, remote_port, status, public_url, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ['pm-legacy-a', 'client-a', 'legacy-a', 'tcp', '127.0.0.1', 3001, 23020, 'active', '127.0.0.1:23020', now, now]);
    legacyDb.run(`INSERT INTO port_mappings (id, client_id, name, proxy_type, local_ip, local_port, remote_port, status, public_url, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ['pm-legacy-b', 'client-b', 'legacy-b', 'tcp', '127.0.0.1', 3002, 23020, 'active', '127.0.0.1:23020', now + 1, now + 1]);

    migrate(legacyDb);

    const rows = queryAll(legacyDb, 'SELECT id, remote_port, public_url, status FROM port_mappings ORDER BY id ASC') as Array<Record<string, unknown>>;
    expect(rows).toEqual([
      { id: 'pm-legacy-a', remote_port: 23020, public_url: '127.0.0.1:23020', status: 'active' },
      { id: 'pm-legacy-b', remote_port: null, public_url: null, status: 'inactive' },
    ]);
  });

  it('updates and deletes a record', () => {
    run(db, 'UPDATE clients SET status = ? WHERE id = ?', ['offline', 'test-client-1']);
    const updated = queryOne(db, 'SELECT status FROM clients WHERE id = ?', ['test-client-1']) as Record<string, unknown>;
    expect(updated.status).toBe('offline');

    run(db, 'DELETE FROM port_mappings WHERE id = ?', ['pm-test-1']);
    expect(queryAll(db, 'SELECT * FROM port_mappings WHERE id = ?', ['pm-test-1'])).toHaveLength(0);
  });
});
