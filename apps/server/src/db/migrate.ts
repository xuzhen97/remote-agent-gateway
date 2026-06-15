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

  // Aliyun Drive and transfer tables
  db.run(`
    CREATE TABLE IF NOT EXISTS aliyundrive_config (
      id TEXT PRIMARY KEY,
      client_id TEXT NOT NULL,
      client_secret TEXT,
      scope TEXT NOT NULL,
      openapi_base TEXT NOT NULL,
      redirect_uri TEXT NOT NULL,
      transfer_folder TEXT NOT NULL,
      cleanup_ttl_ms INTEGER NOT NULL,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS aliyundrive_auth (
      id TEXT PRIMARY KEY,
      access_token TEXT NOT NULL,
      refresh_token TEXT,
      token_type TEXT,
      expires_at INTEGER NOT NULL,
      drive_id TEXT,
      authorized_account_name TEXT,
      updated_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS transfer_jobs (
      id TEXT PRIMARY KEY,
      client_id TEXT NOT NULL,
      root_id TEXT NOT NULL,
      target_dir TEXT NOT NULL,
      filename TEXT NOT NULL,
      size INTEGER NOT NULL,
      sha256 TEXT,
      mode TEXT NOT NULL,
      status TEXT NOT NULL,
      phase TEXT NOT NULL,
      error_code TEXT,
      error_message TEXT,
      aliyun_drive_id TEXT,
      aliyun_file_id TEXT,
      aliyun_upload_id TEXT,
      aliyun_parent_file_id TEXT,
      aliyun_file_name TEXT,
      uploaded_bytes INTEGER NOT NULL DEFAULT 0,
      downloaded_bytes INTEGER NOT NULL DEFAULT 0,
      written_bytes INTEGER NOT NULL DEFAULT 0,
      total_bytes INTEGER NOT NULL,
      part_count INTEGER,
      current_part INTEGER,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      completed_at INTEGER,
      cleanup_after_at INTEGER,
      cleanup_status TEXT NOT NULL DEFAULT 'none'
    );

    CREATE TABLE IF NOT EXISTS transfer_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      transfer_id TEXT NOT NULL,
      source TEXT NOT NULL,
      type TEXT NOT NULL,
      message TEXT NOT NULL,
      payload TEXT,
      created_at INTEGER NOT NULL
    );
  `);

  db.run(`
    CREATE INDEX IF NOT EXISTS idx_transfer_jobs_client_id ON transfer_jobs(client_id);
    CREATE INDEX IF NOT EXISTS idx_transfer_jobs_updated_at ON transfer_jobs(updated_at DESC);
    CREATE INDEX IF NOT EXISTS idx_transfer_jobs_cleanup_after_at ON transfer_jobs(cleanup_after_at);
    CREATE INDEX IF NOT EXISTS idx_transfer_events_transfer_id ON transfer_events(transfer_id, created_at ASC);
  `);

  reconcileDuplicateRemotePorts(db);

  db.run(`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_port_mappings_remote_port_unique
    ON port_mappings(remote_port)
    WHERE remote_port IS NOT NULL;
  `);

  // One-click update tables
  db.run(`
    CREATE TABLE IF NOT EXISTS update_releases (
      version TEXT PRIMARY KEY,
      manifest_json TEXT NOT NULL,
      enabled INTEGER NOT NULL DEFAULT 1,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS update_campaigns (
      id TEXT PRIMARY KEY,
      target_version TEXT NOT NULL,
      scope_json TEXT NOT NULL,
      include_server INTEGER NOT NULL,
      batch_size INTEGER NOT NULL,
      max_concurrency INTEGER NOT NULL,
      status TEXT NOT NULL,
      created_by TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS update_targets (
      id TEXT PRIMARY KEY,
      campaign_id TEXT NOT NULL,
      target_type TEXT NOT NULL,
      client_id TEXT,
      platform TEXT,
      current_version TEXT,
      target_version TEXT NOT NULL,
      phase TEXT NOT NULL,
      attempt_count INTEGER NOT NULL DEFAULT 0,
      last_error_code TEXT,
      last_error_message TEXT,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      finished_at INTEGER
    );

    CREATE TABLE IF NOT EXISTS update_attempts (
      id TEXT PRIMARY KEY,
      target_id TEXT NOT NULL,
      attempt_no INTEGER NOT NULL,
      phase_timeline_json TEXT NOT NULL,
      result TEXT NOT NULL,
      error_code TEXT,
      error_message TEXT,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      finished_at INTEGER
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

function reconcileDuplicateRemotePorts(db: Database): void {
  const duplicatePortsStmt = db.prepare(`
    SELECT remote_port
    FROM port_mappings
    WHERE remote_port IS NOT NULL
    GROUP BY remote_port
    HAVING COUNT(*) > 1
  `);

  const duplicatePorts: number[] = [];
  while (duplicatePortsStmt.step()) {
    const row = duplicatePortsStmt.getAsObject() as { remote_port: number };
    if (typeof row.remote_port === 'number') duplicatePorts.push(row.remote_port);
  }
  duplicatePortsStmt.free();

  const now = Date.now();
  for (const remotePort of duplicatePorts) {
    const duplicatesStmt = db.prepare(`
      SELECT id
      FROM port_mappings
      WHERE remote_port = ?
      ORDER BY updated_at ASC, created_at ASC, id ASC
    `);
    duplicatesStmt.bind([remotePort]);

    const ids: string[] = [];
    while (duplicatesStmt.step()) {
      const row = duplicatesStmt.getAsObject() as { id: string };
      if (typeof row.id === 'string') ids.push(row.id);
    }
    duplicatesStmt.free();

    for (const duplicateId of ids.slice(1)) {
      db.run(
        `UPDATE port_mappings
         SET remote_port = NULL,
             public_url = NULL,
             status = 'inactive',
             updated_at = ?
         WHERE id = ?`,
        [now, duplicateId],
      );
    }
  }
}
