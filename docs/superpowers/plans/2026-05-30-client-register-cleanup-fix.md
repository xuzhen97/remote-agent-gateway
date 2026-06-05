# Client Register and Cleanup Fix Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make client registration failure visible and add the missing offline-client cleanup capability that the server-side tests already describe.

**Architecture:** The server keeps client state in SQLite through `ClientsService`, while the client registers over WebSocket and then begins heartbeat traffic. This plan keeps the changes narrow: first add the missing retention cleanup method on the server, then tighten the client registration path so it waits for an explicit server response instead of assuming registration succeeded.

**Tech Stack:** TypeScript, Vitest, sql.js, Fastify, WebSocket

---

### Task 1: Add offline client retention cleanup to `ClientsService`

**Files:**
- Modify: `apps/server/src/modules/clients/clients.service.ts`
- Test: `apps/server/src/modules/clients/clients.service.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
it('deletes only offline clients older than the retention window', () => {
  const now = 1_000_000;
  insertClient({ id: 'stale-offline', status: 'offline', updatedAt: now - 120_000 });
  insertClient({ id: 'fresh-offline', status: 'offline', updatedAt: now - 10_000 });
  insertClient({ id: 'stale-online', status: 'online', updatedAt: now - 120_000 });

  const deleted = service.deleteOfflineClientsOlderThan(now - 60_000);

  expect(deleted).toBe(1);
  expect(service.getClient('stale-offline')).toBeUndefined();
  expect(service.getClient('fresh-offline')).toBeDefined();
  expect(service.getClient('stale-online')).toBeDefined();
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @rag/server test src/modules/clients/clients.service.test.ts`
Expected: FAIL with `deleteOfflineClientsOlderThan is not a function`.

- [ ] **Step 3: Write minimal implementation**

```typescript
  deleteOfflineClientsOlderThan(cutoffMs: number): number {
    const db = getDb();
    const result = db.run(
      'DELETE FROM clients WHERE status = ? AND updated_at < ?',
      ['offline', cutoffMs],
    );
    return result?.changes ?? 0;
  }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @rag/server test src/modules/clients/clients.service.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/server/src/modules/clients/clients.service.ts apps/server/src/modules/clients/clients.service.test.ts
git