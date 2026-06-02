import { beforeEach, describe, expect, it } from 'vitest';
import { initDb, getDb } from '../../db/index.js';
import { AutoMappingService } from './auto-mapping.service.js';

describe('AutoMappingService', () => {
  beforeEach(async () => {
    await initDb();
    const db = getDb();
    db.run('DELETE FROM auto_mappings');
  });

  it('stores active records when a provider creates an auto mapping', async () => {
    const service = new AutoMappingService();
    service.registerProvider({
      name: 'file-http',
      onClientOnline: async () => ({ mappingId: 'pm-auto', localPort: 45123, name: 'auto-file-http', proxyType: 'http' }),
      onClientOffline: async () => {},
    });

    await service.onClientOnline('client-1');

    const stmt = getDb().prepare('SELECT * FROM auto_mappings WHERE client_id = ?');
    stmt.bind(['client-1']);
    expect(stmt.step()).toBe(true);
    const row = stmt.getAsObject() as { provider_name: string; mapping_id: string; status: string };
    stmt.free();

    expect(row.provider_name).toBe('file-http');
    expect(row.mapping_id).toBe('pm-auto');
    expect(row.status).toBe('active');
  });

  it('marks all records cleanup_pending on offline', async () => {
    const now = Date.now();
    getDb().run(
      `INSERT INTO auto_mappings (id, client_id, provider_name, mapping_id, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)`,
      ['am-1', 'client-1', 'file-http', 'pm-auto', 'active', now, now],
    );

    const service = new AutoMappingService();
    await service.onClientOffline('client-1');

    const stmt = getDb().prepare('SELECT status FROM auto_mappings WHERE id = ?');
    stmt.bind(['am-1']);
    stmt.step();
    const row = stmt.getAsObject() as { status: string };
    stmt.free();

    expect(row.status).toBe('cleanup_pending');
  });
});
