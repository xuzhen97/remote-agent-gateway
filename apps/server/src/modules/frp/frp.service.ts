import { getDb } from '../../db/index.js';
import { v4 as uuid } from 'uuid';
import { env, resolveFrpsHost, buildFrpPublicUrl } from '../../config/env.js';
import { portAllocatorService } from '../ports/port-allocator.service.js';

export interface PortMappingRow {
  id: string;
  client_id: string;
  name: string;
  proxy_type: string;
  local_ip: string;
  local_port: number;
  remote_port: number | null;
  custom_domain: string | null;
  status: string;
  public_url: string | null;
  created_at: number;
  updated_at: number;
}

export class FrpService {
  async createMapping(params: {
    clientId: string;
    name: string;
    proxyType: string;
    localIp: string;
    localPort: number;
    remotePort?: number;
    customDomain?: string;
  }): Promise<PortMappingRow> {
    const db = getDb();
    const id = `pm_${uuid().slice(0, 8)}`;
    const now = Date.now();

    const remotePort = await portAllocatorService.allocate(
      params.clientId,
      typeof params.remotePort === 'number'
        ? { preferredPort: params.remotePort }
        : undefined,
    );
    const publicUrl = buildFrpPublicUrl(remotePort, {
      proxyType: params.proxyType as 'tcp' | 'http' | 'https',
      customDomain: params.customDomain,
    });

    db.run(
      `INSERT INTO port_mappings (id, client_id, name, proxy_type, local_ip, local_port, remote_port, custom_domain, status, public_url, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'inactive', ?, ?, ?)`,
      [id, params.clientId, params.name, params.proxyType, params.localIp, params.localPort, remotePort, params.customDomain ?? null, publicUrl, now, now],
    );

    return this.getMapping(id)!;
  }

  getMapping(mappingId: string): PortMappingRow | undefined {
    const db = getDb();
    const stmt = db.prepare('SELECT * FROM port_mappings WHERE id = ?');
    stmt.bind([mappingId]);
    if (stmt.step()) {
      const row = stmt.getAsObject() as unknown as PortMappingRow;
      stmt.free();
      return row;
    }
    stmt.free();
    return undefined;
  }

  listMappings(clientId?: string): PortMappingRow[] {
    const db = getDb();
    let sql = 'SELECT * FROM port_mappings';
    const params: unknown[] = [];

    if (clientId) {
      sql += ' WHERE client_id = ?';
      params.push(clientId);
    }

    sql += ' ORDER BY created_at DESC';

    const results: PortMappingRow[] = [];
    const stmt = db.prepare(sql);
    if (params.length) stmt.bind(params);
    while (stmt.step()) {
      results.push(stmt.getAsObject() as unknown as PortMappingRow);
    }
    stmt.free();
    return results;
  }

  updateMappingStatus(mappingId: string, status: string, publicUrl?: string): void {
    const db = getDb();
    const now = Date.now();
    if (publicUrl) {
      db.run('UPDATE port_mappings SET status = ?, public_url = ?, updated_at = ? WHERE id = ?', [status, publicUrl, now, mappingId]);
    } else {
      db.run('UPDATE port_mappings SET status = ?, updated_at = ? WHERE id = ?', [status, now, mappingId]);
    }
  }

  deleteMapping(mappingId: string): void {
    const db = getDb();
    const mapping = this.getMapping(mappingId);
    db.run('DELETE FROM port_mappings WHERE id = ?', [mappingId]);
    if (mapping?.remote_port) {
      portAllocatorService.release(mapping.remote_port);
    }
  }

  deleteMappingsByClientId(clientId: string): number {
    const db = getDb();
    db.run('DELETE FROM port_mappings WHERE client_id = ?', [clientId]);
    return db.getRowsModified();
  }

  toApi(mapping: PortMappingRow): Record<string, unknown> {
    return {
      id: mapping.id,
      clientId: mapping.client_id,
      name: mapping.name,
      proxyType: mapping.proxy_type,
      localIp: mapping.local_ip,
      localPort: mapping.local_port,
      remotePort: mapping.remote_port,
      customDomain: mapping.custom_domain,
      status: mapping.status,
      publicUrl: mapping.public_url,
      createdAt: mapping.created_at,
      updatedAt: mapping.updated_at,
    };
  }
}

/**
 * Build the FRP connection info that gets passed to clients
 * so they know which frps to connect to.
 */
export function getFrpsConnectionInfo() {
  return {
    serverAddr: resolveFrpsHost(),
    serverPort: env.FRPS_PORT,
    authToken: env.FRPS_TOKEN,
  };
}

export const frpService = new FrpService();
