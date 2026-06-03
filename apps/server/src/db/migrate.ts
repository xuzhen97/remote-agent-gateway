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

    CREATE TABLE IF NOT EXISTS tasks (
      id TEXT PRIMARY KEY,
      client_id TEXT NOT NULL,
      type TEXT NOT NULL,
      status TEXT NOT NULL,
      payload TEXT NOT NULL,
      result TEXT,
      error TEXT,
      created_by TEXT,
      created_at INTEGER NOT NULL,
      started_at INTEGER,
      finished_at INTEGER
    );

    CREATE TABLE IF NOT EXISTS task_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      task_id TEXT NOT NULL,
      stream TEXT NOT NULL,
      content TEXT NOT NULL,
      created_at INTEGER NOT NULL
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

    CREATE TABLE IF NOT EXISTS auto_mappings (
      id TEXT PRIMARY KEY,
      client_id TEXT NOT NULL,
      provider_name TEXT NOT NULL,
      mapping_id TEXT NOT NULL,
      status TEXT NOT NULL,
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
