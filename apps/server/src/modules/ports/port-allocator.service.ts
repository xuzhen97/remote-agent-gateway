import { env } from '../../config/env.js';
import { getDb } from '../../db/index.js';
import { auditService } from '../audit/audit.service.js';
import {
  type FrpsDashboardConfig,
  listFrpsProxies,
} from '../frp/frps-dashboard.service.js';

export class PortConflictError extends Error {
  readonly source: 'db' | 'dashboard' | 'range';
  readonly port: number;

  constructor(message: string, source: 'db' | 'dashboard' | 'range', port: number) {
    super(message);
    this.name = 'PortConflictError';
    this.source = source;
    this.port = port;
  }
}

export class NoAvailablePortError extends Error {
  constructor(message = 'No available ports in FRP range') {
    super(message);
    this.name = 'NoAvailablePortError';
  }
}

export interface PortUsageReport {
  dbPorts: number[];
  dashboardPorts: number[];
}

export interface ReconcileResult {
  ok: true;
  usage: PortUsageReport;
}

interface PortAllocatorDeps {
  portRange?: { start: number; end: number };
  dashboardConfig?: FrpsDashboardConfig;
  listFrpsProxies?: typeof listFrpsProxies;
  auditLog?: typeof auditService.log;
  reservePort?: (port: number, clientId: string) => Promise<void> | void;
}

export class PortAllocatorService {
  private readonly portRange: { start: number; end: number };
  private readonly dashboardConfig: FrpsDashboardConfig;
  private readonly listFrpsProxiesFn: typeof listFrpsProxies;
  private readonly auditLogFn: typeof auditService.log;
  private readonly reservePortFn: NonNullable<PortAllocatorDeps['reservePort']>;
  private allocationQueue: Promise<unknown> = Promise.resolve();
  private dashboardCache: { expiresAt: number; ports: Set<number> } | null = null;

  constructor(deps: PortAllocatorDeps = {}) {
    this.portRange = deps.portRange ?? {
      start: env.FRP_PORT_RANGE_START,
      end: env.FRP_PORT_RANGE_END,
    };
    this.dashboardConfig = deps.dashboardConfig ?? {
      scheme: env.FRPS_DASHBOARD_SCHEME,
      host: env.FRPS_DASHBOARD_HOST,
      port: env.FRPS_DASHBOARD_PORT,
      user: env.FRPS_DASHBOARD_USER,
      password: env.FRPS_DASHBOARD_PASSWORD,
    };
    this.listFrpsProxiesFn = deps.listFrpsProxies ?? listFrpsProxies;
    this.auditLogFn = deps.auditLog ?? auditService.log.bind(auditService);
    this.reservePortFn = deps.reservePort ?? (() => undefined);
  }

  async allocate(
    clientId: string,
    options?: {
      preferredPort?: number;
      reserve?: (port: number, clientId: string) => Promise<void> | void;
    },
  ): Promise<number> {
    return this.withLock(async () => {
      const usedDbPorts = this.loadUsedDbPorts();
      const dashboardState = await this.loadDashboardState();
      const preferredPort = options?.preferredPort;
      const reservePort = options?.reserve ?? this.reservePortFn;

      if (typeof preferredPort === 'number') {
        this.assertInRange(preferredPort);
        this.assertPreferredPortAvailable(preferredPort, usedDbPorts, dashboardState.ports);
        await reservePort(preferredPort, clientId);
        return preferredPort;
      }

      for (let port = this.portRange.start; port <= this.portRange.end; port += 1) {
        if (usedDbPorts.has(port)) continue;

        if (dashboardState.ports.has(port)) {
          if (dashboardState.reachable) {
            this.auditLogFn({
              action: 'port_allocator.external_occupy',
              detail: `port ${port} occupied on dashboard but not in DB`,
              targetType: 'port',
              targetId: String(port),
            });
          }
          continue;
        }

        await reservePort(port, clientId);
        return port;
      }

      throw new NoAvailablePortError();
    });
  }

  release(_port: number): void {
    // currently no-op; DB deletion remains the source of truth
  }

  async isAvailable(port: number): Promise<boolean> {
    try {
      this.assertInRange(port);
    } catch {
      return false;
    }

    const usedDbPorts = this.loadUsedDbPorts();
    if (usedDbPorts.has(port)) return false;

    const dashboardState = await this.loadDashboardState();
    if (dashboardState.ports.has(port)) return false;

    return true;
  }

  async isAvailableForClientHttp(port: number, clientId: string): Promise<boolean> {
    try {
      this.assertInRange(port);
    } catch {
      return false;
    }

    const db = getDb();
    const stmt = db.prepare('SELECT id FROM clients WHERE http_remote_port = ? AND id != ?');
    stmt.bind([port, clientId]);
    const usedByOtherClient = stmt.step();
    stmt.free();
    if (usedByOtherClient) return false;

    const businessStmt = db.prepare('SELECT id FROM port_mappings WHERE remote_port = ?');
    businessStmt.bind([port]);
    const usedByBusinessMapping = businessStmt.step();
    businessStmt.free();
    if (usedByBusinessMapping) return false;

    const dashboardState = await this.loadDashboardState();
    if (dashboardState.ports.has(port)) {
      const ownControlProxyName = `rag-${clientId}-http-control`;
      const dashboardResult = await this.listFrpsProxiesFn(this.dashboardConfig);
      if (!dashboardResult.dashboardReachable) return false;
      const conflictingProxy = dashboardResult.proxies.find((proxy) => proxy.remotePort === port && proxy.name !== ownControlProxyName);
      if (conflictingProxy) return false;
    }

    return true;
  }

  async getUsage(): Promise<PortUsageReport> {
    const dashboardState = await this.loadDashboardState();
    return {
      dbPorts: [...this.loadUsedDbPorts()].sort((a, b) => a - b),
      dashboardPorts: [...dashboardState.ports].sort((a, b) => a - b),
    };
  }

  async reconcile(): Promise<ReconcileResult> {
    return {
      ok: true,
      usage: await this.getUsage(),
    };
  }

  private async withLock<T>(work: () => Promise<T>): Promise<T> {
    const next = this.allocationQueue.then(work, work);
    this.allocationQueue = next.then(() => undefined, () => undefined);
    return next;
  }

  private assertInRange(port: number): void {
    if (port < this.portRange.start || port > this.portRange.end) {
      throw new PortConflictError(`Remote port ${port} is outside the configured range`, 'range', port);
    }
  }

  private assertPreferredPortAvailable(port: number, usedDbPorts: Set<number>, dashboardPorts: Set<number>): void {
    if (usedDbPorts.has(port)) {
      throw new PortConflictError(`Remote port ${port} already exists in DB`, 'db', port);
    }
    if (dashboardPorts.has(port)) {
      throw new PortConflictError(`Remote port ${port} already exists on dashboard`, 'dashboard', port);
    }
  }

  private loadUsedDbPorts(): Set<number> {
    const db = getDb();
    const used = new Set<number>();
    const stmt = db.prepare('SELECT remote_port FROM port_mappings WHERE remote_port IS NOT NULL');
    while (stmt.step()) {
      const row = stmt.getAsObject() as { remote_port: number };
      if (typeof row.remote_port === 'number') used.add(row.remote_port);
    }
    stmt.free();

    const clientStmt = db.prepare('SELECT http_remote_port FROM clients WHERE http_remote_port IS NOT NULL');
    while (clientStmt.step()) {
      const row = clientStmt.getAsObject() as { http_remote_port: number };
      if (typeof row.http_remote_port === 'number') used.add(row.http_remote_port);
    }
    clientStmt.free();

    return used;
  }

  private async loadDashboardState(): Promise<{ reachable: boolean; ports: Set<number> }> {
    if (this.dashboardCache && this.dashboardCache.expiresAt > Date.now()) {
      return {
        reachable: true,
        ports: new Set(this.dashboardCache.ports),
      };
    }

    const result = await this.listFrpsProxiesFn(this.dashboardConfig);

    if (!result.dashboardReachable) {
      console.warn(`[port-allocator] dashboard unreachable: ${result.detail ?? 'unknown error'}`);
      this.auditLogFn({
        action: 'port_allocator.dashboard_unreachable',
        detail: result.detail ?? 'dashboard unreachable',
        targetType: 'frps_dashboard',
      });
      return { reachable: false, ports: new Set<number>() };
    }

    const ports = new Set(
      result.proxies.flatMap((proxy) => (typeof proxy.remotePort === 'number' ? [proxy.remotePort] : [])),
    );

    this.dashboardCache = {
      expiresAt: Date.now() + 30_000,
      ports,
    };

    return {
      reachable: true,
      ports: new Set(ports),
    };
  }
}

export const portAllocatorService = new PortAllocatorService();
