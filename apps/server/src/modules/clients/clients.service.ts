import { getDb } from '../../db/index.js';
import type { ClientInfo } from '@rag/shared';
import { connectionManager } from '../connections/connections.manager.js';
import { frpService } from '../frp/frp.service.js';

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
  http_local_host: string | null;
  http_local_port: number | null;
  http_remote_port: number | null;
  http_base_url: string | null;
  http_token: string | null;
  http_ready: number | null;
  http_last_ready_at: number | null;
  capabilities: string | null;
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

  deleteOfflineClientsOlderThan(cutoffMs: number): number {
    const db = getDb();
    db.run('DELETE FROM clients WHERE status = ? AND updated_at < ?', ['offline', cutoffMs]);
    return db.getRowsModified();
  }

  deleteClientCascade(clientId: string): {
    deletedMappings: number;
  } {
    const db = getDb();
    const deletedMappings = frpService.deleteMappingsByClientId(clientId);
    db.run('DELETE FROM clients WHERE id = ?', [clientId]);
    return { deletedMappings };
  }

  updateHeartbeat(clientId: string, info?: { cpu?: number; memory?: number; uptime?: number }): void {
    const now = Date.now();
    const db = getDb();
    db.run('UPDATE clients SET status = ?, last_seen_at = ?, updated_at = ? WHERE id = ?', ['online', now, now, clientId]);
  }

  updateHttpEndpoint(clientId: string, patch: {
    localHost: string;
    localPort: number;
    remotePort: number;
    baseUrl: string;
    token: string;
    capabilities?: unknown;
    ready?: boolean;
  }): void {
    const db = getDb();
    db.run(
      `UPDATE clients SET http_local_host = ?, http_local_port = ?, http_remote_port = ?, http_base_url = ?, http_token = ?, http_ready = ?, capabilities = ?, updated_at = ? WHERE id = ?`,
      [patch.localHost, patch.localPort, patch.remotePort, patch.baseUrl, patch.token, patch.ready ? 1 : 0, patch.capabilities ? JSON.stringify(patch.capabilities) : null, Date.now(), clientId],
    );
  }

  markHttpReady(clientId: string, baseUrl: string, remotePort: number): void {
    const now = Date.now();
    getDb().run(
      `UPDATE clients SET http_ready = 1, http_base_url = ?, http_remote_port = ?, http_last_ready_at = ?, updated_at = ? WHERE id = ?`,
      [baseUrl, remotePort, now, now, clientId],
    );
  }

  markHttpFailed(clientId: string): void {
    getDb().run('UPDATE clients SET http_ready = 0, updated_at = ? WHERE id = ?', [Date.now(), clientId]);
  }

  toApi(client: ClientRow, options?: { includeHttpToken?: boolean }): Record<string, unknown> {
    const result: Record<string, unknown> = {
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
      httpReady: client.http_ready === 1,
      clientHttpBaseUrl: client.http_base_url,
      clientHttpRemotePort: client.http_remote_port,
      capabilities: client.capabilities ? JSON.parse(client.capabilities) : null,
    };
    if (options?.includeHttpToken && client.http_token) {
      result.clientHttpToken = client.http_token;
    }
    return result;
  }
}

export const clientsService = new ClientsService();
