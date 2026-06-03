import { env } from '../../config/env.js';
import { getDb } from '../../db/index.js';
import { listFrpsProxies, type FrpsDashboardConfig } from './frps-dashboard.service.js';
import { clientsService } from '../clients/clients.service.js';

/**
 * Delete a single proxy from the frps dashboard.
 */
async function deleteFrpsProxy(proxyType: string, name: string): Promise<boolean> {
  const dashboard: FrpsDashboardConfig = {
    scheme: env.FRPS_DASHBOARD_SCHEME,
    host: env.FRPS_DASHBOARD_HOST,
    port: env.FRPS_DASHBOARD_PORT,
    user: env.FRPS_DASHBOARD_USER,
    password: env.FRPS_DASHBOARD_PASSWORD,
  };

  try {
    const auth = Buffer.from(`${dashboard.user}:${dashboard.password}`).toString('base64');
    const url = `${dashboard.scheme}://${dashboard.host}:${dashboard.port}/api/proxy/${proxyType}/${encodeURIComponent(name)}`;
    const response = await fetch(url, {
      method: 'DELETE',
      headers: { Authorization: `Basic ${auth}` },
      signal: AbortSignal.timeout(5_000),
    });
    return response.ok;
  } catch {
    return false;
  }
}

/**
 * On server startup, detect proxies on frps that don't correspond to any
 * known client HTTP control mapping or business port mapping, and clean
 * them up so stale dev artifacts don't accumulate.
 */
export async function cleanupStaleFrpsProxies(): Promise<{ removed: string[]; errors: string[] }> {
  const dashboard: FrpsDashboardConfig = {
    scheme: env.FRPS_DASHBOARD_SCHEME,
    host: env.FRPS_DASHBOARD_HOST,
    port: env.FRPS_DASHBOARD_PORT,
    user: env.FRPS_DASHBOARD_USER,
    password: env.FRPS_DASHBOARD_PASSWORD,
  };

  const result = await listFrpsProxies(dashboard);
  if (!result.dashboardReachable) {
    console.warn('[frps-cleanup] dashboard unreachable, skipping stale proxy cleanup');
    return { removed: [], errors: [] };
  }

  // Build the set of known proxy names
  const knownNames = new Set<string>();

  // Client HTTP control proxies
  for (const client of clientsService.listClients()) {
    knownNames.add(`rag-${client.id}-http-control`);
  }

  // Business port mappings
  const db = getDb();
  const mappingStmt = db.prepare('SELECT name FROM port_mappings WHERE name IS NOT NULL');
  while (mappingStmt.step()) {
    const row = mappingStmt.getAsObject() as { name: string };
    knownNames.add(row.name);
  }
  mappingStmt.free();

  // Auto-mapping proxies (only active ones for currently online clients)
  const autoMappingStmt = db.prepare(`
    SELECT DISTINCT pm.name
    FROM auto_mappings am
    JOIN port_mappings pm ON pm.id = am.mapping_id
    JOIN clients c ON c.id = am.client_id
    WHERE pm.name IS NOT NULL
      AND am.status = 'active'
      AND c.status = 'online'
  `);
  while (autoMappingStmt.step()) {
    const row = autoMappingStmt.getAsObject() as { name: string };
    knownNames.add(row.name);
  }
  autoMappingStmt.free();

  const removed: string[] = [];
  const errors: string[] = [];

  for (const proxy of result.proxies) {
    if (knownNames.has(proxy.name)) continue;

    const deleted = await deleteFrpsProxy(proxy.proxyType, proxy.name);
    if (deleted) {
      console.log(`[frps-cleanup] removed stale proxy: ${proxy.proxyType}/${proxy.name} (port ${proxy.remotePort ?? '?'})`);
      removed.push(proxy.name);
    } else {
      errors.push(proxy.name);
    }
  }

  if (removed.length > 0) {
    console.log(`[frps-cleanup] removed ${removed.length} stale proxy(s)`);
  }
  if (errors.length > 0) {
    console.warn(`[frps-cleanup] failed to remove ${errors.length} proxy(s): ${errors.join(', ')}`);
  }

  return { removed, errors };
}
