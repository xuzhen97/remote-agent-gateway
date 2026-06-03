import { randomUUID } from 'node:crypto';
import { addMapping, loadMappings, removeMapping, type ClientBusinessMapping } from './frp-mapping-store.js';
import { type ControlHttpRouter } from './router.js';
import { readJson, sendError, sendOk } from './response.js';
import { requireBearerToken } from './auth.js';
import { rebuildFrpcDaemon } from '../frpc-daemon.js';
import type { ClientConfig } from '../../config/client.config.js';

const CONTROL_ID = 'http-control';

export function registerFrpRoutes(router: ControlHttpRouter, options: {
  token: string;
  clientId: string;
  apiBaseUrl?: string;
  serverToken?: string;
  frpcWorkDir?: string;
  frpcPath?: string;
  workspaceDir?: string;
}): void {
  const workDir = options.frpcWorkDir ?? options.workspaceDir ?? '.';

  function listAll() {
    const business = loadMappings(workDir).map((m) => ({ ...m, kind: 'business' as const }));
    const system = {
      id: CONTROL_ID,
      name: `rag-${options.clientId}-http-control`,
      type: 'tcp' as const,
      localHost: '127.0.0.1',
      localPort: 0,
      kind: 'system' as const,
      protected: true,
    };
    return [system, ...business];
  }

  router.add('GET', /^\/frp\/mappings$/, (req, res) => {
    if (!requireBearerToken(req, res, options.token)) return;
    sendOk(res, { mappings: listAll() });
  });

  router.add('POST', /^\/frp\/mappings$/, async (req, res) => {
    if (!requireBearerToken(req, res, options.token)) return;
    try {
      const payload = await readJson<{
        name: string;
        type: 'tcp' | 'http' | 'https';
        localHost?: string;
        localPort: number;
        remotePort?: number | null;
        customDomain?: string;
      }>(req);

      let allocated: { id: string; remotePort?: number; publicUrl?: string };

      if (options.apiBaseUrl && options.serverToken) {
        const resp = await fetch(`${options.apiBaseUrl}/api/client-http/ports/allocate`, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${options.serverToken}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            clientId: options.clientId,
            name: payload.name,
            proxyType: payload.type,
            localIp: payload.localHost ?? '127.0.0.1',
            localPort: payload.localPort,
            remotePort: payload.remotePort ?? undefined,
            customDomain: payload.customDomain,
          }),
        });
        if (!resp.ok) {
          const errBody: any = await resp.json().catch(() => ({}));
          throw new Error(errBody?.error ?? `Server returned ${resp.status}`);
        }
        const data: any = await resp.json();
        allocated = { id: data.id, remotePort: data.remotePort, publicUrl: data.publicUrl };
      } else {
        allocated = { id: `pm_${randomUUID().slice(0, 8)}`, remotePort: payload.remotePort ?? undefined };
      }

      const mapping: ClientBusinessMapping = {
        id: allocated.id,
        kind: 'business',
        name: payload.name,
        type: payload.type,
        localHost: payload.localHost ?? '127.0.0.1',
        localPort: payload.localPort,
        remotePort: allocated.remotePort,
        customDomain: payload.customDomain,
        publicUrl: allocated.publicUrl,
      };

      addMapping(workDir, mapping);

      if (options.frpcPath) {
        rebuildFrpcDaemon({ frpcPath: options.frpcPath, frpcWorkDir: options.frpcWorkDir } as ClientConfig);
      }

      sendOk(res, { ...mapping, kind: 'business' });
    } catch (err) {
      sendError(res, 400, 'FRP_CONFIG_ERROR', err instanceof Error ? err.message : String(err));
    }
  });

  router.add('DELETE', /^\/frp\/mappings\/[^/]+$/, (req, res, url) => {
    if (!requireBearerToken(req, res, options.token)) return;
    const mappingId = url.pathname.split('/')[3];

    if (mappingId === CONTROL_ID) {
      return sendError(res, 409, 'CONFLICT', 'Cannot delete protected HTTP control mapping');
    }

    const before = loadMappings(workDir).find((m) => m.id === mappingId);
    if (!before) return sendError(res, 404, 'NOT_FOUND', 'Mapping not found');

    removeMapping(workDir, mappingId);

    // Notify server so it can delete the DB record
    if (options.apiBaseUrl && options.serverToken) {
      fetch(`${options.apiBaseUrl}/api/client-http/ports/${encodeURIComponent(mappingId)}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${options.serverToken}` },
      }).catch(() => {});
    }

    if (options.frpcPath) {
      rebuildFrpcDaemon({ frpcPath: options.frpcPath, frpcWorkDir: options.frpcWorkDir } as ClientConfig);
    }

    sendOk(res, { id: mappingId, deleted: true });
  });
}
