import initSqlJs, { type Database } from 'sql.js';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { env } from '../config/env.js';
import { migrate } from './migrate.js';

let dbInstance: Database | null = null;

/**
 * Find sql-wasm.wasm — checks alongside the running script first (bundled dist),
 * then falls back to node_modules (dev mode).
 */
function findWasmPath(): string {
  // Determine the directory where this script runs
  // In CJS: __dirname is always available
  // In ESM (tsx dev mode): use process.argv[1]
  const scriptDir = typeof __dirname !== 'undefined'
    ? __dirname
    : path.dirname(process.argv[1] ?? '.');

  // Bundled mode: wasm is next to the bundle
  const bundledWasm = path.join(scriptDir, 'sql-wasm.wasm');
  if (fs.existsSync(bundledWasm)) return bundledWasm;

  // Dev mode: search pnpm node_modules for sql-wasm.wasm
  function searchDir(dir: string, depth = 0): string | null {
    if (depth > 6) return null;
    try {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        if (entry.name === 'sql-wasm.wasm') return path.join(dir, entry.name);
        if (entry.isDirectory() && !entry.name.startsWith('.')) {
          const found = searchDir(path.join(dir, entry.name), depth + 1);
          if (found) return found;
        }
      }
    } catch { /* skip */ }
    return null;
  }

  // Search from project root (3 levels up from apps/server/src/db in dev)
  const pnpRoot = path.resolve(scriptDir, '..', '..', '..', '..', '..');
  const found = searchDir(pnpRoot);
  if (found) return found;

  throw new Error('sql-wasm.wasm not found. Ensure sql.js is installed and sql-wasm.wasm is next to the bundle or in node_modules.');
}

export async function initDb(): Promise<Database> {
  if (dbInstance) return dbInstance;

  // sql.js needs to locate its .wasm file. In dev mode it's in node_modules;
  // in bundled dist mode it's next to the bundle. Check both locations.
  const wasmPath = findWasmPath();
  const SQL = await initSqlJs({
    locateFile: (_file: string) => wasmPath,
  });

  // Ensure directory exists
  const dbDir = path.dirname(env.DB_PATH);
  if (!fs.existsSync(dbDir)) {
    fs.mkdirSync(dbDir, { recursive: true });
  }

  // Load existing database or create new one
  if (fs.existsSync(env.DB_PATH)) {
    const buffer = fs.readFileSync(env.DB_PATH);
    dbInstance = new SQL.Database(buffer);
  } else {
    dbInstance = new SQL.Database();
  }

  // Run migrations
  migrate(dbInstance);

  return dbInstance;
}

export function getDb(): Database {
  if (!dbInstance) {
    throw new Error('Database not initialized. Call initDb() first.');
  }
  return dbInstance;
}

export function saveDb(): void {
  if (!dbInstance) return;
  const data = dbInstance.export();
  const buffer = Buffer.from(data);
  fs.writeFileSync(env.DB_PATH, buffer);
}

export { migrate };
