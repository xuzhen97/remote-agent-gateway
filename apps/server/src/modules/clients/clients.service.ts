import { getDb } from '../../db/index.js';
import type { ClientInfo } from '@rag/shared';
import { connectionManager } from '../connections/connections.manager.js';

export interface ClientRow {
  id: string;
  name: string;
  hostname: string | null;
  os: string | null;
  arch: string | null;
  version: string | null;
  tags: string | null;
  status: string;
  token_hash: string | null;
  last_seen_at: number | null;
  created_at: number;
  updated_at: number;
}

export class ClientsService {
  upsertClient(info: ClientInfo): void {
    const db = getDb();
    const now = Date.now();
    const existing = this.getClient(info.clientId);

    if (existing) {
      db.run(
        `UPDATE clients SET name = ?, hostname = ?, os = ?, arch = ?, version = ?, tags = ?, status = 'online', last_seen_at = ?, updated_at = ? WHERE id = ?`,
        [info.name, info.hostname ?? null, info.os ?? null, info.arch ?? null, info.version ?? null, JSON.stringify(info.tags ?? []), now, now, info.clientId],
      );
    } else {
      db.run(
        `INSERT INTO clients (id, name, hostname, os, arch, version, tags, status, last_seen_at, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, 'online', ?, ?, ?)`,
        [info.clientId, info.name, info.hostname ?? null, info.os ?? null, info.arch ?? null, info.version ?? null, JSON.stringify(info.tags ?? []), now, now, now],
      );
    }
  }

  getClient(clientId: string): ClientRow | undefined {
    const db = getDb();
    const stmt = db.prepare('SELECT * FROM clients WHERE id = ?');
    stmt.bind([clientId]);
    if (stmt.step()) {
      const row = stmt.getAsObject() as unknown as ClientRow;
      stmt.free();
      return row;
    }
    stmt.free();
    return undefined;
  }

  listClients(): ClientRow[] {
    const db = getDb();
    const results: ClientRow[] = [];
    const stmt = db.prepare('SELECT * FROM clients ORDER BY updated_at DESC');
    while (stmt.step()) {
      results.push(stmt.getAsObject() as unknown as ClientRow);
    }
    stmt.free();
    return results;
  }

  setOffline(clientId: string): void {
    const db = getDb();
    db.run('UPDATE clients SET status = ?, updated_at = ? WHERE id = ?', ['offline', Date.now(), clientId]);
  }

  updateHeartbeat(clientId: string, info?: { cpu?: number; memory?: number; uptime?: number }): void {
    const now = Date.now();
    const db = getDb();
    db.run('UPDATE clients SET status = ?, last_seen_at = ?, updated_at = ? WHERE id = ?', ['online', now, now, clientId]);
  }

  toApi(client: ClientRow): Record<string, unknown> {
    return {
      id: client.id,
      name: client.name,
      hostname: client.hostname,
      os: client.os,
      arch: client.arch,
      version: client.version,
      tags: client.tags ? JSON.parse(client.tags) : [],
      status: client.status,
      online: connectionManager.isOnline(client.id),
      lastSeenAt: client.last_seen_at,
      createdAt: client.created_at,
    };
  }
}

export const clientsService = new ClientsService();
