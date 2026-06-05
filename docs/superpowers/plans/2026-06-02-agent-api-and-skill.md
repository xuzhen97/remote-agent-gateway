# Agent API 统一封装 + Skill 实现计划

> **面向 AI 代理的工作者：** 必需子技能：使用 superpowers:subagent-driven-development（推荐）或 superpowers:executing-plans 逐任务实现此计划。步骤使用复选框（`- [ ]`）语法来跟踪进度。

**目标：** 在 `/api/agent/*` 下补齐客户端列表和文件会话 API，并创建 Agent Skill 文档，让 AI Agent 通过统一入口控制整个平台。

**架构：** 在现有 `agent.routes.ts` 中增加 3 个新端点（clients 列表、file-session 创建/停止），复用已有的 `clientsService` 和 `clientFileSessionsService`。file-session 端点额外获取 roots 返回给调用方，减少 Agent 一次请求。Skill 文档定义完整 API 参考和工作流。

**技术栈：** Fastify, Vitest, Zod, existing shared schemas

---

## 文件变更清单

| 变更 | 文件 | 职责 |
|------|------|------|
| 修改 | `packages/shared/src/schemas.ts` | 新增 `AgentFileSessionPayloadSchema` 和 `AgentDeleteFileSessionPayloadSchema` |
| 修改 | `apps/server/src/modules/agent/agent.routes.ts` | 新增 `GET /api/agent/clients`、`GET /api/agent/clients/:clientId`、`POST /api/agent/file-session`、`DELETE /api/agent/file-session` |
| 新建 | `apps/server/src/modules/agent/agent.routes.test.ts` | 新端点的测试 |
| 新建 | `.claude/skills/rag-agent/SKILL.md` | Agent Skill 定义，包含完整 API 参考和工作流 |

---

### 任务 1：新增 Zod Schema

**文件：**
- 修改：`packages/shared/src/schemas.ts`
- 修改：`packages/shared/src/index.ts`（确认已有的 re-export 是否覆盖新 schema）

- [ ] **步骤 1：在 `schemas.ts` 末尾添加两个新 schema**

在 `AgentClosePortPayloadSchema` 之后添加：

```typescript
export const AgentFileSessionPayloadSchema = z.object({
  clientId: z.string().min(1),
});

export const AgentDeleteFileSessionPayloadSchema = z.object({
  clientId: z.string().min(1),
});
```

- [ ] **步骤 2：在 `index.ts` 确认 re-export 覆盖**

检查 `packages/shared/src/index.ts` 是否用了 `export * from './schemas.js'`，如果是则无需修改。如果不是，添加对新 schema 的导出。

- [ ] **步骤 3：运行 TypeScript 编译确认无错误**

```bash
cd D:/remote-agent-gateway && pnpm --filter @rag/shared exec tsc --noEmit
```

预期：无错误输出。

- [ ] **步骤 4：Commit**

```bash
git add packages/shared/src/schemas.ts
git commit -m "feat(shared): add AgentFileSessionPayloadSchema and AgentDeleteFileSessionPayloadSchema"
```

---

### 任务 2：新增 Agent API 端点

**文件：**
- 修改：`apps/server/src/modules/agent/agent.routes.ts`

- [ ] **步骤 1：添加新的 import**

在 `agent.routes.ts` 顶部添加 import：

```typescript
import {
  AgentRunScriptPayloadSchema,
  AgentPushFilePayloadSchema,
  AgentOpenPortPayloadSchema,
  AgentClosePortPayloadSchema,
  AgentFileSessionPayloadSchema,
  AgentDeleteFileSessionPayloadSchema,
} from '@rag/shared';
import { clientFileSessionsService } from '../client-files/client-file-sessions.service.js';
import { clientFileProxyService } from '../client-files/client-file-proxy.service.js';
```

- [ ] **步骤 2：添加 GET /api/agent/clients 端点**

在 `agentRoutes` 函数中，`// Run script` 注释之前插入：

```typescript
  // List clients
  app.get('/api/agent/clients', async (_request) => {
    const clients = clientsService.listClients();
    return clients.map((c) => clientsService.toApi(c));
  });

  // Get client by ID
  app.get<{ Params: { clientId: string } }>('/api/agent/clients/:clientId', async (request, reply) => {
    const client = clientsService.getClient(request.params.clientId);
    if (!client) {
      return reply.code(404).send({ error: 'Client not found' });
    }
    return clientsService.toApi(client);
  });
```

- [ ] **步骤 3：添加 POST /api/agent/file-session 端点**

在 clients 端点之后插入：

```typescript
  // Create or reuse file session — returns direct-connect info plus roots
  app.post('/api/agent/file-session', async (request, reply) => {
    const parseResult = AgentFileSessionPayloadSchema.safeParse(request.body);
    if (!parseResult.success) {
      return reply.code(400).send({ error: 'Invalid payload', details: parseResult.error.issues });
    }

    const { clientId } = parseResult.data;
    const client = clientsService.getClient(clientId);
    if (!client) {
      return reply.code(404).send({ error: 'Client not found' });
    }

    try {
      const session = await clientFileSessionsService.startSession(clientId);
      // Fetch roots from client file service for convenience
      let roots: Array<{ id: string; label: string; path: string }> = [];
      try {
        const rootsResult = await clientFileProxyService.roots(session) as { roots?: Array<{ id: string; label: string; path: string }> };
        roots = rootsResult.roots ?? [];
      } catch {
        // Roots fetch failure is non-fatal; caller can retry later
      }

      return {
        clientId: session.clientId,
        publicUrl: session.publicUrl,
        token: session.token,
        localPort: session.localPort,
        mappingId: session.mappingId,
        startedAt: session.startedAt,
        expiresAt: session.expiresAt,
        roots,
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return reply.code(500).send({ error: message });
    }
  });

  // Stop file session
  app.delete('/api/agent/file-session', async (request, reply) => {
    const parseResult = AgentDeleteFileSessionPayloadSchema.safeParse(request.body);
    if (!parseResult.success) {
      return reply.code(400).send({ error: 'Invalid payload', details: parseResult.error.issues });
    }

    const { clientId } = parseResult.data;
    try {
      const session = await clientFileSessionsService.stopSession(clientId);
      if (!session) {
        return reply.code(404).send({ error: 'No active session for this client' });
      }
      return { success: true };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return reply.code(500).send({ error: message });
    }
  });
```

- [ ] **步骤 4：运行 TypeScript 编译确认无错误**

```bash
cd D:/remote-agent-gateway && pnpm --filter @rag/server exec tsc --noEmit
```

预期：无错误输出。

- [ ] **步骤 5：Commit**

```bash
git add apps/server/src/modules/agent/agent.routes.ts
git commit -m "feat(agent): add clients list and file-session endpoints to agent API"
```

---

### 任务 3：编写 Agent 路由测试

**文件：**
- 新建：`apps/server/src/modules/agent/agent.routes.test.ts`

- [ ] **步骤 1：编写完整的测试文件**

创建 `apps/server/src/modules/agent/agent.routes.test.ts`，覆盖以下场景：
- `GET /api/agent/clients` 返回客户端列表
- `GET /api/agent/clients/:clientId` 返回单个客户端
- `GET /api/agent/clients/:clientId` 客户端不存在返回 404
- `POST /api/agent/file-session` 创建会话并返回 publicUrl + roots
- `POST /api/agent/file-session` 客户端不存在返回 404
- `POST /api/agent/file-session` startSession 抛错返回 500
- `DELETE /api/agent/file-session` 停止会话成功
- `DELETE /api/agent/file-session` 无活跃会话返回 404
- 现有端点（run-script, push-file, open-port, close-port, tasks/:taskId）不被破坏

测试文件内容：

```typescript
import { describe, expect, it, vi } from 'vitest';
import Fastify from 'fastify';
import { agentRoutes } from './agent.routes.js';

vi.mock('../auth/auth.middleware.js', () => ({
  authMiddleware: async (request: unknown) => {
    (request as { authRole?: string }).authRole = 'agent';
  },
}));

const { listClientsMock, getClientMock, toApiMock, startSessionMock, stopSessionMock, rootsMock, createTaskMock, sendToClientMock } = vi.hoisted(() => ({
  listClientsMock: vi.fn(() => [{ id: 'client-1', name: 'Test Box' }]),
  getClientMock: vi.fn((id: string) => id === 'client-1' ? { id: 'client-1', name: 'Test Box' } : undefined),
  toApiMock: vi.fn((c: unknown) => c),
  startSessionMock: vi.fn(),
  stopSessionMock: vi.fn(),
  rootsMock: vi.fn(),
  createTaskMock: vi.fn(() => ({ id: 'task_1' })),
  sendToClientMock: vi.fn(() => true),
}));

vi.mock('../clients/clients.service.js', () => ({
  clientsService: {
    listClients: listClientsMock,
    getClient: getClientMock,
    toApi: toApiMock,
  },
}));

vi.mock('../client-files/client-file-sessions.service.js', () => ({
  clientFileSessionsService: {
    startSession: startSessionMock,
    stopSession: stopSessionMock,
  },
}));

vi.mock('../client-files/client-file-proxy.service.js', () => ({
  clientFileProxyService: {
    roots: rootsMock,
  },
}));

vi.mock('../tasks/tasks.service.js', () => ({
  tasksService: {
    createTask: createTaskMock,
    getTask: vi.fn(),
  },
}));

vi.mock('../connections/connections.manager.js', () => ({
  connectionManager: {
    isOnline: vi.fn(() => true),
    sendToClient: sendToClientMock,
  },
}));

vi.mock('../files/files.service.js', () => ({
  filesService: {
    getFile: vi.fn(),
  },
}));

vi.mock('../frp/frp.service.js', () => ({
  frpService: {
    createMapping: vi.fn(),
    toApi: vi.fn(),
    getMapping: vi.fn(),
    deleteMapping: vi.fn(),
  },
  getFrpsConnectionInfo: vi.fn(() => ({
    serverAddr: 'frps.example.com',
    serverPort: 7000,
    authToken: 'frps-token',
  })),
}));

vi.mock('../audit/audit.service.js', () => ({
  auditService: { log: vi.fn() },
}));

describe('agent routes', () => {
  // --- Clients ---

  it('lists clients via GET /api/agent/clients', async () => {
    const app = Fastify();
    await app.register(agentRoutes);
    const res = await app.inject({ method: 'GET', url: '/api/agent/clients' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual([{ id: 'client-1', name: 'Test Box' }]);
  });

  it('returns a single client via GET /api/agent/clients/:clientId', async () => {
    const app = Fastify();
    await app.register(agentRoutes);
    const res = await app.inject({ method: 'GET', url: '/api/agent/clients/client-1' });
    expect(res.statusCode).toBe(200);
  });

  it('returns 404 for unknown client via GET /api/agent/clients/:clientId', async () => {
    const app = Fastify();
    await app.register(agentRoutes);
    const res = await app.inject({ method: 'GET', url: '/api/agent/clients/nonexistent' });
    expect(res.statusCode).toBe(404);
    expect(res.json()).toEqual({ error: 'Client not found' });
  });

  // --- File Session ---

  it('creates file session via POST /api/agent/file-session', async () => {
    startSessionMock.mockResolvedValueOnce({
      clientId: 'client-1',
      publicUrl: 'http://frps.example.com:23001',
      token: 'file_abc123',
      localPort: 45123,
      mappingId: 'pm_file',
      startedAt: 1000,
      expiresAt: Date.now() + 1800000,
    });
    rootsMock.mockResolvedValueOnce({
      roots: [{ id: 'root-0', label: 'workspace', path: '/home/user/workspace' }],
    });

    const app = Fastify();
    await app.register(agentRoutes);
    const res = await app.inject({
      method: 'POST',
      url: '/api/agent/file-session',
      payload: { clientId: 'client-1' },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.publicUrl).toBe('http://frps.example.com:23001');
    expect(body.token).toBe('file_abc123');
    expect(body.roots).toEqual([{ id: 'root-0', label: 'workspace', path: '/home/user/workspace' }]);
  });

  it('returns 404 if client not found in file-session', async () => {
    const app = Fastify();
    await app.register(agentRoutes);
    const res = await app.inject({
      method: 'POST',
      url: '/api/agent/file-session',
      payload: { clientId: 'nonexistent' },
    });
    expect(res.statusCode).toBe(404);
    expect(res.json()).toEqual({ error: 'Client not found' });
  });

  it('returns 500 if startSession throws', async () => {
    startSessionMock.mockRejectedValueOnce(new Error('Client is offline'));

    const app = Fastify();
    await app.register(agentRoutes);
    const res = await app.inject({
      method: 'POST',
      url: '/api/agent/file-session',
      payload: { clientId: 'client-1' },
    });
    expect(res.statusCode).toBe(500);
    expect(res.json()).toEqual({ error: 'Client is offline' });
  });

  it('returns roots as empty array when roots fetch fails', async () => {
    startSessionMock.mockResolvedValueOnce({
      clientId: 'client-1',
      publicUrl: 'http://frps.example.com:23001',
      token: 'file_abc123',
      localPort: 45123,
      mappingId: 'pm_file',
      startedAt: 1000,
      expiresAt: Date.now() + 1800000,
    });
    rootsMock.mockRejectedValueOnce(new Error('connection refused'));

    const app = Fastify();
    await app.register(agentRoutes);
    const res = await app.inject({
      method: 'POST',
      url: '/api/agent/file-session',
      payload: { clientId: 'client-1' },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json().roots).toEqual([]);
  });

  // --- Delete File Session ---

  it('stops file session via DELETE /api/agent/file-session', async () => {
    stopSessionMock.mockResolvedValueOnce({
      clientId: 'client-1',
      publicUrl: 'http://frps.example.com:23001',
      token: 'file_abc123',
      localPort: 45123,
      mappingId: 'pm_file',
      startedAt: 1000,
      expiresAt: Date.now() + 1800000,
    });

    const app = Fastify();
    await app.register(agentRoutes);
    const res = await app.inject({
      method: 'DELETE',
      url: '/api/agent/file-session',
      payload: { clientId: 'client-1' },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ success: true });
  });

  it('returns 404 when no active session to stop', async () => {
    stopSessionMock.mockResolvedValueOnce(undefined);

    const app = Fastify();
    await app.register(agentRoutes);
    const res = await app.inject({
      method: 'DELETE',
      url: '/api/agent/file-session',
      payload: { clientId: 'client-1' },
    });
    expect(res.statusCode).toBe(404);
    expect(res.json()).toEqual({ error: 'No active session for this client' });
  });

  // --- Existing endpoints still work ---

  it('run-script still works', async () => {
    const app = Fastify();
    await app.register(agentRoutes);
    const res = await app.inject({
      method: 'POST',
      url: '/api/agent/run-script',
      payload: { target: { clientId: 'client-1' }, script: 'console.log(1)' },
    });
    expect(res.statusCode).toBe(201);
  });
});
```

- [ ] **步骤 2：运行测试确认通过**

```bash
cd D:/remote-agent-gateway && npx vitest run apps/server/src/modules/agent/agent.routes.test.ts
```

预期：9 个测试全部通过。

- [ ] **步骤 3：运行全量测试确认不破坏**

```bash
cd D:/remote-agent-gateway && npx vitest run
```

预期：所有测试通过（当前 133 + 新增 9 = 142）。

- [ ] **步骤 4：Commit**

```bash
git add apps/server/src/modules/agent/agent.routes.test.ts
git commit -m "test(agent): add tests for clients and file-session agent endpoints"
```

---

### 任务 4：创建 Agent Skill 文档

**文件：**
- 新建：`.claude/skills/rag-agent/SKILL.md`

- [ ] **步骤 1：创建 SKILL.md**

```markdown
---
name: rag-agent
description: Control remote machines via the Remote Agent Gateway platform. Use when you need to execute scripts, manage files, create port mappings, or query client status on remote machines. Triggers: user mentions remote machines, wants to run commands on another computer, needs to access files on a remote machine, or wants to expose a local port.
---

# Remote Agent Gateway — AI Agent Skill

Control remote machines via HTTP API. All endpoints use Bearer token auth with `AGENT_API_TOKEN`.

## Configuration

Set these environment variables or provide them when asked:

- `RAG_SERVER_URL` — Gateway server URL (e.g. `http://localhost:3000`)
- `RAG_AGENT_TOKEN` — Agent API token (the `AGENT_API_TOKEN` value from server config)

All API calls: `Authorization: Bearer <RAG_AGENT_TOKEN>`

## Typical Workflow

```
1. GET  /api/agent/clients              → Find target machine
2. POST /api/agent/file-session         → Get direct file access URL + token
3. Use {publicUrl} + Authorization header to operate files directly
4. POST /api/agent/run-script           → Execute commands (optional)
5. POST /api/agent/open-port / close-port → Manage tunnels (optional)
6. GET  /api/agent/tasks/:taskId        → Check task status
```

## API Reference

### Clients

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/agent/clients` | List all clients (online + offline) |
| GET | `/api/agent/clients/:clientId` | Get single client details |

Response fields: `id`, `name`, `hostname`, `os`, `arch`, `tags[]`, `status`, `online`, `lastSeenAt`

### File Session (Direct Connect)

| Method | Path | Description |
|--------|------|-------------|
| POST | `/api/agent/file-session` | Create/reuse file session |
| DELETE | `/api/agent/file-session` | Stop file session |

**POST `/api/agent/file-session`**

Request:
```json
{ "clientId": "client-1" }
```

Response:
```json
{
  "clientId": "client-1",
  "publicUrl": "http://frps.example.com:23001",
  "token": "file_abc123",
  "localPort": 45123,
  "mappingId": "pm_file",
  "startedAt": 1748800000000,
  "expiresAt": 1748801800000,
  "roots": [
    { "id": "root-0", "label": "workspace", "path": "/home/user/workspace" }
  ]
}
```

**After getting the session, operate files directly via `publicUrl`:**

```
GET  {publicUrl}/v1/roots                                    — List browsable roots
GET  {publicUrl}/v1/list?rootId=root-0&path=.                — List directory
GET  {publicUrl}/v1/stat?rootId=root-0&path=file.txt         — File stat
GET  {publicUrl}/v1/read?rootId=root-0&path=file.txt         — Read file content
GET  {publicUrl}/v1/download?rootId=root-0&path=file.txt     — Download file
PUT  {publicUrl}/v1/write?rootId=root-0&path=file.txt        — Write file content
POST {publicUrl}/v1/upload?rootId=root-0&path=.&filename=f  — Upload file
POST {publicUrl}/v1/mkdir                                    — Create directory
DELETE {publicUrl}/v1/delete?rootId=root-0&path=dir&recursive=true — Delete
POST {publicUrl}/v1/move                                     — Move/rename
POST {publicUrl}/v1/copy                                     — Copy
```

All direct requests need header: `Authorization: Bearer {token}`

**DELETE `/api/agent/file-session`**

Request: `{ "clientId": "client-1" }`
Response: `{ "success": true }`

### Script Execution

**POST `/api/agent/run-script`**

```json
{
  "target": { "clientId": "client-1" },
  "script": "console.log('hello')",
  "timeoutMs": 30000
}
```

Response: task object with `id`. Poll `GET /api/agent/tasks/:taskId` for result.

### Port Mapping

**POST `/api/agent/open-port`**

```json
{
  "clientId": "client-1",
  "name": "ssh",
  "localPort": 22,
  "remotePort": 2222,
  "type": "tcp"
}
```

**POST `/api/agent/close-port`**

```json
{ "mappingId": "pm_abc" }
```

### File Push (Server-Hosted Files)

**POST `/api/agent/push-file`** — Push a file previously uploaded to server storage (`/api/files`) to a client.

```json
{
  "clientId": "client-1",
  "fileId": "file_xyz",
  "targetPath": "/home/user/deploy.tar.gz"
}
```

### Task Status

**GET `/api/agent/tasks/:taskId`**

Returns task with logs:
```json
{
  "id": "task_1",
  "clientId": "client-1",
  "type": "exec_script",
  "status": "success",
  "result": { ... },
  "logs": [
    { "stream": "stdout", "content": "hello\n", "createdAt": 1748800000000 }
  ]
}
```

## Common Patterns

### List remote files

```
1. GET /api/agent/clients → pick online client
2. POST /api/agent/file-session { "clientId": "client-1" }
3. GET {publicUrl}/v1/roots → see available roots
4. GET {publicUrl}/v1/list?rootId=root-0&path=. → browse files
```

### Download a file from remote machine

```
1. POST /api/agent/file-session { "clientId": "client-1" }
2. GET {publicUrl}/v1/read?rootId=root-0&path=config.yaml
   → Returns file content directly
```

### Upload a file to remote machine

```
1. POST /api/agent/file-session { "clientId": "client-1" }
2. PUT {publicUrl}/v1/write?rootId=root-0&path=deploy.sh
   Headers: Authorization: Bearer {token}, Content-Type: application/octet-stream
   Body: file content
```

Or use upload for multi-part:
```
2. POST {publicUrl}/v1/upload?rootId=root-0&path=.&filename=deploy.sh
   Headers: Authorization: Bearer {token}, Content-Type: application/octet-stream
   Body: file content
```

### Execute a remote script

```
1. POST /api/agent/run-script { "target": { "clientId": "client-1" }, "script": "ls -la" }
2. GET /api/agent/tasks/{taskId} → check result
```

### Expose a local port publicly

```
1. POST /api/agent/open-port { "clientId": "client-1", "name": "web", "localPort": 8080, "type": "tcp" }
   → Returns mapping with publicUrl
2. When done: POST /api/agent/close-port { "mappingId": "pm_xxx" }
```

## Notes

- File sessions expire after 30 minutes. Re-call `POST /api/agent/file-session` to renew.
- Direct file operations via `publicUrl` bypass the server — no server bandwidth consumed.
- If direct connection to `publicUrl` is not possible, fall back to proxied endpoints at `/api/clients/:clientId/files/*`.
- `push-file` pushes files from server storage, not from your local machine. For local file upload, use the direct `publicUrl` approach.
```

- [ ] **步骤 2：Commit**

```bash
git add .claude/skills/rag-agent/SKILL.md
git commit -m "docs: add rag-agent skill with complete API reference and workflow guide"
```

---

### 任务 5：全量验证 + 文档更新

**文件：**
- 修改：`docs/client-file-management.md` — 更新 API 参考部分加入 `/api/agent/*` 端点
- 修改：`README.md` — 更新 Agent API 表格

- [ ] **步骤 1：更新 docs/client-file-management.md 的 API 参考部分**

在"会话管理"表格后面添加 Agent API 小节：

在文件中 `### 会话管理` 区域后面，添加：

```markdown
### Agent 层入口（推荐）

AI Agent 应优先使用 `/api/agent/*` 端点，统一的 API 前缀和鉴权方式：

| 方法 | 路径 | 说明 |
|------|------|------|
| POST | `/api/agent/file-session` | 创建/复用文件会话，额外返回 `roots` |
| DELETE | `/api/agent/file-session` | 停止文件会话 |

Agent 文件会话响应比普通会话多一个 `roots` 字段，减少一次请求。
```

- [ ] **步骤 2：更新 README.md 的 Agent API 表格**

在 README.md 的 `AI Agent 高级接口` 部分，把表格扩展为：

```markdown
| `POST` | `/api/agent/run-script` | 在目标客户端执行脚本 |
| `POST` | `/api/agent/push-file` | 推送已上传的文件到客户端 |
| `POST` | `/api/agent/open-port` | 创建 FRP 端口映射 |
| `POST` | `/api/agent/close-port` | 删除端口映射 |
| `GET` | `/api/agent/clients` | 列出所有客户端 |
| `GET` | `/api/agent/clients/:clientId` | 获取客户端详情 |
| `POST` | `/api/agent/file-session` | 创建/复用文件会话（直连 FRP） |
| `DELETE` | `/api/agent/file-session` | 停止文件会话 |
| `GET` | `/api/agent/tasks/:id` | 查询任务状态（含日志） |
```

- [ ] **步骤 3：运行全量测试**

```bash
cd D:/remote-agent-gateway && npx vitest run
```

预期：142 个测试全部通过。

- [ ] **步骤 4：运行 TypeScript 编译**

```bash
cd D:/remote-agent-gateway && pnpm --filter @rag/server exec tsc --noEmit && pnpm --filter @rag/shared exec tsc --noEmit
```

预期：无错误输出。

- [ ] **步骤 5：Commit**

```bash
git add docs/client-file-management.md README.md
git commit -m "docs: add agent API endpoints to README and client-file-management docs"
```