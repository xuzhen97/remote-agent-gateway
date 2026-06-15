import { beforeEach, describe, expect, it } from 'vitest';
import { initDb, getDb } from '../../db/index.js';
import { FrpService } from './frp.service.js';

describe('FrpService concurrency', () => {
  beforeEach(async () => {
    await initDb();
    const db = getDb();
    db.run('DELETE FROM port_mappings');
  });

  it('assigns distinct remote ports for concurrent createMapping calls', async () => {
    const service = new FrpService();

    const [first, second] = await Promise.all([
      service.createMapping({
        clientId: 'client-1',
        name: 'db-a',
        proxyType: 'tcp',
        localIp: '127.0.0.1',
        localPort: 5432,
      }),
      service.createMapping({
        clientId: 'client-2',
        name: 'db-b',
        proxyType: 'tcp',
        localIp: '127.0.0.1',
        localPort: 9000,
      }),
    ]);

    expect(first.remote_port).not.toBe(second.remote_port);

    const rows = getDb().exec("SELECT remote_port FROM port_mappings ORDER BY remote_port ASC");
    const ports = (rows[0]?.values ?? []).map((row) => row[0]);
    expect(ports).toHaveLength(2);
    expect(new Set(ports).size).toBe(2);
  });
});
