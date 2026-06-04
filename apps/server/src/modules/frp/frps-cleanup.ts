import { env } from '../../config/env.js';
import { getDb } from '../../db/index.js';
import { listFrpsProxies, type FrpsDashboardConfig } from './frps-dashboard.service.js';
import { clientsService } from '../clients/clients.service.js';

function getDashboardConfig(): FrpsDashboardConfig {
  return {
    scheme: env.FRPS_DASHBOARD_SCHEME,
    host: env.FRPS_DASHBOARD_HOST,
    port: env.FRPS_DASHBOARD_PORT,
    user: env.FRPS_DASHBOARD_USER,
    password: env.FRPS_DASHBOARD_PASSWORD,
  };
}

function buildDashboardHeaders(dashboard: FrpsDashboardConfig) {
  return {
    Authorization: `Basic ${Buffer.from(`${dashboard.user}:${dashboard.password}`).toString('base64')}`,
  };
}

/**
 * Delete a single proxy from the frps dashboard.
 */
async function deleteFrpsProxy(proxyType: string, name: string): Promise<boolean> {
  const dashboard = getDashboardConfig();

  try {
    const url = `${dashboard.scheme}://${dashboard.host}:${dashboard.port}/api/proxy/${proxyType}/${encodeURIComponent(name)}`;
    const response = await fetch(url, {
      method: 'DELETE',
      headers: buildDashboardHeaders(dashboard),
      signal: AbortSignal.timeout(5_000),
    });
    return response.ok;
  } catch {
    return false;
  }
}

async function clearOfflineFrpsProxies(): Promise<boolean> {
  const dashboard = getDashboardConfig();
  try {
    const response = await fetch(`${dashboard.scheme}://${dashboard.host}:${dashboard.port}/api/proxies?status=offline`, {
      method: 'DELETE',
      headers: buildDashboardHeaders(dashboard),
      signal: AbortSignal.timeout(5_000),
    });
    return response.ok;
  } catch {
    return false;
  }
}

async function getFrpsProxyStatus(proxyType: 'tcp' | 'http' | 'https', name: string): Promise<'online' | 'offline' | 'missing' | 'unknown'> {
  const dashboard = getDashboardConfig();
  try {
    const response = await fetch(`${dashboard.scheme}://${dashboard.host}:${dashboard.port}/api/proxy/${proxyType}/${encodeURIComponent(name)}`, {
      headers: buildDashboardHeaders(dashboard),
      signal: AbortSignal.timeout(5_000),
    });
    if (response.status === 404) return 'missing';
    if (!response.ok) return 'unknown';
    const body = await response.json() as { status?: string; conf?: unknown };
    if (body.status === 'offline' || body.conf == null) return 'offline';
    if (body.status === 'online') return 'online';
    return 'unknown';
  } catch {
    return 'unknown';
  }
}

export async function cleanupDeletedProxyFromDashboard(input: {
  proxyType: 'tcp' | 'http' | 'https';
  name: string;
  timeoutMs?: number;
  intervalMs?: number;
}): Promise<boolean> {
  const timeoutMs = input.timeoutMs ?? 15_000;
  const intervalMs = input.intervalMs ?? 1_000;
  const startedAt = Date.now();

  while (Date.now() - startedAt <= timeoutMs) {
    const status = await getFrpsProxyStatus(input.proxyType, input.name);
    if (status === 'missing') return true;
    if (status === 'offline') {
      const cleared = await clearOfflineFrpsProxies();
      if (!cleared) return false;
    }
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }

  return false;
}

/**
 * On server startup, detect proxies on frps that don't correspond to any
 * known client HTTP control mapping or business port mapping, and clean
 * them up so stale dev artifacts don't accumulate.
 */
export async function cleanupStaleFrpsProxies(): Promise<{ removed: string[]; errors: string[] }> {
  const dashboard = getDashboardConfig();

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
