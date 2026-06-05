# Task Delete and Bulk Delete Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add single-task delete and checkbox-based bulk delete to task management, deleting task records together with their logs while leaving client-side execution untouched.

**Architecture:** Keep deletion rules in the server task service, expose them through dedicated Fastify routes, harden websocket log ingestion against deleted tasks, and update the existing static task-management page to manage checkbox selection and call the new APIs. Backend behavior is covered with Vitest; the static page is validated manually against the running server.

**Tech Stack:** TypeScript, Fastify, sql.js, Vitest, plain HTML/CSS/JavaScript in `apps/server/src/web/index.html`

---

## File Structure

### Existing files to modify

- `apps/server/src/modules/tasks/tasks.service.ts`
  - Add single-delete and bulk-delete methods for `tasks` + `task_logs`.
- `apps/server/src/modules/tasks/tasks.routes.ts`
  - Add `DELETE /api/tasks/:taskId` and `POST /api/tasks/bulk-delete`.
- `apps/server/src/ws/ws-handlers.ts`
  - Ignore `task.log` messages for tasks already deleted from the platform.
- `apps/server/src/ws/ws-handlers.test.ts`
  - Add regression coverage for deleted-task log uploads.
- `apps/server/src/web/index.html`
  - Add checkbox selection, select-all, single delete, and bulk delete UI.

### New files to create

- `apps/server/src/modules/tasks/tasks.service.test.ts`
  - Service-level DB-backed tests for delete behavior.
- `apps/server/src/modules/tasks/tasks.routes.test.ts`
  - Fastify route tests for delete endpoints and audit logging.

### Verification commands used in this plan

- `pnpm --filter @rag/server exec vitest run src/modules/tasks/tasks.service.test.ts`
- `pnpm --filter @rag/server exec vitest run src/modules/tasks/tasks.routes.test.ts`
- `pnpm --filter @rag/server exec vitest run src/ws/ws-handlers.test.ts`
- `pnpm --filter @rag/server test`
- `pnpm --filter @rag/server typecheck`

---

### Task 1: Add task-service delete coverage and implementation

**Files:**
- Create: `apps/server/src/modules/tasks/tasks.service.test.ts`
- Modify: `apps/server/src/modules/tasks/tasks.service.ts`
- Test: `apps/server/src/modules/tasks/tasks.service.test.ts`

- [x] **Step 1: Write the failing service test file**

```ts
import { beforeEach, describe, expect, it, vi } from 'vitest';
import initSqlJs, { type Database } from 'sql.js';
import { migrate } from '../../db/migrate.js';

const state = vi.hoisted(() => ({
  db: null as Database | null,
}));

vi.mock('../../db/index.js', () => ({
  getDb: () => {
    if (!state.db) throw new Error('test database not initialized');
    return state.db;
  },
}));

import { TasksService } from './tasks.service.js';

function insertTask(params: { id: string; clientId: string; status?: string; result?: string | null; error?: string | null }): void {
  const now = 1_000_000;
  state.db!.run(
    `INSERT INTO tasks (id, client_id, type, status, payload, result, error, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [params.id, params.clientId, 'exec_script', params.status ?? 'pending', '{"runtime":"node"}', params.result ?? null, params.error ?? null, now],
  );
}

function insertTaskLog(params: { taskId: string; content: string }): void {
  state.db!.run(
    `INSERT INTO task_logs (task_id, stream, content, created_at) VALUES (?, ?, ?, ?)`,
    [params.taskId, 'stdout', params.content, 1_000_000],
  );
}

describe('TasksService delete operations', () => {
  let service: TasksService;

  beforeEach(async () => {
    const SQL = await initSqlJs();
    state.db = new SQL.Database();
    migrate(state.db);
    service = new TasksService();
  });

  it('deletes a single task together with its logs while preserving other tasks', () => {
    insertTask({ id: 'task_delete_me', clientId: 'client-1', result: '{"ok":true}' });
    insertTask({ id: 'task_keep_me', clientId: 'client-2', error: 'boom' });
    insertTaskLog({ taskId: 'task_delete_me', content: 'delete-log-1' });
    insertTaskLog({ taskId: 'task_delete_me', content: 'delete-log-2' });
    insertTaskLog({ taskId: 'task_keep_me', content: 'keep-log' });

    const summary = service.deleteTaskById('task_delete_me');

    expect(summary).toEqual({ deletedTask: true, deletedLogs: 2 });
    expect(service.getTask('task_delete_me')).toBeUndefined();
    expect(service.getTask('task_keep_me')).toBeDefined();

    const deletedLogs = state.db!.exec("SELECT id FROM task_logs WHERE task_id = 'task_delete_me'");
    expect(deletedLogs.length).toBe(0);

    const keptLogs = state.db!.exec("SELECT content FROM task_logs WHERE task_id = 'task_keep_me'");
    expect(keptLogs[0].values).toEqual([['keep-log']]);
  });

  it('returns zero counts when deleting a missing task', () => {
    insertTask({ id: 'task_keep_me', clientId: 'client-2' });
    insertTaskLog({ taskId: 'task_keep_me', content: 'keep-log' });

    const summary = service.deleteTaskById('task_missing');

    expect(summary).toEqual({ deletedTask: false, deletedLogs: 0 });
    expect(service.getTask('task_keep_me')).toBeDefined();
  });

  it('bulk deletes multiple tasks, deduplicates ids, and preserves unrelated rows', () => {
    insertTask({ id: 'task_a', clientId: 'client-1' });
    insertTask({ id: 'task_b', clientId: 'client-1' });
    insertTask({ id: 'task_c', clientId: 'client-2' });
    insertTaskLog({ taskId: 'task_a', content: 'a-1' });
    insertTaskLog({ taskId: 'task_a', content: 'a-2' });
    insertTaskLog({ taskId: 'task_b', content: 'b-1' });
    insertTaskLog({ taskId: 'task_c', content: 'c-1' });

    const summary = service.deleteTasksByIds(['task_a', 'task_b', 'task_a', 'task_missing']);

    expect(summary).toEqual({ deletedTasks: 2, deletedLogs: 3 });
    expect(service.getTask('task_a')).toBeUndefined();
    expect(service.getTask('task_b')).toBeUndefined();
    expect(service.getTask('task_c')).toBeDefined();

    const remainingLogs = state.db!.exec('SELECT task_id, content FROM task_logs ORDER BY task_id, content');
    expect(remainingLogs[0].values).toEqual([['task_c', 'c-1']]);
  });
});
```

- [ ] **Step 2: Run the service test to verify it fails**

Run:
```bash
pnpm --filter @rag/server exec vitest run src/modules/tasks/tasks.service.test.ts
```

Expected: FAIL with TypeScript/runtime errors indicating `deleteTaskById` and `deleteTasksByIds` do not exist yet on `TasksService`.

- [ ] **Step 3: Implement the minimal delete methods in `tasks.service.ts`**

Add the following methods inside `export class TasksService` before `deleteTasksByClientId(...)`:

```ts
  deleteTaskById(taskId: string): { deletedTask: boolean; deletedLogs: number } {
    const db = getDb();
    const task = this.getTask(taskId);
    if (!task) {
      return { deletedTask: false, deletedLogs: 0 };
    }

    db.run('DELETE FROM task_logs WHERE task_id = ?', [taskId]);
    const deletedLogs = db.getRowsModified();

    db.run('DELETE FROM tasks WHERE id = ?', [taskId]);
    const deletedTask = db.getRowsModified() > 0;

    return { deletedTask, deletedLogs };
  }

  deleteTasksByIds(taskIds: string[]): { deletedTasks: number; deletedLogs: number } {
    const db = getDb();
    const ids = [...new Set(taskIds.map((id) => id.trim()).filter(Boolean))];
    if (!ids.length) {
      return { deletedTasks: 0, deletedLogs: 0 };
    }

    const placeholders = ids.map(() => '?').join(', ');

    db.run(`DELETE FROM task_logs WHERE task_id IN (${placeholders})`, ids);
    const deletedLogs = db.getRowsModified();

    db.run(`DELETE FROM tasks WHERE id IN (${placeholders})`, ids);
    const deletedTasks = db.getRowsModified();

    return { deletedTasks, deletedLogs };
  }
```

- [ ] **Step 4: Run the service test to verify it passes**

Run:
```bash
pnpm --filter @rag/server exec vitest run src/modules/tasks/tasks.service.test.ts
```

Expected: PASS for all three `TasksService delete operations` tests.

- [ ] **Step 5: Commit the service-layer change**

```bash
git add apps/server/src/modules/tasks/tasks.service.ts apps/server/src/modules/tasks/tasks.service.test.ts
git commit -m "feat(server): add task delete service methods"
```

---

### Task 2: Add delete route coverage and implement the APIs

**Files:**
- Create: `apps/server/src/modules/tasks/tasks.routes.test.ts`
- Modify: `apps/server/src/modules/tasks/tasks.routes.ts`
- Test: `apps/server/src/modules/tasks/tasks.routes.test.ts`

- [ ] **Step 1: Write the failing route test file**

```ts
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import Fastify from 'fastify';
import { taskRoutes } from './tasks.routes.js';

vi.mock('../auth/auth.middleware.js', () => ({
  authMiddleware: async (request: unknown) => {
    (request as { authRole?: string }).authRole = 'agent';
  },
}));

const { deleteTaskByIdMock, deleteTasksByIdsMock, auditLogMock } = vi.hoisted(() => ({
  deleteTaskByIdMock: vi.fn(),
  deleteTasksByIdsMock: vi.fn(),
  auditLogMock: vi.fn(),
}));

vi.mock('./tasks.service.js', () => ({
  tasksService: {
    createTask: vi.fn(),
    updateTaskStatus: vi.fn(),
    listTasks: vi.fn(() => []),
    getTask: vi.fn(),
    getLogs: vi.fn(() => []),
    toApi: vi.fn((value) => value),
    deleteTaskById: deleteTaskByIdMock,
    deleteTasksByIds: deleteTasksByIdsMock,
  },
}));

vi.mock('../audit/audit.service.js', () => ({
  auditService: { log: auditLogMock },
}));

vi.mock('../connections/connections.manager.js', () => ({
  connectionManager: { sendToClient: vi.fn() },
}));

vi.mock('../clients/clients.service.js', () => ({
  clientsService: { getClient: vi.fn() },
}));

describe('task delete routes', () => {
  let app: ReturnType<typeof Fastify>;

  beforeEach(async () => {
    deleteTaskByIdMock.mockReset();
    deleteTasksByIdsMock.mockReset();
    auditLogMock.mockReset();
    app = Fastify();
    await app.register(taskRoutes);
  });

  afterEach(async () => {
    await app.close();
  });

  it('deletes a single task and writes an audit log', async () => {
    deleteTaskByIdMock.mockReturnValue({ deletedTask: true, deletedLogs: 2 });

    const response = await app.inject({ method: 'DELETE', url: '/api/tasks/task_1' });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ taskId: 'task_1', deletedTask: true, deletedLogs: 2 });
    expect(deleteTaskByIdMock).toHaveBeenCalledWith('task_1');
    expect(auditLogMock).toHaveBeenCalledWith({
      actor: 'agent',
      action: 'task.delete',
      targetType: 'task',
      targetId: 'task_1',
      detail: 'Deleted task task_1 with 2 logs',
    });
  });

  it('returns 404 when deleting a missing task', async () => {
    deleteTaskByIdMock.mockReturnValue({ deletedTask: false, deletedLogs: 0 });

    const response = await app.inject({ method: 'DELETE', url: '/api/tasks/task_missing' });

    expect(response.statusCode).toBe(404);
    expect(response.json()).toEqual({ error: 'Task not found' });
  });

  it('bulk deletes tasks, deduplicates ids, and writes an audit log', async () => {
    deleteTasksByIdsMock.mockReturnValue({ deletedTasks: 2, deletedLogs: 3 });

    const response = await app.inject({
      method: 'POST',
      url: '/api/tasks/bulk-delete',
      payload: { taskIds: ['task_a', 'task_b', 'task_a'] },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ requested: 2, deletedTasks: 2, deletedLogs: 3 });
    expect(deleteTasksByIdsMock).toHaveBeenCalledWith(['task_a', 'task_b']);
    expect(auditLogMock).toHaveBeenCalledWith({
      actor: 'agent',
      action: 'task.bulk_delete',
      targetType: 'task',
      targetId: 'bulk',
      detail: 'Deleted 2 tasks (requested: 2, logs: 3): task_a, task_b',
    });
  });

  it('rejects an empty bulk delete payload', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/tasks/bulk-delete',
      payload: { taskIds: [] },
    });

    expect(response.statusCode).toBe(400);
    expect(response.json()).toEqual({ error: 'Invalid payload', details: 'taskIds must be a non-empty array' });
    expect(deleteTasksByIdsMock).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run the route test to verify it fails**

Run:
```bash
pnpm --filter @rag/server exec vitest run src/modules/tasks/tasks.routes.test.ts
```

Expected: FAIL because the delete routes do not exist yet.

- [ ] **Step 3: Implement the delete endpoints in `tasks.routes.ts`**

Add `zod` import and the bulk-delete schema at the top of the file:

```ts
import { z } from 'zod';

const BulkDeleteTasksPayloadSchema = z.object({
  taskIds: z.array(z.string().min(1)).min(1),
});
```

Then add the two routes after the existing `GET /api/tasks/:taskId/logs` route:

```ts
  app.delete<{ Params: { taskId: string } }>('/api/tasks/:taskId', async (request, reply) => {
    const { taskId } = request.params;
    const result = tasksService.deleteTaskById(taskId);
    if (!result.deletedTask) {
      return reply.code(404).send({ error: 'Task not found' });
    }

    const actor = (request as unknown as { authRole: string }).authRole;
    auditService.log({
      actor,
      action: 'task.delete',
      targetType: 'task',
      targetId: taskId,
      detail: `Deleted task ${taskId} with ${result.deletedLogs} logs`,
    });

    return reply.send({
      taskId,
      deletedTask: result.deletedTask,
      deletedLogs: result.deletedLogs,
    });
  });

  app.post('/api/tasks/bulk-delete', async (request, reply) => {
    const parsed = BulkDeleteTasksPayloadSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: 'Invalid payload', details: 'taskIds must be a non-empty array' });
    }

    const taskIds = [...new Set(parsed.data.taskIds.map((id) => id.trim()).filter(Boolean))];
    if (!taskIds.length) {
      return reply.code(400).send({ error: 'Invalid payload', details: 'taskIds must be a non-empty array' });
    }

    const result = tasksService.deleteTasksByIds(taskIds);
    const actor = (request as unknown as { authRole: string }).authRole;
    auditService.log({
      actor,
      action: 'task.bulk_delete',
      targetType: 'task',
      targetId: 'bulk',
      detail: `Deleted ${result.deletedTasks} tasks (requested: ${taskIds.length}, logs: ${result.deletedLogs}): ${taskIds.join(', ')}`,
    });

    return reply.send({
      requested: taskIds.length,
      deletedTasks: result.deletedTasks,
      deletedLogs: result.deletedLogs,
    });
  });
```

- [ ] **Step 4: Run the route test to verify it passes**

Run:
```bash
pnpm --filter @rag/server exec vitest run src/modules/tasks/tasks.routes.test.ts
```

Expected: PASS for the four `task delete routes` tests.

- [ ] **Step 5: Commit the route-layer change**

```bash
git add apps/server/src/modules/tasks/tasks.routes.ts apps/server/src/modules/tasks/tasks.routes.test.ts
git commit -m "feat(server): add task delete APIs"
```

---

### Task 3: Prevent deleted tasks from receiving new websocket logs

**Files:**
- Modify: `apps/server/src/ws/ws-handlers.test.ts`
- Modify: `apps/server/src/ws/ws-handlers.ts`
- Test: `apps/server/src/ws/ws-handlers.test.ts`

- [ ] **Step 1: Add a failing websocket regression test**

Append this test inside `describe('ws handlers auto mapping lifecycle', ...)` in `apps/server/src/ws/ws-handlers.test.ts`:

```ts
  it('ignores task.log messages for tasks that were already deleted', async () => {
    const { tasksService } = await import('../modules/tasks/tasks.service.js');
    const updateTaskStatusMock = vi.mocked(tasksService.updateTaskStatus);
    const addLogMock = vi.mocked(tasksService.addLog);
    const getTaskMock = vi.mocked(tasksService.getTask);

    updateTaskStatusMock.mockReset();
    addLogMock.mockReset();
    getTaskMock.mockReset();
    getTaskMock.mockReturnValue(undefined);

    const ws = { send: wsSendMock } as never;

    await handleWsMessage(ws, JSON.stringify({
      type: 'task.log',
      requestId: 'log_1',
      payload: {
        taskId: 'task_deleted',
        stream: 'stdout',
        content: 'still running on client',
      },
    }));

    expect(getTaskMock).toHaveBeenCalledWith('task_deleted');
    expect(addLogMock).not.toHaveBeenCalled();
    expect(wsSendMock).not.toHaveBeenCalledWith(expect.stringContaining('server.error'));
  });
```

- [ ] **Step 2: Run the websocket test to verify it fails**

Run:
```bash
pnpm --filter @rag/server exec vitest run src/ws/ws-handlers.test.ts
```

Expected: FAIL because `task.log` currently always calls `tasksService.addLog(...)`.

- [ ] **Step 3: Implement the log-ingestion guard in `ws-handlers.ts`**

Replace the `case 'task.log':` block with:

```ts
    case 'task.log': {
      const parsed = TaskLogPayloadSchema.safeParse(message.payload);
      if (!parsed.success) {
        ws.send(JSON.stringify({ type: 'server.error', requestId: message.requestId, payload: { code: 'INVALID_PAYLOAD', message: parsed.error.message } }));
        return;
      }

      const { taskId, stream, content } = parsed.data;
      const task = tasksService.getTask(taskId);
      if (!task) {
        console.warn(`[task.log] ignored log for deleted or missing task ${taskId}`);
        break;
      }

      tasksService.addLog(taskId, stream, content);
      break;
    }
```

- [ ] **Step 4: Run the websocket test to verify it passes**

Run:
```bash
pnpm --filter @rag/server exec vitest run src/ws/ws-handlers.test.ts
```

Expected: PASS, including the new deleted-task log regression test.

- [ ] **Step 5: Commit the websocket hardening change**

```bash
git add apps/server/src/ws/ws-handlers.ts apps/server/src/ws/ws-handlers.test.ts
git commit -m "fix(server): ignore logs for deleted tasks"
```

---

### Task 4: Add checkbox selection, single delete, and bulk delete to the task page

**Files:**
- Modify: `apps/server/src/web/index.html`
- Test: manual browser verification against the running server

- [ ] **Step 1: Replace the task-page functions with a delete-capable version**

In `apps/server/src/web/index.html`, replace the existing task-management block from `async function loadTasks(){...}` through `async function viewLogs(taskId){...}` with the following code:

```html
<script>
window._selectedTaskIds = window._selectedTaskIds || [];

function getSelectedTaskIds(){
  return Array.isArray(window._selectedTaskIds) ? window._selectedTaskIds : [];
}

function setSelectedTaskIds(ids){
  window._selectedTaskIds = [...new Set((ids || []).filter(Boolean))];
}

function isTaskSelected(taskId){
  return getSelectedTaskIds().includes(taskId);
}

function toggleTaskSelection(taskId, checked){
  const next = new Set(getSelectedTaskIds());
  if(checked) next.add(taskId); else next.delete(taskId);
  setSelectedTaskIds([...next]);
  const countEl = document.getElementById('task-selected-count');
  if(countEl) countEl.textContent = String(getSelectedTaskIds().length);
}

function toggleAllTasks(taskIds, checked){
  setSelectedTaskIds(checked ? taskIds : []);
  loadTasks();
}

function pruneTaskSelection(tasks){
  const validIds = new Set((tasks || []).map(t => t.id));
  setSelectedTaskIds(getSelectedTaskIds().filter(id => validIds.has(id)));
}

async function loadTasks(){
  const el=document.getElementById('section-tasks');
  const[cl,tsk]=await Promise.all([api('GET','/api/clients'),api('GET','/api/tasks?limit=50')]);
  const clients=cl.data||[];
  const tasks=tsk.data||[];
  window._clients=clients;
  pruneTaskSelection(tasks);
  const selectedIds=getSelectedTaskIds();
  const allSelected=tasks.length>0&&tasks.every(t=>selectedIds.includes(t.id));
  el.innerHTML=`<h2>📋 任务</h2><div class="btn-group"><button class="btn btn-primary" onclick="showCreateTask()">+ 新建任务</button><button class="btn" onclick="loadTasks()">🔄 刷新</button><button class="btn btn-danger" onclick="deleteSelectedTasks()">🗑 删除选中 (<span id="task-selected-count">${selectedIds.length}</span>)</button></div><div id="create-task-form" style="background:var(--panel);border:1px solid var(--border);border-radius:8px;padding:16px;margin-bottom:16px;display:none"></div><table><thead><tr><th><input type="checkbox" ${allSelected?'checked':''} onchange='toggleAllTasks(${JSON.stringify(tasks.map(t=>t.id))},this.checked)'></th><th>ID</th><th>客户端</th><th>类型</th><th>状态</th><th>结果</th><th>操作</th></tr></thead><tbody>${tasks.map(t=>`<tr><td><input type="checkbox" ${selectedIds.includes(t.id)?'checked':''} onchange="toggleTaskSelection('${t.id}',this.checked)"></td><td style="font-family:monospace;font-size:12px">${t.id.slice(0,14)}</td><td>${t.clientId}</td><td>${t.type}</td><td>${badge(t.status)}</td><td style="font-family:monospace;font-size:11px;max-width:180px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${t.error||JSON.stringify(t.result)?.slice(0,40)||'-'}</td><td><button class="btn btn-sm" onclick="viewLogs('${t.id}')">日志</button><button class="btn btn-sm btn-danger" onclick="deleteTask('${t.id}')">删除</button></td></tr>`).join('')||'<tr><td colspan="7" style="color:var(--dim)">暂无任务</td></tr>'}</tbody></table>`;
}

function showCreateTask(){const div=document.getElementById('create-task-form');const clientOpts=(window._clients||[]).filter(c=>c.online).map(c=>`<option value="${c.id}">${c.id} (${c.name})</option>`).join('')||'<option value="">没有在线客户端</option>';div.style.display='block';div.innerHTML=`<h3 style="margin-bottom:12px">新建任务</h3><div class="form-row"><div class="form-group"><label>目标客户端</label><select id="t-client">${clientOpts}</select></div><div class="form-group"><label>任务类型</label><select id="t-type" onchange="onTaskTypeChange()"><option value="exec_script">exec_script - 执行脚本</option><option value="exec_command">exec_command - 执行命令</option><option value="push_file">push_file - 推送文件</option><option value="health_check">health_check - 健康检查</option></select></div></div><div class="form-group"><label>Payload (JSON)</label><textarea id="t-payload" rows="6">{"runtime":"node","script":"console.log('hello')","timeoutMs":10000}</textarea></div><div class="btn-group"><button class="btn btn-primary" onclick="doCreateTask()">创建任务</button><button class="btn" onclick="document.getElementById('create-task-form').style.display='none'">取消</button></div>`}
function onTaskTypeChange(){const t=document.getElementById('t-type').value;const p={exec_script:'{"runtime":"node","script":"console.log(\'hello\')","timeoutMs":10000}',exec_command:'{"command":"echo hello","timeoutMs":10000}',push_file:'{"fileId":"填入文件ID","targetPath":"downloads","fileName":"test.txt"}',health_check:'{}'};document.getElementById('t-payload').value=p[t]||'{}'}
async function doCreateTask(){const clientId=document.getElementById('t-client').value;const type=document.getElementById('t-type').value;let payload;try{payload=JSON.parse(document.getElementById('t-payload').value)}catch{return toast('JSON 格式错误')}const{status,data}=await api('POST','/api/tasks',{clientId,type,payload});if(status===201){toast('任务已创建: '+data.id);loadTasks()}else toast('创建失败: '+JSON.stringify(data))}
async function deleteTask(taskId){if(!confirm('确定删除任务 '+taskId+' 吗？该操作会同时删除日志和结果。'))return;const{status,data}=await api('DELETE','/api/tasks/'+taskId);if(status===200){setSelectedTaskIds(getSelectedTaskIds().filter(id=>id!==taskId));toast('任务已删除: '+taskId);loadTasks()}else toast('删除失败: '+JSON.stringify(data))}
async function deleteSelectedTasks(){const taskIds=getSelectedTaskIds();if(!taskIds.length)return toast('请先选择任务');if(!confirm('确定删除选中的 '+taskIds.length+' 个任务吗？该操作会同时删除日志和结果。'))return;const{status,data}=await api('POST','/api/tasks/bulk-delete',{taskIds});if(status===200){setSelectedTaskIds([]);toast('已删除任务 '+data.deletedTasks+' 个，日志 '+data.deletedLogs+' 条');loadTasks()}else toast('批量删除失败: '+JSON.stringify(data))}
async function viewLogs(taskId){const{data:task}=await api('GET','/api/tasks/'+taskId);const{data:logs}=await api('GET','/api/tasks/'+taskId+'/logs');const overlay=document.createElement('div');overlay.className='modal-overlay';overlay.innerHTML=`<div class="modal"><button class="modal-close" onclick="this.closest('.modal-overlay').remove()">✕</button><h3>任务: ${taskId}</h3><p style="color:var(--dim);margin-bottom:12px">类型: ${task?.type||'?'} | 状态: ${badge(task?.status||'?')} | 结果: ${JSON.stringify(task?.result)}</p><div class="logs">${(logs||[]).map(l=>`<span class="log-${l.stream}">[${timeStr(l.createdAt)}] ${l.content}</span>`).join('\n')||'<span style="color:var(--dim)">暂无日志</span>'}</div></div>`;document.body.appendChild(overlay);overlay.addEventListener('click',e=>{if(e.target===overlay)overlay.remove()})}
</script>
```

- [ ] **Step 2: Start the server and manually verify the task page**

Run the server:
```bash
pnpm --filter @rag/server dev
```

Then verify in the browser:

1. Open the web UI and enter the 任务 page.
2. Confirm each row has a checkbox and the header has a select-all checkbox.
3. Confirm the top button shows `删除选中 (0)` when nothing is selected.
4. Select one row and confirm the count updates.
5. Click a row-level 删除 button and confirm the row disappears after refresh.
6. Select multiple rows and click `删除选中`, confirm the rows disappear after refresh.
7. Click `删除选中` with no selection and confirm the toast says `请先选择任务`.
8. Open a task log modal after deleting other tasks to confirm the remaining rows still work.

Expected: all eight checks succeed with no JS console errors.

- [ ] **Step 3: Run the focused backend test suite after the UI change**

Run:
```bash
pnpm --filter @rag/server test
```

Expected: PASS for all server Vitest suites, confirming the UI change did not require backend fixes.

- [ ] **Step 4: Commit the task-page change**

```bash
git add apps/server/src/web/index.html
git commit -m "feat(web): add task bulk delete UI"
```

---

### Task 5: Final verification and handoff

**Files:**
- Modify: none
- Test: full verification only

- [ ] **Step 1: Run final server tests**

Run:
```bash
pnpm --filter @rag/server test
```

Expected: PASS across service, route, websocket, and existing server tests.

- [ ] **Step 2: Run final server typecheck**

Run:
```bash
pnpm --filter @rag/server typecheck
```

Expected: PASS with zero TypeScript errors.

- [ ] **Step 3: Review the final diff**

Run:
```bash
git diff -- apps/server/src/modules/tasks/tasks.service.ts apps/server/src/modules/tasks/tasks.routes.ts apps/server/src/modules/tasks/tasks.service.test.ts apps/server/src/modules/tasks/tasks.routes.test.ts apps/server/src/ws/ws-handlers.ts apps/server/src/ws/ws-handlers.test.ts apps/server/src/web/index.html
```

Expected: diff only shows the planned delete API, delete tests, websocket guard, and task UI changes.

- [ ] **Step 4: Create the final feature commit**

```bash
git add apps/server/src/modules/tasks/tasks.service.ts apps/server/src/modules/tasks/tasks.routes.ts apps/server/src/modules/tasks/tasks.service.test.ts apps/server/src/modules/tasks/tasks.routes.test.ts apps/server/src/ws/ws-handlers.ts apps/server/src/ws/ws-handlers.test.ts apps/server/src/web/index.html
git commit -m "feat: add task delete and bulk delete"
```

- [ ] **Step 5: Summarize verification evidence for handoff**

Record the exact passing commands and key manual checks in the final handoff note:

```text
Verified:
- pnpm --filter @rag/server exec vitest run src/modules/tasks/tasks.service.test.ts
- pnpm --filter @rag/server exec vitest run src/modules/tasks/tasks.routes.test.ts
- pnpm --filter @rag/server exec vitest run src/ws/ws-handlers.test.ts
- pnpm --filter @rag/server test
- pnpm --filter @rag/server typecheck
Manual UI checks:
- single delete works
- checkbox selection works
- select-all works
- bulk delete works
- empty-selection toast works
```
