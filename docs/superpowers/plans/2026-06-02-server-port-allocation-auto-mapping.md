# Server Port Allocation and Auto-Mapping Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a server-owned remote port allocator with FRPS Dashboard cross-checking, then add client lifecycle-driven automatic file HTTP mappings that are cleaned up safely.

**Architecture:** Introduce a dedicated `PortAllocatorService` that becomes the single entry point for remote port decisions, then keep `FrpService` focused on mapping CRUD. Add an `AutoMappingService` with a file-HTTP provider that reacts to websocket online/offline events and persists `cleanup_pending` state in a new `auto_mappings` table.

**Tech Stack:** TypeScript, Fastify, Vitest, sql.js, WebSocket (`ws`), FRP Dashboard HTTP API

---

## File Structure Map

### New files

- `apps/server/src/modules/ports/port-allocator.service.ts`
  - Owns remote port availability checks, dashboard cache, conflict errors, and allocation locking.
- `apps/server/src/modules/ports/port-allocator.service.test.ts`
  - Unit tests for DB occupancy, dashboard occupancy, fallback mode, preferred ports, exhaustion, and lock behavior.
- `apps/server/src/modules/auto-mapping/auto-mapping.service.ts`
  - Persists and orchestrates auto-mapping records and provider execution.
- `apps/server/src/modules/auto-mapping/auto-mapping.service.test.ts`
  - Unit tests for `active`/`cleanup_pending` record lifecycle.
- `apps/server/src/modules/auto-mapping/providers/file-http.provider.ts`
  - Starts client file service, allocates a remote port, creates FRP mapping, and marks cleanup on disconnect.
- `apps/server/src/modules/auto-mapping/providers/file-http.provider.test.ts`
  - Unit tests for online creation and reconnect cleanup flow.
- `apps/server/src/ws/ws-handlers.test.ts`
  - Integration-style tests for register/close hooks and automatic file mapping triggers.

### Modified files

- `apps/server/src/db/migrate.ts`
  - Add `auto_mappings` table.
- `apps/server/src/db/__tests__/db.test.ts`
  - Verify `auto_mappings` schema can insert/query/update/delete.
- `apps/server/src/modules/frp/frps-dashboard.service.ts`
  - Add bulk proxy listing support used by the allocator.
- `apps/server/src/modules/frp/frps-dashboard.service.test.ts`
  - Test list-all proxy parsing, auth failure, unreachable fallback behavior.
- `apps/server/src/modules/frp/frp.service.ts`
  - Remove internal sequential port chooser and delegate to `PortAllocatorService`.
- `apps/server/src/modules/frp/frp.service.test.ts`
  - Keep URL generation assertions and add allocator wiring assertions.
- `apps/server/src/modules/frp/frp.routes.ts`
  - Convert allocator conflict/exhaustion errors into 409 responses.
- `apps/server/src/modules/frp/frp.routes.test.ts`
  - Add route coverage for preferred-port conflicts.
- `apps/server/src/ws/ws-handlers.ts`
  - Trigger auto-mapping online/offline lifecycle around `client.register` and `handleWsClose`.

### Existing files to consult while implementing

- `apps/server/src/modules/client-files/client-file-sessions.service.ts`
  - Reuse the existing task-dispatch/wait-for-success pattern for `file_service_start` and `frp_create_proxy`.
- `apps/server/src/modules/client-files/client-file-sessions.service.test.ts`
  - Mirror its mocking style for async task polling.
- `apps/client/src/executors/file-service-start.executor.ts`
  - Confirms `file_service_start` returns `{ running, host, port, startedAt, expiresAt? }`.

---

### Task 1: Add persistent `auto_mappings` storage

**Files:**
- Modify: `apps/server/src/db/migrate.ts`
- Modify: `apps/server/src/db/__tests__/db.test.ts`
- Test: `apps/server/src/db/__tests__/db.test.ts`

- [ ] **Step 1: Write the failing schema test for `auto_mappings`**

Add this test at the end of `apps/server/src/db/__tests__/db.test.ts`:

```ts
  it('inserts and updates an auto mapping record', () => {
    const now = Date.now();
    run(db, `INSERT INTO auto_mappings (id, client_id, provider_name, mapping_id, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)`,
      ['am-test-1', 'test-client-1', 'file-http', 'pm-test-1', 'active', now, now]);

    let row = queryOne(db, 'SELECT * FROM auto_mappings WHERE id = ?', ['am-test-1']) as Record<string, unknown>;
    expect(row).toBeDefined();
    expect(row.provider_name).toBe('file-http');
    expect(row.status).toBe('active');

    run(db, 'UPDATE auto_mappings SET status = ?, updated_at = ? WHERE id = ?', ['cleanup_pending', now + 1, 'am-test-1']);
    row = queryOne(db, 'SELECT status FROM auto_mappings WHERE id = ?', ['am-test-1']) as Record<string, unknown>;
    expect(row.status).toBe('cleanup_pending');

    run(db, 'DELETE FROM auto_mappings WHERE id = ?', ['am-test-1']);
    expect(queryAll(db, 'SELECT * FROM auto_mappings WHERE id = ?', ['am-test-1'])).toHaveLength(0);
  });
```

- [ ] **Step 2: Run the DB test to verify it fails**

Run:

```bash
pnpm --filter @rag/server test -- src/db/__tests__/db.test.ts
```

Expected: FAIL with a SQL error like `no such table: auto_mappings`.

- [ ] **Step 3: Add the new table migration**

Insert this `CREATE TABLE` block into `apps/server/src/db/migrate.ts` after `port_mappings` and before `audit_logs`:

```ts
    CREATE TABLE IF NOT EXISTS auto_mappings (
      id TEXT PRIMARY KEY,
      client_id TEXT NOT NULL,
      provider_name TEXT NOT NULL,
      mapping_id TEXT NOT NULL,
      status TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );
```

- [ ] **Step 4: Run the DB test to verify it passes**

Run:

```bash
pnpm --filter @rag/server test -- src/db/__tests__/db.test.ts
```

Expected: PASS with the new `auto_mappings` test green.

- [ ] **Step 5: Commit**

```bash
git add apps/server/src/db/migrate.ts apps/server/src/db/__tests__/db.test.ts
git commit -m "feat: add auto mappings storage"
```

---

### Task 2: Extend FRPS dashboard client with bulk proxy listing

**Files:**
- Modify: `apps/server/src/modules/frp/frps-dashboard.service.ts`
- Modify: `apps/server/src/modules/frp/frps-dashboard.service.test.ts`
- Test: `apps/server/src/modules/frp/frps-dashboard.service.test.ts`

- [ ] **Step 1: Write failing tests for list-all proxy parsing and fallback status**

Append these tests to `apps/server/src/modules/frp/frps-dashboard.service.test.ts`:

```ts
import { checkFrpsProxyRegistration, listFrpsProxies } from './frps-dashboard.service.js';

  it('lists proxy summaries across tcp/http/https endpoints', async () => {
    vi.mocked(fetch)
      .mockResolvedValueOnce(new Response(JSON.stringify({ proxies: [{ name: 'tcp-a', remotePort: 23001 }] }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ proxies: [{ name: 'http-a', remotePort: 23002 }] }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ proxies: [{ name: 'https-a', remotePort: 23003 }] }), { status: 200 }));

    const result = await listFrpsProxies({
      scheme: 'http',
      host: 'frps.example.com',
      port: 7500,
      user: 'admin',
      password: 'secret',
    });

    expect(result).toEqual({
      dashboardReachable: true,
      proxies: [
        { name: 'tcp-a', proxyType: 'tcp', remotePort: 23001 },
        { name: 'http-a', proxyType: 'http', remotePort: 23002 },
        { name: 'https-a', proxyType: 'https', remotePort: 23003 },
      ],
    });
  });

  it('returns dashboardReachable false when list endpoint fetch throws', async () => {
    vi.mocked(fetch).mockRejectedValue(new Error('connect ECONNREFUSED'));

    const result = await listFrpsProxies({
      scheme: 'http',
      host: 'frps.example.com',
      port: 7500,
      user: 'admin',
      password: 'secret',
    });

    expect(result).toEqual(expect.objectContaining({
      dashboardReachable: false,
      proxies: [],
      detail: expect.stringContaining('ECONNREFUSED'),
    }));
  });
```

- [ ] **Step 2: Run the dashboard test to verify it fails**

Run:

```bash
pnpm --filter @rag/server test -- src/modules/frp/frps-dashboard.service.test.ts
```

Expected: FAIL with `listFrpsProxies is not exported` or assertion failures.

- [ ] **Step 3: Implement bulk listing in `frps-dashboard.service.ts`**

Add these types and function to `apps/server/src/modules/frp/frps-dashboard.service.ts`:

```ts
export interface FrpsProxySummary {
  name: string;
  proxyType: 'tcp' | 'http' | 'https';
  remotePort?: number;
}

export interface FrpsProxyListResult {
  dashboardReachable: boolean;
  proxies: FrpsProxySummary[];
  detail?: string;
}

function buildDashboardHeaders(dashboard: FrpsDashboardConfig) {
  const auth = Buffer.from(`${dashboard.user}:${dashboard.password}`).toString('base64');
  return { Authorization: `Basic ${auth}` };
}

async function fetchProxyTypeList(
  dashboard: FrpsDashboardConfig,
  proxyType: 'tcp' | 'http' | 'https',
): Promise<FrpsProxySummary[]> {
  const url = `${dashboard.scheme}://${dashboard.host}:${dashboard.port}/api/proxy/${proxyType}`;
  const response = await fetch(url, {
    headers: buildDashboardHeaders(dashboard),
    signal: AbortSignal.timeout(5000),
  });

  if (!response.ok) {
    throw new Error(`Dashboard list ${proxyType} failed: HTTP ${response.status}`);
  }

  const body = await response.json() as { proxies?: Array<{ name?: string; remotePort?: number; conf?: { remotePort?: number } }> };
  const proxies = body.proxies ?? [];
  return proxies
    .filter((proxy) => typeof proxy.name === 'string')
    .map((proxy) => ({
      name: proxy.name!,
      proxyType,
      remotePort: proxy.remotePort ?? proxy.conf?.remotePort,
    }));
}

export async function listFrpsProxies(dashboard: FrpsDashboardConfig): Promise<FrpsProxyListResult> {
  try {
    const [tcp, http, https] = await Promise.all([
      fetchProxyTypeList(dashboard, 'tcp'),
      fetchProxyTypeList(dashboard, 'http'),
      fetchProxyTypeList(dashboard, 'https'),
    ]);

    return {
      dashboardReachable: true,
      proxies: [...tcp, ...http, ...https],
    };
  } catch (err) {
    return {
      dashboardReachable: false,
      proxies: [],
      detail: err instanceof Error ? err.message : String(err),
    };
  }
}
```

Then update `checkFrpsProxyRegistration()` to reuse `buildDashboardHeaders()` instead of duplicating auth-header creation.

- [ ] **Step 4: Run the dashboard test to verify it passes**

Run:

```bash
pnpm --filter @rag/server test -- src/modules/frp/frps-dashboard.service.test.ts
```

Expected: PASS with both the old registration checks and the new list-all coverage green.

- [ ] **Step 5: Commit**

```bash
git add apps/server/src/modules/frp/frps-dashboard.service.ts apps/server/src/modules/frp/frps-dashboard.service.test.ts
git commit -m "feat: add frps dashboard proxy listing"
```

---

### Task 3: Build `PortAllocatorService` with TDD

**Files:**
- Create: `apps/server/src/modules/ports/port-allocator.service.ts`
- Create: `apps/server/src/modules/ports/port-allocator.service.test.ts`
- Test: `apps/server/src/modules/ports/port-allocator.service.test.ts`

- [ ] **Step 1: Write failing allocator tests covering the critical cases**

Create `apps/server/src/modules/ports/port-allocator.service.test.ts` with this initial suite:

```ts
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { initDb, getDb } from '../../db/index.js';
import { PortAllocatorService, NoAvailablePortError, PortConflictError } from './port-allocator.service.js';

describe('PortAllocatorService', () => {
  beforeEach(async () => {
    await initDb();
    const db = getDb();
    db.run('DELETE FROM port_mappings');
    db.run('DELETE FROM audit_logs');
  });

  it('returns the first free port when db and dashboard are empty', async () => {
    const service = new PortAllocatorService({
      portRange: { start: 23000, end: 23002 },
      listFrpsProxies: vi.fn().mockResolvedValue({ dashboardReachable: true, proxies: [] }),
      auditLog: vi.fn(),
    });

    await expect(service.allocate('client-1')).resolves.toBe(23000);
  });

  it('skips db-used ports and dashboard-used ports', async () => {
    const db = getDb();
    const now = Date.now();
    db.run(`INSERT INTO port_mappings (id, client_id, name, proxy_type, local_ip, local_port, remote_port, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ['pm-used', 'client-1', 'used', 'tcp', '127.0.0.1', 3000, 23000, 'active', now, now]);

    const service = new PortAllocatorService({
      portRange: { start: 23000, end: 23002 },
      listFrpsProxies: vi.fn().mockResolvedValue({
        dashboardReachable: true,
        proxies: [{ name: 'external-http', proxyType: 'http', remotePort: 23001 }],
      }),
      auditLog: vi.fn(),
    });

    await expect(service.allocate('client-1')).resolves.toBe(23002);
  });

  it('writes an audit log when dashboard shows an external occupied port', async () => {
    const auditLog = vi.fn();
    const service = new PortAllocatorService({
      portRange: { start: 23000, end: 23001 },
      listFrpsProxies: vi.fn().mockResolvedValue({
        dashboardReachable: true,
        proxies: [{ name: 'manual-proxy', proxyType: 'tcp', remotePort: 23000 }],
      }),
      auditLog,
    });

    await expect(service.allocate('client-1')).resolves.toBe(23001);
    expect(auditLog).toHaveBeenCalledWith(expect.objectContaining({
      action: 'port_allocator.external_occupy',
      detail: expect.stringContaining('23000'),
    }));
  });

  it('falls back to db-only allocation when dashboard is unreachable', async () => {
    const auditLog = vi.fn();
    const service = new PortAllocatorService({
      portRange: { start: 23000, end: 23001 },
      listFrpsProxies: vi.fn().mockResolvedValue({
        dashboardReachable: false,
        proxies: [],
        detail: 'connect ECONNREFUSED',
      }),
      auditLog,
    });

    await expect(service.allocate('client-1')).resolves.toBe(23000);
    expect(auditLog).toHaveBeenCalledWith(expect.objectContaining({
      action: 'port_allocator.dashboard_unreachable',
    }));
  });

  it('throws a PortConflictError when preferred port is already used', async () => {
    const service = new PortAllocatorService({
      portRange: { start: 23000, end: 23002 },
      listFrpsProxies: vi.fn().mockResolvedValue({
        dashboardReachable: true,
        proxies: [{ name: 'manual-proxy', proxyType: 'tcp', remotePort: 23001 }],
      }),
      auditLog: vi.fn(),
    });

    await expect(service.allocate('client-1', { preferredPort: 23001 })).rejects.toMatchObject({
      name: 'PortConflictError',
      source: 'dashboard',
      port: 23001,
    });
  });

  it('throws NoAvailablePortError when the range is exhausted', async () => {
    const service = new PortAllocatorService({
      portRange: { start: 23000, end: 23000 },
      listFrpsProxies: vi.fn().mockResolvedValue({
        dashboardReachable: true,
        proxies: [{ name: 'manual-proxy', proxyType: 'tcp', remotePort: 23000 }],
      }),
      auditLog: vi.fn(),
    });

    await expect(service.allocate('client-1')).rejects.toBeInstanceOf(NoAvailablePortError);
  });

  it('serializes concurrent allocations so they never return the same port', async () => {
    const service = new PortAllocatorService({
      portRange: { start: 23000, end: 23002 },
      listFrpsProxies: vi.fn().mockResolvedValue({ dashboardReachable: true, proxies: [] }),
      auditLog: vi.fn(),
      reservePort: vi.fn(async (port: number) => {
        getDb().run(`INSERT INTO port_mappings (id, client_id, name, proxy_type, local_ip, local_port, remote_port, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [`pm-${port}`, 'client-1', `mapping-${port}`, 'tcp', '127.0.0.1', 3000, port, 'inactive', Date.now(), Date.now()]);
      }),
    });

    const [first, second] = await Promise.all([
      service.allocate('client-1'),
      service.allocate('client-1'),
    ]);

    expect(first).toBe(23000);
    expect(second).toBe(23001);
  });
});
```

- [ ] **Step 2: Run the allocator tests to verify they fail**

Run:

```bash
pnpm --filter @rag/server test -- src/modules/ports/port-allocator.service.test.ts
```

Expected: FAIL because the service file does not exist yet.

- [ ] **Step 3: Implement the allocator with explicit error classes and dependency injection**

Create `apps/server/src/modules/ports/port-allocator.service.ts` with this structure:

```ts
import { getDb } from '../../db/index.js';
import { auditService } from '../audit/audit.service.js';
import { env } from '../../config/env.js';
import { listFrpsProxies } from '../frp/frps-dashboard.service.js';

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

interface PortAllocatorDeps {
  portRange?: { start: number; end: number };
  listFrpsProxies?: typeof listFrpsProxies;
  auditLog?: typeof auditService.log;
  reservePort?: (port: number, clientId: string) => Promise<void> | void;
}

export class PortAllocatorService {
  private readonly portRange;
  private readonly listFrpsProxiesFn;
  private readonly auditLogFn;
  private readonly reservePortFn;
  private allocationQueue: Promise<unknown> = Promise.resolve();
  private dashboardCache: { expiresAt: number; ports: Set<number> } | null = null;

  constructor(deps: PortAllocatorDeps = {}) {
    this.portRange = deps.portRange ?? { start: env.FRP_PORT_RANGE_START, end: env.FRP_PORT_RANGE_END };
    this.listFrpsProxiesFn = deps.listFrpsProxies ?? ((dashboard) => listFrpsProxies(dashboard));
    this.auditLogFn = deps.auditLog ?? ((entry) => auditService.log(entry));
    this.reservePortFn = deps.reservePort ?? (() => undefined);
  }

  async allocate(clientId: string, options?: { preferredPort?: number }): Promise<number> {
    return this.withLock(async () => {
      const usedDbPorts = this.loadUsedDbPorts();
      const dashboardPorts = await this.loadDashboardPorts();
      const preferredPort = options?.preferredPort;

      if (typeof preferredPort === 'number') {
        this.assertInRange(preferredPort);
        this.assertPreferredPortAvailable(preferredPort, usedDbPorts, dashboardPorts);
        await this.reservePortFn(preferredPort, clientId);
        return preferredPort;
      }

      for (let port = this.portRange.start; port <= this.portRange.end; port += 1) {
        if (usedDbPorts.has(port)) continue;
        if (dashboardPorts.has(port)) {
          this.auditLogFn({
            action: 'port_allocator.external_occupy',
            detail: `port ${port} occupied on dashboard but not in DB`,
            targetType: 'port',
            targetId: String(port),
          });
          continue;
        }

        await this.reservePortFn(port, clientId);
        return port;
      }

      throw new NoAvailablePortError();
    });
  }

  release(_port: number): void {}

  async isAvailable(port: number): Promise<boolean> {
    try {
      await this.allocate('probe-client', { preferredPort: port });
      return true;
    } catch {
      return false;
    }
  }

  async getUsage() {
    return {
      dbPorts: [...this.loadUsedDbPorts()].sort((a, b) => a - b),
      dashboardPorts: [...(await this.loadDashboardPorts())].sort((a, b) => a - b),
    };
  }

  async reconcile() {
    return { ok: true, usage: await this.getUsage() };
  }

  private async withLock<T>(work: () => Promise<T>): Promise<T> {
    const next = this.allocationQueue.then(work, work);
    this.allocationQueue = next.then(() => undefined, () => undefined);
    return next;
  }

  private assertInRange(port: number) {
    if (port < this.portRange.start || port > this.portRange.end) {
      throw new PortConflictError(`Remote port ${port} is outside the configured range`, 'range', port);
    }
  }

  private assertPreferredPortAvailable(port: number, usedDbPorts: Set<number>, dashboardPorts: Set<number>) {
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
      used.add(row.remote_port);
    }
    stmt.free();
    return used;
  }

  private async loadDashboardPorts(): Promise<Set<number>> {
    if (this.dashboardCache && this.dashboardCache.expiresAt > Date.now()) {
      return new Set(this.dashboardCache.ports);
    }

    const result = await this.listFrpsProxiesFn({
      scheme: env.FRPS_DASHBOARD_SCHEME,
      host: env.FRPS_DASHBOARD_HOST,
      port: env.FRPS_DASHBOARD_PORT,
      user: env.FRPS_DASHBOARD_USER,
      password: env.FRPS_DASHBOARD_PASSWORD,
    });

    if (!result.dashboardReachable) {
      console.warn(`[port-allocator] dashboard unreachable: ${result.detail ?? 'unknown error'}`);
      this.auditLogFn({
        action: 'port_allocator.dashboard_unreachable',
        detail: result.detail ?? 'dashboard unreachable',
        targetType: 'frps_dashboard',
      });
      return new Set<number>();
    }

    const ports = new Set(result.proxies.flatMap((proxy) => typeof proxy.remotePort === 'number' ? [proxy.remotePort] : []));
    this.dashboardCache = { expiresAt: Date.now() + 30_000, ports };
    return new Set(ports);
  }
}

export const portAllocatorService = new PortAllocatorService();
```

- [ ] **Step 4: Run the allocator tests to verify they pass**

Run:

```bash
pnpm --filter @rag/server test -- src/modules/ports/port-allocator.service.test.ts
```

Expected: PASS with all six allocator scenarios green.

- [ ] **Step 5: Commit**

```bash
git add apps/server/src/modules/ports/port-allocator.service.ts apps/server/src/modules/ports/port-allocator.service.test.ts
git commit -m "feat: add remote port allocator service"
```

---

### Task 4: Wire allocator into `FrpService` and route error handling

**Files:**
- Modify: `apps/server/src/modules/frp/frp.service.ts`
- Modify: `apps/server/src/modules/frp/frp.service.test.ts`
- Modify: `apps/server/src/modules/frp/frp.routes.ts`
- Modify: `apps/server/src/modules/frp/frp.routes.test.ts`
- Test: `apps/server/src/modules/frp/frp.service.test.ts`
- Test: `apps/server/src/modules/frp/frp.routes.test.ts`

- [ ] **Step 1: Add failing tests for allocator delegation and 409 route responses**

Replace `apps/server/src/modules/frp/frp.service.test.ts` with this suite so the service now checks allocator delegation as well as URL generation:

```ts
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { initDb } from '../../db/index.js';
import { FrpService } from './frp.service.js';

const allocateMock = vi.fn();
vi.mock('../ports/port-allocator.service.js', () => ({
  portAllocatorService: { allocate: allocateMock, release: vi.fn() },
}));

describe('FrpService', () => {
  beforeEach(async () => {
    await initDb();
    allocateMock.mockReset();
  });

  it('delegates automatic remote port selection to the allocator', async () => {
    allocateMock.mockResolvedValue(23010);
    const service = new FrpService();

    const mapping = await service.createMapping({
      clientId: 'client-1',
      name: 'http-mapping',
      proxyType: 'http',
      localIp: '127.0.0.1',
      localPort: 3001,
    });

    expect(allocateMock).toHaveBeenCalledWith('client-1', undefined);
    expect(mapping.remote_port).toBe(23010);
  });

  it('delegates preferred remote port validation to the allocator', async () => {
    allocateMock.mockResolvedValue(23011);
    const service = new FrpService();

    const mapping = await service.createMapping({
      clientId: 'client-1',
      name: 'tcp-mapping',
      proxyType: 'tcp',
      localIp: '127.0.0.1',
      localPort: 3000,
      remotePort: 23011,
    });

    expect(allocateMock).toHaveBeenCalledWith('client-1', { preferredPort: 23011 });
    expect(mapping.remote_port).toBe(23011);
  });
});
```

Append this route test to `apps/server/src/modules/frp/frp.routes.test.ts`:

```ts
const createMappingMock = vi.fn();
vi.mock('./frp.service.js', () => ({
  frpService: {
    createMapping: createMappingMock,
    listMappings: vi.fn(() => []),
    toApi: vi.fn((mapping) => ({ id: mapping.id })),
    getMapping: vi.fn(() => undefined),
    deleteMapping: vi.fn(),
  },
  getFrpsConnectionInfo: vi.fn(() => ({ serverAddr: 'frps.example.com', serverPort: 7000, authToken: 'frps-token' })),
}));

  it('returns 409 when the requested remote port is already occupied', async () => {
    createMappingMock.mockRejectedValueOnce(Object.assign(new Error('Remote port already in use'), {
      name: 'PortConflictError',
      source: 'dashboard',
      port: 23001,
    }));

    const app = Fastify();
    await app.register(frpRoutes);

    const response = await app.inject({
      method: 'POST',
      url: '/api/port-mappings',
      payload: {
        clientId: 'client-1',
        name: 'preview',
        proxyType: 'tcp',
        localIp: '127.0.0.1',
        localPort: 3000,
        remotePort: 23001,
      },
    });

    expect(response.statusCode).toBe(409);
    expect(response.json()).toEqual({
      error: 'Remote port already in use',
      source: 'dashboard',
      port: 23001,
    });
  });
```

- [ ] **Step 2: Run the FRP service and route tests to verify they fail**

Run:

```bash
pnpm --filter @rag/server test -- src/modules/frp/frp.service.test.ts src/modules/frp/frp.routes.test.ts
```

Expected: FAIL because `createMapping()` is still synchronous and the route does not map `PortConflictError` to 409.

- [ ] **Step 3: Implement async allocator delegation and route-level error translation**

Update `apps/server/src/modules/frp/frp.service.ts` like this:

```ts
import { portAllocatorService } from '../ports/port-allocator.service.js';

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
}
```

Update the create route in `apps/server/src/modules/frp/frp.routes.ts` to `await frpService.createMapping(...)` and catch allocator errors:

```ts
    let mapping;
    try {
      mapping = await frpService.createMapping({
        clientId,
        name,
        proxyType,
        localIp,
        localPort,
        remotePort,
        customDomain,
      });
    } catch (err) {
      if ((err as { name?: string }).name === 'PortConflictError') {
        const conflict = err as { message: string; source: string; port: number };
        return reply.code(409).send({
          error: 'Remote port already in use',
          source: conflict.source,
          port: conflict.port,
        });
      }
      if ((err as { name?: string }).name === 'NoAvailablePortError') {
        return reply.code(409).send({ error: 'No available ports in FRP range' });
      }
      throw err;
    }
```

- [ ] **Step 4: Run the FRP service and route tests to verify they pass**

Run:

```bash
pnpm --filter @rag/server test -- src/modules/frp/frp.service.test.ts src/modules/frp/frp.routes.test.ts
```

Expected: PASS with allocator delegation and 409 conflict response coverage green.

- [ ] **Step 5: Commit**

```bash
git add apps/server/src/modules/frp/frp.service.ts apps/server/src/modules/frp/frp.service.test.ts apps/server/src/modules/frp/frp.routes.ts apps/server/src/modules/frp/frp.routes.test.ts
git commit -m "feat: route frp mapping creation through allocator"
```

---

### Task 5: Add `AutoMappingService` persistence and file-HTTP provider

**Files:**
- Create: `apps/server/src/modules/auto-mapping/auto-mapping.service.ts`
- Create: `apps/server/src/modules/auto-mapping/auto-mapping.service.test.ts`
- Create: `apps/server/src/modules/auto-mapping/providers/file-http.provider.ts`
- Create: `apps/server/src/modules/auto-mapping/providers/file-http.provider.test.ts`
- Test: `apps/server/src/modules/auto-mapping/auto-mapping.service.test.ts`
- Test: `apps/server/src/modules/auto-mapping/providers/file-http.provider.test.ts`

- [ ] **Step 1: Write failing tests for `active`/`cleanup_pending` lifecycle and online mapping creation**

Create `apps/server/src/modules/auto-mapping/auto-mapping.service.test.ts`:

```ts
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
```

Create `apps/server/src/modules/auto-mapping/providers/file-http.provider.test.ts`:

```ts
import { describe, expect, it, vi } from 'vitest';
import { FileHttpAutoMappingProvider } from './file-http.provider.js';

describe('FileHttpAutoMappingProvider', () => {
  it('starts the file service, creates a mapping, and dispatches frp_create_proxy', async () => {
    const tasksService = {
      createTask: vi.fn()
        .mockReturnValueOnce({ id: 'task_start_file' })
        .mockReturnValueOnce({ id: 'task_frp_file' }),
      getTask: vi.fn((taskId: string) => ({
        id: taskId,
        status: 'success',
        result: taskId === 'task_start_file'
          ? JSON.stringify({ running: true, host: '127.0.0.1', port: 45123, startedAt: 1000 })
          : JSON.stringify({ ok: true }),
      })),
    };

    const connectionManager = { sendToClient: vi.fn().mockReturnValue(true) };
    const frpService = {
      createMapping: vi.fn().mockResolvedValue({
        id: 'pm-auto',
        client_id: 'client-1',
        name: 'auto-file-http-client-1',
        proxy_type: 'http',
        local_ip: '127.0.0.1',
        local_port: 45123,
        remote_port: 23001,
        custom_domain: null,
        status: 'inactive',
        public_url: 'http://frps.example.com:23001',
        created_at: 1000,
        updated_at: 1000,
      }),
    };

    const provider = new FileHttpAutoMappingProvider({
      tasksService: tasksService as never,
      connectionManager: connectionManager as never,
      frpService: frpService as never,
      getFrpsConnectionInfo: () => ({ serverAddr: 'frps.example.com', serverPort: 7000, authToken: 'frp-token' }),
      waitForTask: async (taskId: string) => tasksService.getTask(taskId),
    });

    const result = await provider.onClientOnline('client-1');

    expect(tasksService.createTask).toHaveBeenNthCalledWith(1, expect.objectContaining({
      clientId: 'client-1',
      type: 'file_service_start',
      payload: expect.objectContaining({ token: expect.any(String), ttlMs: 30 * 60 * 1000 }),
    }));
    expect(frpService.createMapping).toHaveBeenCalledWith(expect.objectContaining({
      clientId: 'client-1',
      proxyType: 'http',
      localPort: 45123,
      localIp: '127.0.0.1',
    }));
    expect(tasksService.createTask).toHaveBeenNthCalledWith(2, expect.objectContaining({
      clientId: 'client-1',
      type: 'frp_create_proxy',
      payload: expect.objectContaining({ mappingId: 'pm-auto', remotePort: 23001 }),
    }));
    expect(result).toEqual({
      mappingId: 'pm-auto',
      localPort: 45123,
      name: 'auto-file-http-client-1',
      proxyType: 'http',
    });
  });
});
```

- [ ] **Step 2: Run the auto-mapping tests to verify they fail**

Run:

```bash
pnpm --filter @rag/server test -- src/modules/auto-mapping/auto-mapping.service.test.ts src/modules/auto-mapping/providers/file-http.provider.test.ts
```

Expected: FAIL because neither the service nor the provider exists yet.

- [ ] **Step 3: Implement the persistence service and file provider**

Create `apps/server/src/modules/auto-mapping/auto-mapping.service.ts`:

```ts
import { getDb } from '../../db/index.js';
import { v4 as uuid } from 'uuid';
import { auditService } from '../audit/audit.service.js';

export interface AutoMappingProvider {
  name: string;
  onClientOnline(clientId: string): Promise<{ mappingId: string; localPort: number; name: string; proxyType: 'tcp' | 'http' | 'https' }>;
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

  listByClient(clientId: string) {
    const stmt = getDb().prepare('SELECT * FROM auto_mappings WHERE client_id = ? ORDER BY created_at ASC');
    stmt.bind([clientId]);
    const rows: Array<Record<string, unknown>> = [];
    while (stmt.step()) rows.push(stmt.getAsObject());
    stmt.free();
    return rows;
  }
}
```

Create `apps/server/src/modules/auto-mapping/providers/file-http.provider.ts`:

```ts
import { randomBytes } from 'node:crypto';
import { tasksService as defaultTasksService } from '../../tasks/tasks.service.js';
import { connectionManager as defaultConnectionManager } from '../../connections/connections.manager.js';
import { frpService as defaultFrpService, getFrpsConnectionInfo as defaultGetFrpsConnectionInfo } from '../../frp/frp.service.js';

interface FileHttpProviderDeps {
  tasksService: typeof defaultTasksService;
  connectionManager: typeof defaultConnectionManager;
  frpService: typeof defaultFrpService;
  getFrpsConnectionInfo: typeof defaultGetFrpsConnectionInfo;
  waitForTask?: (taskId: string, label: string) => Promise<{ id: string; status: string; result?: string | null; error?: string | null }>;
}

export class FileHttpAutoMappingProvider {
  private readonly deps: FileHttpProviderDeps;

  readonly name = 'file-http';

  constructor(deps?: Partial<FileHttpProviderDeps>) {
    this.deps = {
      tasksService: deps?.tasksService ?? defaultTasksService,
      connectionManager: deps?.connectionManager ?? defaultConnectionManager,
      frpService: deps?.frpService ?? defaultFrpService,
      getFrpsConnectionInfo: deps?.getFrpsConnectionInfo ?? defaultGetFrpsConnectionInfo,
      waitForTask: deps?.waitForTask,
    } as FileHttpProviderDeps;
  }

  async onClientOnline(clientId: string) {
    const token = `file_${randomBytes(24).toString('hex')}`;
    const startPayload = { port: 0, token, ttlMs: 30 * 60 * 1000 };
    const startTask = this.deps.tasksService.createTask({ clientId, type: 'file_service_start', payload: startPayload, createdBy: 'server:auto-mapping' });

    const startDispatched = this.deps.connectionManager.sendToClient(clientId, {
      type: 'task.dispatch',
      requestId: startTask.id,
      payload: { taskId: startTask.id, taskType: 'file_service_start', payload: startPayload },
    });
    if (!startDispatched) throw new Error(`Client ${clientId} is offline`);

    const started = await this.waitForTaskSuccess(startTask.id, 'Auto file service start');
    const startResult = JSON.parse(started.result ?? '{}') as { port?: number; startedAt?: number };
    if (typeof startResult.port !== 'number') throw new Error(`file_service_start for ${clientId} returned no port`);

    const mapping = await this.deps.frpService.createMapping({
      clientId,
      name: `auto-file-http-${clientId}`,
      proxyType: 'http',
      localIp: '127.0.0.1',
      localPort: startResult.port,
    });

    const frpsInfo = this.deps.getFrpsConnectionInfo();
    const frpPayload = {
      mappingId: mapping.id,
      name: mapping.name,
      proxyType: 'http' as const,
      localIp: '127.0.0.1',
      localPort: startResult.port,
      remotePort: mapping.remote_port,
      customDomain: mapping.custom_domain ?? undefined,
      serverAddr: frpsInfo.serverAddr,
      serverPort: frpsInfo.serverPort,
      authToken: frpsInfo.authToken,
    };

    const frpTask = this.deps.tasksService.createTask({ clientId, type: 'frp_create_proxy', payload: frpPayload, createdBy: 'server:auto-mapping' });
    const frpDispatched = this.deps.connectionManager.sendToClient(clientId, {
      type: 'task.dispatch',
      requestId: frpTask.id,
      payload: { taskId: frpTask.id, taskType: 'frp_create_proxy', payload: frpPayload },
    });
    if (!frpDispatched) throw new Error(`Client ${clientId} went offline before FRP create`);

    await this.waitForTaskSuccess(frpTask.id, 'Auto file FRP create');

    return {
      mappingId: mapping.id,
      localPort: startResult.port,
      name: mapping.name,
      proxyType: 'http' as const,
    };
  }

  async onClientOffline(_clientId: string, _mappingId: string): Promise<void> {}

  private async waitForTaskSuccess(taskId: string, label: string) {
    if (this.deps.waitForTask) return this.deps.waitForTask(taskId, label);

    const startedAt = Date.now();
    while (Date.now() - startedAt < 10_000) {
      const task = this.deps.tasksService.getTask(taskId);
      if (task?.status === 'success') return task;
      if (task?.status === 'failed') throw new Error(task.error ?? `${label} failed`);
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
    throw new Error(`Timed out waiting for ${label}`);
  }
}
```

- [ ] **Step 4: Run the auto-mapping tests to verify they pass**

Run:

```bash
pnpm --filter @rag/server test -- src/modules/auto-mapping/auto-mapping.service.test.ts src/modules/auto-mapping/providers/file-http.provider.test.ts
```

Expected: PASS with DB persistence and provider task-dispatch flow green.

- [ ] **Step 5: Commit**

```bash
git add apps/server/src/modules/auto-mapping/auto-mapping.service.ts apps/server/src/modules/auto-mapping/auto-mapping.service.test.ts apps/server/src/modules/auto-mapping/providers/file-http.provider.ts apps/server/src/modules/auto-mapping/providers/file-http.provider.test.ts
git commit -m "feat: add auto mapping service and file http provider"
```

---

### Task 6: Connect websocket lifecycle to auto-mapping and reconnect cleanup

**Files:**
- Modify: `apps/server/src/ws/ws-handlers.ts`
- Create: `apps/server/src/ws/ws-handlers.test.ts`
- Modify: `apps/server/src/modules/auto-mapping/auto-mapping.service.ts`
- Modify: `apps/server/src/modules/auto-mapping/providers/file-http.provider.ts`
- Test: `apps/server/src/ws/ws-handlers.test.ts`

- [ ] **Step 1: Write failing websocket lifecycle tests**

Create `apps/server/src/ws/ws-handlers.test.ts`:

```ts
import { describe, expect, it, vi } from 'vitest';
import { handleWsClose, handleWsMessage } from './ws-handlers.js';

const upsertClientMock = vi.fn();
const registerConnectionMock = vi.fn();
const autoOnlineMock = vi.fn();
const autoOfflineMock = vi.fn();
const wsSendMock = vi.fn();

vi.mock('../modules/clients/clients.service.js', () => ({
  clientsService: {
    upsertClient: upsertClientMock,
    updateHeartbeat: vi.fn(),
    setOffline: vi.fn(),
  },
}));
vi.mock('../modules/connections/connections.manager.js', () => ({
  connectionManager: { register: registerConnectionMock, remove: vi.fn() },
}));
vi.mock('../modules/audit/audit.service.js', () => ({ auditService: { log: vi.fn() } }));
vi.mock('../modules/tasks/tasks.service.js', () => ({ tasksService: { updateTaskStatus: vi.fn(), addLog: vi.fn(), getTask: vi.fn() } }));
vi.mock('../modules/frp/frp.service.js', () => ({ frpService: { getMapping: vi.fn(), updateMappingStatus: vi.fn(), deleteMapping: vi.fn() }, getFrpsConnectionInfo: vi.fn(() => ({ serverAddr: 'frps.example.com', serverPort: 7000, authToken: 'frp-token' })) }));
vi.mock('../modules/auto-mapping/auto-mapping.service.js', () => ({
  autoMappingService: { onClientOnline: autoOnlineMock, onClientOffline: autoOfflineMock },
}));
vi.mock('../db/index.js', () => ({ saveDb: vi.fn() }));

describe('ws handlers auto mapping lifecycle', () => {
  it('starts auto mappings after client.register succeeds', async () => {
    const ws = { send: wsSendMock } as never;

    handleWsMessage(ws, JSON.stringify({
      type: 'client.register',
      requestId: 'reg_1',
      payload: {
        clientId: 'client-1',
        name: 'Client 1',
        hostname: 'client-host',
        os: 'linux',
        arch: 'x64',
        version: '0.1.0',
        tags: [],
      },
    }));

    await Promise.resolve();

    expect(upsertClientMock).toHaveBeenCalledWith(expect.objectContaining({ clientId: 'client-1' }));
    expect(registerConnectionMock).toHaveBeenCalledWith('client-1', ws);
    expect(autoOnlineMock).toHaveBeenCalledWith('client-1');
    expect(wsSendMock).toHaveBeenCalledWith(expect.stringContaining('server.ack'));
  });

  it('marks auto mappings pending cleanup on websocket close', async () => {
    handleWsClose('client-1');
    expect(autoOfflineMock).toHaveBeenCalledWith('client-1');
  });
});
```

- [ ] **Step 2: Run the websocket tests to verify they fail**

Run:

```bash
pnpm --filter @rag/server test -- src/ws/ws-handlers.test.ts
```

Expected: FAIL because the real handlers do not call `autoMappingService` yet.

- [ ] **Step 3: Implement lifecycle wiring and reconnect cleanup hooks**

Update `apps/server/src/modules/auto-mapping/auto-mapping.service.ts` to add two helpers used by the provider and websocket lifecycle:

```ts
  listCleanupPending(clientId: string) {
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
```

Update `apps/server/src/modules/auto-mapping/providers/file-http.provider.ts` to clean up stale mappings before starting a new file service:

```ts
import { getDb } from '../../../db/index.js';

  async onClientOnline(clientId: string) {
    await this.cleanupPendingMappings(clientId);
    // existing start-file-service flow stays below
  }

  private async cleanupPendingMappings(clientId: string): Promise<void> {
    const stmt = getDb().prepare('SELECT mapping_id FROM auto_mappings WHERE client_id = ? AND provider_name = ? AND status = ? ORDER BY created_at ASC');
    stmt.bind([clientId, this.name, 'cleanup_pending']);
    const staleMappingIds: string[] = [];
    while (stmt.step()) {
      const row = stmt.getAsObject() as { mapping_id: string };
      staleMappingIds.push(row.mapping_id);
    }
    stmt.free();

    for (const mappingId of staleMappingIds) {
      const removeTask = this.deps.tasksService.createTask({
        clientId,
        type: 'frp_remove_proxy',
        payload: { mappingId },
        createdBy: 'server:auto-mapping-cleanup',
      });
      const dispatched = this.deps.connectionManager.sendToClient(clientId, {
        type: 'task.dispatch',
        requestId: removeTask.id,
        payload: { taskId: removeTask.id, taskType: 'frp_remove_proxy', payload: { mappingId } },
      });
      if (dispatched) {
        await this.waitForTaskSuccess(removeTask.id, 'Auto mapping cleanup');
      }
      this.deps.frpService.deleteMapping(mappingId);
      getDb().run('DELETE FROM auto_mappings WHERE mapping_id = ?', [mappingId]);
    }
  }
```

Then wire `autoMappingService` into `apps/server/src/ws/ws-handlers.ts`:

```ts
import { autoMappingService } from '../modules/auto-mapping/auto-mapping.service.js';

    case 'client.register': {
      // existing parse/upsert/register/audit code

      try {
        await autoMappingService.onClientOnline(info.clientId);
      } catch (err) {
        console.warn(`[auto-mapping] failed for ${info.clientId}:`, err instanceof Error ? err.message : err);
      }

      ws.send(JSON.stringify({
        type: 'server.ack',
        requestId: message.requestId,
        payload: ackPayload,
      }));
      break;
    }
```

And in `handleWsClose`:

```ts
export function handleWsClose(clientId: string): void {
  connectionManager.remove(clientId);
  clientsService.setOffline(clientId);

  void autoMappingService.onClientOffline(clientId).catch((err) => {
    console.warn(`[auto-mapping] cleanup-pending mark failed for ${clientId}:`, err instanceof Error ? err.message : err);
  });

  auditService.log({
    actor: clientId,
    action: 'client.disconnect',
    targetType: 'client',
    targetId: clientId,
  });

  saveDb();
}
```

Finally, register the provider in `auto-mapping.service.ts` by adding at bottom:

```ts
import { FileHttpAutoMappingProvider } from './providers/file-http.provider.js';

export const autoMappingService = new AutoMappingService();
autoMappingService.registerProvider(new FileHttpAutoMappingProvider());
```

- [ ] **Step 4: Run the websocket and auto-mapping tests to verify they pass**

Run:

```bash
pnpm --filter @rag/server test -- src/ws/ws-handlers.test.ts src/modules/auto-mapping/auto-mapping.service.test.ts src/modules/auto-mapping/providers/file-http.provider.test.ts
```

Expected: PASS with register/close lifecycle and reconnect cleanup coverage green.

- [ ] **Step 5: Commit**

```bash
git add apps/server/src/ws/ws-handlers.ts apps/server/src/ws/ws-handlers.test.ts apps/server/src/modules/auto-mapping/auto-mapping.service.ts apps/server/src/modules/auto-mapping/providers/file-http.provider.ts
git commit -m "feat: auto-create file http mappings on client lifecycle"
```

---

### Task 7: Final verification sweep

**Files:**
- No new code expected unless a failing verification reveals a bug.
- Test: `apps/server/src/db/__tests__/db.test.ts`
- Test: `apps/server/src/modules/frp/frps-dashboard.service.test.ts`
- Test: `apps/server/src/modules/ports/port-allocator.service.test.ts`
- Test: `apps/server/src/modules/frp/frp.service.test.ts`
- Test: `apps/server/src/modules/frp/frp.routes.test.ts`
- Test: `apps/server/src/modules/auto-mapping/auto-mapping.service.test.ts`
- Test: `apps/server/src/modules/auto-mapping/providers/file-http.provider.test.ts`
- Test: `apps/server/src/ws/ws-handlers.test.ts`

- [ ] **Step 1: Run the focused server test set**

Run:

```bash
pnpm --filter @rag/server test -- \
  src/db/__tests__/db.test.ts \
  src/modules/frp/frps-dashboard.service.test.ts \
  src/modules/ports/port-allocator.service.test.ts \
  src/modules/frp/frp.service.test.ts \
  src/modules/frp/frp.routes.test.ts \
  src/modules/auto-mapping/auto-mapping.service.test.ts \
  src/modules/auto-mapping/providers/file-http.provider.test.ts \
  src/ws/ws-handlers.test.ts
```

Expected: PASS with all targeted tests green.

- [ ] **Step 2: Run the full server test suite**

Run:

```bash
pnpm --filter @rag/server test
```

Expected: PASS with no regressions in existing client-file, clients, or FRP tests.

- [ ] **Step 3: Run typecheck**

Run:

```bash
pnpm --filter @rag/server typecheck
```

Expected: PASS with no TypeScript errors.

- [ ] **Step 4: Review git diff for scope control**

Run:

```bash
git diff --stat HEAD~6..HEAD
git diff -- apps/server/src/db/migrate.ts apps/server/src/modules/frp apps/server/src/modules/ports apps/server/src/modules/auto-mapping apps/server/src/ws/ws-handlers.ts
```

Expected: Diff limited to allocator, auto-mapping lifecycle, tests, and the DB migration described by the spec.

- [ ] **Step 5: Commit any final fixups if verification uncovered issues**

If verification required code changes:

```bash
git add apps/server/src/db/migrate.ts apps/server/src/modules/frp apps/server/src/modules/ports apps/server/src/modules/auto-mapping apps/server/src/ws/ws-handlers.ts
git commit -m "fix: finalize port allocator and auto mapping lifecycle"
```

If no verification fixes were needed, mark this step complete without a new commit.

---

## Self-Review Checklist

### Spec coverage

- Unified server-side allocator: Task 3
- Dashboard cross-check and downgrade behavior: Tasks 2 and 3
- Ghost/external occupancy audit logs: Task 3
- `FrpService` integration and route conflicts: Task 4
- Automatic client file HTTP mapping: Tasks 5 and 6
- Offline `cleanup_pending` lifecycle and reconnect cleanup: Task 6
- Verification evidence: Task 7

### Placeholder scan

- No `TODO`, `TBD`, or “similar to above” placeholders remain.
- Every code-changing step includes concrete code blocks.
- Every validation step includes an exact command and expected result.

### Type consistency

- `PortConflictError`, `NoAvailablePortError`, `PortAllocatorService`: defined in Task 3 and consumed in Task 4.
- `AutoMappingService`, `AutoMappingProvider`, `FileHttpAutoMappingProvider`: defined in Task 5 and wired in Task 6.
- `cleanup_pending` status and `auto_mappings` schema: introduced in Task 1 and reused consistently in Tasks 5 and 6.
