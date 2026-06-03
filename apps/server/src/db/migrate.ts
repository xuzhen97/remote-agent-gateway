import type { Database } from 'sql.js';

export function migrate(db: Database): void {
  db.run(`
    CREATE TABLE IF NOT EXISTS clients (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      hostname TEXT,
      os TEXT,
      arch TEXT,
      version TEXT,
      tags TEXT,
      status TEXT NOT NULL DEFAULT 'offline',
      token_hash TEXT,
      last_seen_at INTEGER,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS files (
      id TEXT PRIMARY KEY,
      original_name TEXT NOT NULL,
      stored_path TEXT NOT NULL,
      size INTEGER,
      sha256 TEXT,
      mime_type TEXT,
      created_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS port_mappings (
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
      updated_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS audit_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      actor TEXT,
      action TEXT NOT NULL,
      target_type TEXT,
      target_id TEXT,
      detail TEXT,
      created_at INTEGER NOT NULL
    );
  `);

  // Task history mirror
  db.run(`
    CREATE TABLE IF NOT EXISTS task_history (
      record_id TEXT PRIMARY KEY,
      client_id TEXT NOT NULL,
      client_name_snapshot TEXT,
      request_id TEXT NOT NULL,
      job_id TEXT,
      resource_type TEXT NOT NULL,
      action_type TEXT NOT NULL,
      method TEXT NOT NULL,
      path TEXT NOT NULL,
      target_id TEXT NOT NULL,
      source_type TEXT NOT NULL,
      actor_type TEXT NOT NULL,
      actor_label TEXT NOT NULL,
      query_summary TEXT,
      request_summary TEXT NOT NULL,
      result_summary TEXT NOT NULL,
      status TEXT NOT NULL,
      http_status INTEGER NOT NULL,
      started_at INTEGER NOT NULL,
      finished_at INTEGER NOT NULL,
      duration_ms INTEGER NOT NULL,
      error_code TEXT,
      error_message TEXT,
      reported_at INTEGER NOT NULL,
      received_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_task_history_client_id ON task_history(client_id);
    CREATE INDEX IF NOT EXISTS idx_task_history_finished_at ON task_history(finished_at DESC);
    CREATE INDEX IF NOT EXISTS idx_task_history_status ON task_history(status);
  `);

  // Idempotent column additions for client HTTP control plane
  addColumnIfMissing(db, 'clients', 'http_local_host', 'TEXT');
  addColumnIfMissing(db, 'clients', 'http_local_port', 'INTEGER');
  addColumnIfMissing(db, 'clients', 'http_remote_port', 'INTEGER');
  addColumnIfMissing(db, 'clients', 'http_base_url', 'TEXT');
  addColumnIfMissing(db, 'clients', 'http_token', 'TEXT');
  addColumnIfMissing(db, 'clients', 'http_ready', 'INTEGER DEFAULT 0');
  addColumnIfMissing(db, 'clients', 'http_last_ready_at', 'INTEGER');
  addColumnIfMissing(db, 'clients', 'capabilities', 'TEXT');
  addColumnIfMissing(db, 'port_mappings', 'kind', "TEXT DEFAULT 'business'");
  addColumnIfMissing(db, 'port_mappings', 'protected', 'INTEGER DEFAULT 0');
  addColumnIfMissing(db, 'port_mappings', 'source', "TEXT DEFAULT 'client_http'");
}

function addColumnIfMissing(db: Database, table: string, column: string, definition: string): void {
  const stmt = db.prepare(`PRAGMA table_info(${table})`);
  const columns = new Set<string>();
  while (stmt.step()) {
    const row = stmt.getAsObject() as { name: string };
    columns.add(row.name);
  }
  stmt.free();
  if (!columns.has(column)) db.run(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
}
