import initSqlJs, { type Database } from 'sql.js';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { env } from '../config/env.js';
import { migrate } from './migrate.js';

let dbInstance: Database | null = null;

export async function initDb(): Promise<Database> {
  if (dbInstance) return dbInstance;

  const SQL = await initSqlJs();

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
