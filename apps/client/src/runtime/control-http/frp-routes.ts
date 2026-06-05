import { randomUUID } from 'node:crypto';
import { addMapping, loadMappings, removeMapping, type ClientBusinessMapping } from './frp-mapping-store.js';
import { type ControlHttpRouter } from './router.js';
import { readJson, sendError, sendOk } from './response.js';
import { requireBearerToken } from './auth.js';
import { rebuildFrpcDaemon } from '../frpc-daemon.js';
import type { ClientConfig } from '../../config/client.config.js';
import type { TaskAuditExecutor } from './task-audit.js';

const CONTROL_ID = 'http-control';
const DEFAULT_LOCAL_HOST = '127.0.0.1';

interface FrpRouteOptions {
  token: string;
  clientId: string;
  apiBaseUrl?: string;
  serverToken?: string;
  frpcWorkDir?: string;
  frpcPath?: string;
  workspaceDir?: string;
}

interface CreateMappingRequest {
  name: string;
  type: 'tcp' | 'http' | 'https';
  localHost?: string;
  localPort: number;
  remotePort?: number | null;
  customDomain?: string;
}

interface AllocatedMapping {
  id: string;
  remotePort?: number;
  publicUrl?: string;
}

export function registerFrpRoutes(
  router: ControlHttpRouter,
  options: FrpRouteOptions,
  audit: TaskAuditExecutor,
): void {
  const workDir = options.frpcWorkDir ?? options.workspaceDir ?? '.';

  router.add('GET', /^\/frp\/mappings$/, (req, res) => {
    if (!requireBearerToken(req, res, options.token)) return;
    sendOk(res, { mappings: listMappings(options, workDir) });
  });

  router.add('POST', /^\/frp\/mappings$/, async (req, res) => {
    if (!requireBearerToken(req, res, options.token)) return;

    try {
      const payload = await readJson<CreateMappingRequest>(req);
      const body = await audit.execute({
        req, actionType: 'frp_mapping.create', resourceType: 'frp_mapping',
        method: 'POST', path: '/frp/mappings', payload: payload as unknown as Record<string, unknown>,
        run: async () => {
          const allocated = await allocateMapping(options, payload);
          const mapping = buildBusinessMapping(payload, allocated);
          addMapping(workDir, mapping);
          return {
            httpStatus: 200,
            resultSummary: { id: mapping.id, remotePort: mapping.remotePort, publicUrl: mapping.publicUrl },
            targetId: mapping.id,
            status: 'success',
            body: mapping,
          };
        },
      });
      res.on('finish', () => {
        try {
          rebuildIfConfigured(options);
        } catch (error) {
          console.error('[frp-routes] rebuild failed after create response:', error instanceof Error ? error.message : String(error));
        }
      });
      sendOk(res, body);
    } catch (err) {
      sendError(res, 400, 'FRP_CONFIG_ERROR', err instanceof Error ? err.message : String(err));
    }
  });

  router.add('DELETE', /^\/frp\/mappings\/[^/]+$/, async (req, res, url) => {
    if (!requireBearerToken(req, res, options.token)) return;

    const mappingId = url.pathname.split('/')[3];
    if (mappingId === CONTROL_ID) {
      return sendError(res, 409, 'CONFLICT', 'Cannot delete protected HTTP control mapping');
    }

    const mapping = loadMappings(workDir).find((entry) => entry.id === mappingId);
    if (!mapping) return sendError(res, 404, 'NOT_FOUND', 'Mapping not found');

    try {
      const body = await audit.execute({
        req, actionType: 'frp_mapping.delete', resourceType: 'frp_mapping',
        method: 'DELETE', path: `/frp/mappings/${mappingId}`, payload: { mappingId },
        run: async () => {
          await deleteServerMapping(options, mappingId);
          removeMapping(workDir, mappingId);
          await cleanupDashboardMapping(options, { name: mapping.name, type: mapping.type });
          return { httpStatus: 200, resultSummary: { deleted: true }, targetId: mappingId, status: 'success', body: { id: mappingId, deleted: true } };
        },
      });
      res.on('finish', () => {
        try {
          rebuildIfConfigured(options);
        } catch (error) {
          console.error('[frp-routes] rebuild failed after delete response:', error instanceof Error ? error.message : String(error));
        }
      });
      sendOk(res, body);
    } catch (err) {
      sendError(res, 400, 'FRP_CONFIG_ERROR', err instanceof Error ? err.message : String(err));
    }
  });
}

function listMappings(options: FrpRouteOptions, workDir: string): unknown[] {
  return [buildSystemMapping(options.clientId), ...loadMappings(workDir)];
}

function buildSystemMapping(clientId: string): Record<string, unknown> {
  return {
    id: CONTROL_ID,
    name: `rag-${clientId}-http-control`,
    type: 'tcp',
    localHost: DEFAULT_LOCAL_HOST,
    localPort: 0,
    kind: 'system',
    protected: true,
  };
}

async function allocateMapping(options: FrpRouteOptions, payload: CreateMappingRequest): Promise<AllocatedMapping> {
  if (!options.apiBaseUrl || !options.serverToken) {
    return { id: `pm_${randomUUID().slice(0, 8)}`, remotePort: payload.remotePort ?? undefined };
  }

  const response = await fetch(`${options.apiBaseUrl}/api/client-http/ports/allocate`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${options.serverToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      clientId: options.clientId,
      name: payload.name,
      proxyType: payload.type,
      localIp: payload.localHost ?? DEFAULT_LOCAL_HOST,
      localPort: payload.localPort,
      remotePort: payload.remotePort ?? undefined,
      customDomain: payload.customDomain,
    }),
  });

  if (!response.ok) {
    const errBody = await response.json().catch(() => ({})) as { error?: string };
    throw new Error(errBody.error ?? `Server returned ${response.status}`);
  }

  const data = await response.json() as { id: string; remotePort?: number; publicUrl?: string };
  return { id: data.id, remotePort: data.remotePort, publicUrl: data.publicUrl };
}

function buildBusinessMapping(payload: CreateMappingRequest, allocated: AllocatedMapping): ClientBusinessMapping {
  return {
    id: allocated.id,
    kind: 'business',
    name: payload.name,
    type: payload.type,
    localHost: payload.localHost ?? DEFAULT_LOCAL_HOST,
    localPort: payload.localPort,
    remotePort: allocated.remotePort,
    customDomain: payload.customDomain,
    publicUrl: allocated.publicUrl,
  };
}

async function deleteServerMapping(options: FrpRouteOptions, mappingId: string): Promise<void> {
  if (!options.apiBaseUrl || !options.serverToken) return;

  const response = await fetch(`${options.apiBaseUrl}/api/client-http/ports/${encodeURIComponent(mappingId)}`, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${options.serverToken}` },
  });

  if (response.ok) return;

  const body = await response.json().catch(() => null) as { error?: string; message?: string; ok?: boolean; errorCode?: string; } | null;
  throw new Error(body?.error ?? body?.message ?? `Server returned ${response.status}`);
}

async function cleanupDashboardMapping(options: FrpRouteOptions, mapping: { name: string; type: 'tcp' | 'http' | 'https' }): Promise<void> {
  if (!options.apiBaseUrl || !options.serverToken) return;

  const response = await fetch(`${options.apiBaseUrl}/api/client-http/ports/cleanup-dashboard`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${options.serverToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ name: mapping.name, proxyType: mapping.type }),
  });

  if (response.ok) return;

  const body = await response.json().catch(() => null) as { error?: string; message?: string } | null;
  throw new Error(body?.error ?? body?.message ?? `Server returned ${response.status}`);
}

function rebuildIfConfigured(options: FrpRouteOptions): void {
  if (!options.frpcPath) return;
  rebuildFrpcDaemon({ frpcPath: options.frpcPath, frpcWorkDir: options.frpcWorkDir } as ClientConfig);
}
