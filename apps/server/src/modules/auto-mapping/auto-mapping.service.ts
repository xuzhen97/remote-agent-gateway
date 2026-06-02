import { v4 as uuid } from 'uuid';
import { getDb } from '../../db/index.js';
import { auditService } from '../audit/audit.service.js';
import { FileHttpAutoMappingProvider } from './providers/file-http.provider.js';

export interface AutoMappingProvider {
  name: string;
  onClientOnline(clientId: string): Promise<{
    mappingId: string;
    localPort: number;
    name: string;
    proxyType: 'tcp' | 'http' | 'https';
  }>;
  onClientOffline(clientId: string, mappingId: string): Promise<void>;
}

export class AutoMappingService {
  private readonly providers = new Map<string, AutoMappingProvider>();

  registerProvider(provider: AutoMappingProvider): void {
    this.providers.set(provider.name, provider);
  }

  async onClientOnline(clientId: string): Promise<void> {
    for (const provider of this.providers.values()) {
      const result = await provider.onClientOnline(clientId);
      const now = Date.now();
      getDb().run(
        `INSERT INTO auto_mappings (id, client_id, provider_name, mapping_id, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [`am_${uuid().slice(0, 8)}`, clientId, provider.name, result.mappingId, 'active', now, now],
      );
    }
  }

  async onClientOffline(clientId: string): Promise<void> {
    const records = this.listByClient(clientId).filter((row) => row.status === 'active');
    for (const row of records) {
      const provider = this.providers.get(String(row.provider_name));
      if (provider) {
        await provider.onClientOffline(clientId, String(row.mapping_id));
      }
    }

    getDb().run(
      'UPDATE auto_mappings SET status = ?, updated_at = ? WHERE client_id = ? AND status = ?',
      ['cleanup_pending', Date.now(), clientId, 'active'],
    );
    auditService.log({
      actor: clientId,
      action: 'auto_mapping.cleanup_pending',
      targetType: 'client',
      targetId: clientId,
    });
  }

  listByClient(clientId: string): Array<Record<string, unknown>> {
    const stmt = getDb().prepare('SELECT * FROM auto_mappings WHERE client_id = ? ORDER BY created_at ASC');
    stmt.bind([clientId]);
    const rows: Array<Record<string, unknown>> = [];
    while (stmt.step()) rows.push(stmt.getAsObject());
    stmt.free();
    return rows;
  }

  listCleanupPending(clientId: string): Array<Record<string, unknown>> {
    const stmt = getDb().prepare('SELECT * FROM auto_mappings WHERE client_id = ? AND status = ? ORDER BY created_at ASC');
    stmt.bind([clientId, 'cleanup_pending']);
    const rows: Array<Record<string, unknown>> = [];
    while (stmt.step()) rows.push(stmt.getAsObject());
    stmt.free();
    return rows;
  }

  deleteRecord(mappingId: string): void {
    getDb().run('DELETE FROM auto_mappings WHERE mapping_id = ?', [mappingId]);
  }
}

export const autoMappingService = new AutoMappingService();
autoMappingService.registerProvider(new FileHttpAutoMappingProvider());
