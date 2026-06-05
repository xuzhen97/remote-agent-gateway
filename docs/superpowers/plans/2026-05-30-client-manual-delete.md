# Client Manual Delete Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a manual delete action for offline clients in the web console, with backend-enforced offline-only validation and cascade cleanup of related port mappings, tasks, and task logs.

**Architecture:** The server remains the source of truth. A new delete flow starts at `DELETE /api/clients/:clientId`, rejects online or missing clients, and delegates persistence cleanup to service methods that remove related port mappings, task logs, tasks, and finally the client row. The web console only exposes the action for offline clients and surfaces backend errors directly.

**Tech Stack:** TypeScript, Fastify, sql.js, Vitest, plain browser JavaScript

---

### Task 1: Add service-level cascade delete support for offline clients

**Files:**
- Modify: `apps/server/src/modules/clients/clients.service.ts`
- Modify: `apps/server/src/modules/tasks/tasks.service.ts`
- Modify: `apps/server/src/modules/frp/frp.service.ts`
- Test: `apps/server/src/modules/clients/clients.service.test.ts`

- [ ] **Step 1: Write the failing tests**

```typescript
function insertMapping(params: { id: string; clientId: string; remotePort: number }): void {
  const now = 1_000_000;
  state.db!.run(
    `INSERT INTO port_mappings (id, client_id, name, proxy_type, local_ip, local_port, remote_port, status, public_url, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [params.id, params.clientId, params.id, 'tcp', '127.0.0.1', 3000, params.remotePort, 'inactive', `127.0.0.1:${params.remotePort}`, now, now],
  );
}

function insertTask(params: { id: string; clientId: string }): void {
  const now = 1_000_000;
  state.db!.run(
    `INSERT INTO tasks (id, client_id, type, status, payload, created_at) VALUES (?, ?, ?, ?, ?, ?)`,
    [params.id, params.clientId, 'exec_script', 'pending', '{}', now],
  );
}

function insertTaskLog(params: { taskId: string; content: string }): void {
  state.db!.run(
    `INSERT INTO task_logs (task_id, stream, content, created_at) VALUES (?, ?, ?, ?)`,
    [params.taskId, 'stdout', params.content, 1_000_000],
  );
}

it('deletes a client and all related mappings, tasks, and task logs', () => {
  insertClient({ id: 'offline-client', status: 'offline', updatedAt: 1_000_000 });
  insertClient({ id: 'other-client', status: 'offline', updatedAt: 1_000_000 });
  insertMapping({ id: 'pm_offline', clientId: 'offline-client', remotePort: 20001 });
  insertMapping({ id: 'pm_other', clientId: 'other-client', remotePort: 20002 });
  insertTask({ id: 'task_offline', clientId: 'offline-client' });
  insertTask({ id: 'task_other', clientId: 'other-client' });
  insertTaskLog({ taskId: 'task_offline', content: 'offline-log' });
  insertTaskLog({ taskId: 'task_other', content: 'other-log' });

  const summary = service.deleteClientCascade('offline-client');

  expect(summary).toEqual({ deletedMappings: 1, deletedTasks: 1, deletedLogs: 1 });
  expect(service.getClient('offline-client')).toBeUndefined();
  expect(service.getClient('other-client')).toBeDefined();
  expect(state.db!.exec(`SELECT id FROM port_mappings WHERE client_id = 'offline-client'`)).toEqual([]);
  expect(state.db!.exec(`SELECT id FROM tasks WHERE client_id = 'offline-client'`)).toEqual([]);
  expect(state.db!.exec(`SELECT id FROM task_logs WHERE task_id = 'task_offline'`)).toEqual([]);
  expect(state.db!.exec(`SELECT id FROM port_mappings WHERE client_id = 'other-client'`)[0].values).toEqual([['pm_other']]);
  expect(state.db!.exec(`SELECT id FROM tasks WHERE client_id = 'other-client'`)[0].values).toEqual([['task_other']]);
  expect(state.db!.exec(`SELECT content FROM task_logs WHERE task_id = 'task_other'`)[0].values).toEqual([['other-log']]);
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter @rag/server test src/modules/clients/clients.service.test.ts`
Expected: FAIL with `service.deleteClientCascade is not a function` or equivalent missing-method failure.

- [ ] **Step 3: Write the minimal implementation**

Add helpers in the owning services.

`apps/server/src/modules/frp/frp.service.ts`

```typescript
  deleteMappingsByClientId(clientId: string): number {
    const db = getDb();
    db.run('DELETE FROM port_mappings WHERE client_id = ?', [clientId]);
    return db.getRowsModified();
  }
```

`apps/server/src/modules/tasks/tasks.service.ts`

```typescript
  deleteTasksByClientId(clientId: string): { deletedTasks: number; deletedLogs: number } {
    const db = getDb();

    db.run(
      `DELETE FROM task_logs WHERE task_id IN (
        SELECT id FROM tasks WHERE client_id = ?
      )`,
      [clientId],
    );
    const deletedLogs = db.getRowsModified();

    db.run('DELETE FROM tasks WHERE client_id = ?', [clientId]);
    const deletedTasks = db.getRowsModified();

    return { deletedTasks, deletedLogs };
  }
```

`apps/server/src/modules/clients/clients.service.ts`

```typescript
import { frpService } from '../frp/frp.service.js';
import { tasksService } from '../tasks/tasks.service.js';

  deleteClientCascade(clientId: string): {
    deletedMappings: number;
    deletedTasks: number;
    deletedLogs: number;
  } {
    const db = getDb();
    const deletedMappings = frpService.deleteMappingsByClientId(clientId);
    const { deletedTasks, deletedLogs } = tasksService.deleteTasksByClientId(clientId);
    db.run('DELETE FROM clients WHERE id = ?', [clientId]);
    return { deletedMappings, deletedTasks, deletedLogs };
  }
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm --filter @rag/server test src/modules/clients/clients.service.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/server/src/modules/clients/clients.service.ts apps/server/src/modules/tasks/tasks.service.ts apps/server/src/modules/frp/frp.service.ts apps/server/src/modules/clients/clients.service.test.ts
git commit -m "feat: add cascade delete for client data"
```

### Task 2: Add an offline-only client delete API route

**Files:**
- Modify: `apps/server/src/modules/clients/clients.routes.ts`
- Modify: `apps/server/src/modules/clients/clients.service.test.ts`
- Test: `apps/server/src/modules/clients/clients.service.test.ts`

- [ ] **Step 1: Write the failing tests**

Extend `apps/server/src/modules/clients/clients.service.test.ts` with two route-logic guard tests at the service boundary that lock the expected deletion preconditions.

```typescript
it('does not delete unrelated data when deleting a missing client is skipped by the caller', () => {
  const summary = service.deleteClientCascade('missing-client');

  expect(summary).toEqual({ deletedMappings: 0, deletedTasks: 0, deletedLogs: 0 });
  expect(service.getClient('missing-client')).toBeUndefined();
});

it('keeps online status visible for callers that must reject online deletion before cleanup', () => {
  insertClient({ id: 'online-client', status: 'online', updatedAt: 1_000_000 });

  const client = service.getClient('online-client');

  expect(client?.status).toBe('online');
});
```

These tests do not replace route verification, but they keep the service behavior explicit while the route enforces the offline-only rule.

- [ ] **Step 2: Run the test suite to verify the current route behavior is incomplete**

Run: `pnpm --filter @rag/server test src/modules/clients/clients.service.test.ts`
Expected: PASS for existing service tests only; route delete behavior still does not exist in code.

- [ ] **Step 3: Write the minimal implementation**

Add the route in `apps/server/src/modules/clients/clients.routes.ts`.

```typescript
  app.delete<{ Params: { clientId: string } }>('/api/clients/:clientId', async (request, reply) => {
    const client = clientsService.getClient(request.params.clientId);
    if (!client) {
      return reply.code(404).send({ error: 'Client not found' });
    }

    if (connectionManager.isOnline(request.params.clientId)) {
      return reply.code(400).send({ error: 'Only offline clients can be deleted' });
    }

    clientsService.deleteClientCascade(request.params.clientId);

    return reply.send({ success: true });
  });
```

Then add the audit log in the same route.

```typescript
    auditService.log({
      actor: (request as unknown as { authRole: string }).authRole,
      action: 'client.delete',
      targetType: 'client',
      targetId: request.params.clientId,
      detail: `Deleted offline client ${request.params.clientId}`,
    });
```

- [ ] **Step 4: Run focused server checks**

Run: `pnpm --filter @rag/server test src/modules/clients/clients.service.test.ts`
Expected: PASS.

Run: `pnpm --filter @rag/server typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/server/src/modules/clients/clients.routes.ts apps/server/src/modules/clients/clients.service.test.ts
git commit -m "feat: add offline client delete API"
```

### Task 3: Add the delete action to the web console client list

**Files:**
- Modify: `apps/server/src/web/index.html`

- [ ] **Step 1: Write the failing manual verification case**

Document the exact failure being fixed before changing UI behavior.

```text
Current failure:
- Open the Clients page.
- Observe an offline client such as e2e-test-client.
- There is no delete action, so the stale record cannot be removed.
```

- [ ] **Step 2: Verify the failure manually**

Run: `pnpm dev`
Expected: The web console loads, offline clients appear in the Clients table, and there is no delete button.

- [ ] **Step 3: Write the minimal implementation**

In `loadClients()` update the actions column so offline clients render a delete button and online clients do not.

```javascript
el.innerHTML=`<h2>🖥 客户端 (${clients?.length||0})</h2><button class="btn" onclick="loadClients()" style="margin-bottom:12px">🔄 刷新</button><table><thead><tr><th>ID</th><th>名称</th><th>系统</th><th>标签</th><th>在线状态</th><th>最后心跳</th><th>操作</th></tr></thead><tbody>${(clients||[]).map(c=>`<tr><td style="font-family:monospace">${c.id}</td><td>${c.name}</td><td>${c.os||'?'} ${c.arch||''}</td><td>${(c.tags||[]).map(t=>'<span style="background:var(--hover);padding:1px 6px;border-radius:4px;font-size:11px;margin:1px">'+t+'</span>').join('')}</td><td>${badge(c.online?'online':'offline')}</td><td style="color:var(--dim)">${c.lastSeenAt?new Date(c.lastSeenAt).toLocaleString('zh-CN'):'-'}</td><td>${c.online?`<button class="btn btn-sm" onclick="quickScript('${c.id}')">▶ 执行脚本</button>`:`<button class="btn btn-sm btn-danger" onclick="deleteClient('${c.id}')">🗑 删除</button>`}</td></tr>`).join('')||'<tr><td colspan="7" style="color:var(--dim)">暂无客户端</td></tr>'}</tbody></table>`
```

Add the delete handler near the other client helpers.

```javascript
async function deleteClient(clientId){
  if(!confirm('确定删除离线客户端 '+clientId+'？这会同时删除其端口映射、任务和任务日志，且不可恢复。'))return;
  const {status,data}=await api('DELETE','/api/clients/'+clientId);
  if(status===200){toast('客户端已删除');loadClients()}else{toast('删除失败: '+(data?.error||JSON.stringify(data)))}
}
```

- [ ] **Step 4: Verify the UI manually**

Run: `pnpm dev`
Expected:
- offline clients show a delete button;
- online clients do not show a delete button;
- deleting an offline client removes it from the list after refresh;
- related mappings and tasks no longer appear in their pages;
- failed deletes show the backend error.

- [ ] **Step 5: Commit**

```bash
git add apps/server/src/web/index.html
git commit -m "feat: add offline client delete action in web console"
```

### Task 4: Run final verification

**Files:**
- Modify: none

- [ ] **Step 1: Run backend tests**

Run: `pnpm --filter @rag/server test`
Expected: PASS.

- [ ] **Step 2: Run workspace type checks**

Run: `pnpm typecheck`
Expected: PASS.

- [ ] **Step 3: Run manual UI verification**

Run: `pnpm dev`
Expected: Manual delete flow works as described in Task 3, Step 4.

- [ ] **Step 4: Commit if verification required follow-up edits**

```bash
git add -A
git commit -m "test: verify offline client delete flow"
```

Only make this commit if verification required code changes. If no files changed, skip this step.
