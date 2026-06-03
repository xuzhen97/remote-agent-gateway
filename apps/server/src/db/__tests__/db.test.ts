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

  it('updates and deletes a record', () => {
    run(db, 'UPDATE clients SET status = ? WHERE id = ?', ['offline', 'test-client-1']);
    const updated = queryOne(db, 'SELECT status FROM clients WHERE id = ?', ['test-client-1']) as Record<string, unknown>;
    expect(updated.status).toBe('offline');

    run(db, 'DELETE FROM port_mappings WHERE id = ?', ['pm-test-1']);
    expect(queryAll(db, 'SELECT * FROM port_mappings WHERE id = ?', ['pm-test-1'])).toHaveLength(0);
  });
});
