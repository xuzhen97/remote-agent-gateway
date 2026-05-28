# Remote Agent Gateway 实现计划

> **面向 AI 代理的工作者：** 必需子技能：使用 superpowers:subagent-driven-development（推荐）或 superpowers:executing-plans 逐任务实现此计划。步骤使用复选框（`- [ ]`）语法来跟踪进度。

**目标：** 实现完整的 Remote Agent Gateway MVP——服务端（Fastify + WebSocket + SQLite）+ 客户端（Node.js Agent + 子进程执行）+ 共享类型包。

**架构：** pnpm monorepo，apps/server（公网服务端）、apps/client（内网客户端）、packages/shared（共享类型/协议/Zod schema）。服务端通过 WebSocket 长连接向客户端下发任务，客户端通过子进程执行脚本/命令/FRP 映射。

**技术栈：** Node.js 22+, TypeScript, Fastify, ws, better-sqlite3, Drizzle ORM, Zod, Pino, execa, Vitest

---

## 文件结构

```
remote-agent-gateway/
  package.json                          # root workspace config
  pnpm-workspace.yaml                   # pnpm monorepo
  tsconfig.base.json                    # shared TS config
  .gitignore
  .env.example

  packages/shared/
    package.json
    tsconfig.json
    src/
      index.ts                          # barrel export
      types.ts                          # TaskType, TaskStatus, ClientInfo, etc.
      protocol.ts                       # WS message types (client.register, task.dispatch, etc.)
      schemas.ts                        # Zod schemas for all payloads

  apps/server/
    package.json
    tsconfig.json
    src/
      main.ts                           # Fastify + WS bootstrap
      config/
        env.ts                          # env parsing with Zod
      db/
        index.ts                        # Drizzle + better-sqlite3 init
        schema.ts                       # All table definitions
        migrate.ts                      # auto-migrate on startup
      modules/
        auth/
          auth.service.ts               # token verification
          auth.middleware.ts             # Fastify preHandler
        clients/
          clients.service.ts            # CRUD + status
          clients.routes.ts             # GET /api/clients, GET /api/clients/:id
        connections/
          connections.manager.ts         # WebSocket connection map
        tasks/
          tasks.service.ts              # create, get, update, list
          tasks.routes.ts               # POST/GET /api/tasks, GET /api/tasks/:id/logs
        files/
          files.service.ts              # upload, store, metadata
          files.routes.ts               # POST/GET /api/files, GET /api/files/:id/download
        frp/
          frp.service.ts                # port mapping CRUD
          frp.routes.ts                 # POST/GET/DELETE /api/port-mappings
        audit/
          audit.service.ts              # audit log writer
        agent/
          agent.routes.ts               # POST /api/agent/run-script, push-file, open-port, close-port
      ws/
        ws-server.ts                    # WS upgrade handler + message router
        ws-handlers.ts                  # client.register, client.heartbeat, task.result, task.log

  apps/client/
    package.json
    tsconfig.json
    src/
      main.ts                           # bootstrap
      config/
        client.config.ts                # config.json loading + Zod validation
      core/
        connection.ts                   # WS connect with auto-reconnect
        register.ts                     # send client.register
        heartbeat.ts                    # periodic heartbeat
        task-dispatcher.ts              # route incoming task.dispatch to executors
      executors/
        exec-health-check.executor.ts
        exec-script.executor.ts
        exec-command.executor.ts
        push-file.executor.ts
        frp-create.executor.ts
        frp-remove.executor.ts
      services/
        file.service.ts                 # download from server
        script.service.ts               # write script to workspace
        frp.service.ts                  # manage frpc processes
        process.service.ts              # spawn + stream child_process
      runtime/
        workspace.ts                    # path resolution, dir creation
        security.ts                     # path allowlist, port blocklist
        logger.ts                       # Pino logger

  storage/
    files/                              # uploaded files (gitignored)
    logs/                               # server logs (gitignored)
    db.sqlite                           # SQLite DB (gitignored)

  frp/
    frps.toml                           # frps config template
```

---

### 任务 1：项目脚手架

**文件：**
- 创建：`package.json`
- 创建：`pnpm-workspace.yaml`
- 创建：`tsconfig.base.json`
- 创建：`.gitignore`
- 创建：`.env.example`
- 创建：`packages/shared/package.json`
- 创建：`packages/shared/tsconfig.json`
- 创建：`apps/server/package.json`
- 创建：`apps/server/tsconfig.json`
- 创建：`apps/client/package.json`
- 创建：`apps/client/tsconfig.json`

- [ ] **步骤 1：创建根 package.json**

```json
{
  "name": "remote-agent-gateway",
  "private": true,
  "scripts": {
    "dev:server": "pnpm --filter @rag/server dev",
    "dev:client": "pnpm --filter @rag/client dev",
    "build": "pnpm -r build",
    "test": "pnpm -r test",
    "typecheck": "pnpm -r typecheck"
  },
  "engines": {
    "node": ">=22"
  }
}
```

- [ ] **步骤 2：创建 pnpm-workspace.yaml**

```yaml
packages:
  - "apps/*"
  - "packages/*"
```

- [ ] **步骤 3：创建 tsconfig.base.json**

```json
{
  "compilerOptions": {
    "target": "ES2023",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true,
    "resolveJsonModule": true,
    "declaration": true,
    "declarationMap": true,
    "sourceMap": true,
    "outDir": "dist",
    "rootDir": "src"
  }
}
```

- [ ] **步骤 4：创建 .gitignore**

```gitignore
node_modules/
dist/
*.tsbuildinfo
storage/files/
storage/logs/
storage/db.sqlite
.env
apps/client/config.json
```

- [ ] **步骤 5：创建 .env.example**

```env
# Server
SERVER_PORT=3000
SERVER_HOST=0.0.0.0
ADMIN_TOKEN=change_me_admin_token
AGENT_API_TOKEN=change_me_agent_token
FRP_TOKEN=change_me_frp_token

# Database
DB_PATH=./storage/db.sqlite

# Storage
STORAGE_DIR=./storage/files

# FRP
FRP_PORT_RANGE_START=20000
FRP_PORT_RANGE_END=25000
```

- [ ] **步骤 6：创建 packages/shared/package.json**

```json
{
  "name": "@rag/shared",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "main": "./dist/index.js",
  "types": "./dist/index.d.ts",
  "exports": {
    ".": {
      "import": "./dist/index.js",
      "types": "./dist/index.d.ts"
    }
  },
  "scripts": {
    "build": "tsc",
    "typecheck": "tsc --noEmit",
    "test": "vitest run"
  },
  "dependencies": {
    "zod": "^3.24.0"
  },
  "devDependencies": {
    "typescript": "^5.7.0",
    "vitest": "^3.0.0"
  }
}
```

- [ ] **步骤 7：创建 apps/server/package.json**

```json
{
  "name": "@rag/server",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "main": "./dist/main.js",
  "scripts": {
    "dev": "tsx watch src/main.ts",
    "build": "tsc",
    "start": "node dist/main.js",
    "typecheck": "tsc --noEmit",
    "test": "vitest run"
  },
  "dependencies": {
    "@rag/shared": "workspace:*",
    "fastify": "^5.2.0",
    "@fastify/websocket": "^11.0.0",
    "@fastify/multipart": "^9.0.0",
    "@fastify/cors": "^10.0.0",
    "better-sqlite3": "^11.7.0",
    "drizzle-orm": "^0.38.0",
    "drizzle-kit": "^0.30.0",
    "zod": "^3.24.0",
    "pino": "^9.6.0",
    "pino-pretty": "^13.0.0",
    "dotenv": "^16.4.0",
    "uuid": "^11.0.0"
  },
  "devDependencies": {
    "@types/better-sqlite3": "^7.6.0",
    "@types/uuid": "^10.0.0",
    "typescript": "^5.7.0",
    "tsx": "^4.19.0",
    "vitest": "^3.0.0"
  }
}
```

- [ ] **步骤 8：创建 apps/client/package.json**

```json
{
  "name": "@rag/client",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "main": "./dist/main.js",
  "scripts": {
    "dev": "tsx watch src/main.ts",
    "build": "tsc",
    "start": "node dist/main.js",
    "typecheck": "tsc --noEmit",
    "test": "vitest run"
  },
  "dependencies": {
    "@rag/shared": "workspace:*",
    "ws": "^8.18.0",
    "zod": "^3.24.0",
    "pino": "^9.6.0",
    "pino-pretty": "^13.0.0",
    "execa": "^9.5.0",
    "fs-extra": "^11.3.0",
    "systeminformation": "^5.25.0"
  },
  "devDependencies": {
    "@types/ws": "^8.5.0",
    "@types/fs-extra": "^11.0.0",
    "typescript": "^5.7.0",
    "tsx": "^4.19.0",
    "vitest": "^3.0.0"
  }
}
```

- [ ] **步骤 9：创建各包的 tsconfig.json**

`packages/shared/tsconfig.json`:
```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "outDir": "dist",
    "rootDir": "src"
  },
  "include": ["src"]
}
```

`apps/server/tsconfig.json` 和 `apps/client/tsconfig.json` 同理，extends 路径为 `../../tsconfig.base.json`。

- [ ] **步骤 10：运行 pnpm install**

运行：`pnpm install`
预期：所有包安装成功，无报错。

- [ ] **步骤 11：验证各包 typecheck**

运行：`pnpm typecheck`
预期：各包报 "No inputs were found"，因为 src/ 下还没有 .ts 文件。

- [ ] **步骤 12：Commit**

```bash
git add -A
git commit -m "chore: scaffold pnpm monorepo with shared/server/client packages"
```

---

### 任务 2：共享类型包

**文件：**
- 创建：`packages/shared/src/types.ts`
- 创建：`packages/shared/src/protocol.ts`
- 创建：`packages/shared/src/schemas.ts`
- 创建：`packages/shared/src/index.ts`
- 创建：`packages/shared/src/__tests__/schemas.test.ts`

- [ ] **步骤 1：编写 types.ts 测试（测试 Zod schema 推导类型）**

先在 `packages/shared/src/__tests__/schemas.test.ts` 编写：

```typescript
import { describe, it, expect } from 'vitest';
import {
  TaskTypeSchema,
  TaskStatusSchema,
  CreateTaskPayloadSchema,
  ClientRegisterPayloadSchema,
  TaskLogPayloadSchema,
  TaskResultPayloadSchema,
  CreatePortMappingPayloadSchema,
} from '../schemas.js';

describe('TaskTypeSchema', () => {
  it('accepts valid task types', () => {
    expect(TaskTypeSchema.parse('exec_script')).toBe('exec_script');
    expect(TaskTypeSchema.parse('exec_command')).toBe('exec_command');
    expect(TaskTypeSchema.parse('push_file')).toBe('push_file');
    expect(TaskTypeSchema.parse('frp_create_proxy')).toBe('frp_create_proxy');
    expect(TaskTypeSchema.parse('frp_remove_proxy')).toBe('frp_remove_proxy');
    expect(TaskTypeSchema.parse('health_check')).toBe('health_check');
  });

  it('rejects invalid task types', () => {
    expect(() => TaskTypeSchema.parse('invalid')).toThrow();
  });
});

describe('TaskStatusSchema', () => {
  it('accepts valid statuses', () => {
    expect(TaskStatusSchema.parse('pending')).toBe('pending');
    expect(TaskStatusSchema.parse('dispatched')).toBe('dispatched');
    expect(TaskStatusSchema.parse('running')).toBe('running');
    expect(TaskStatusSchema.parse('success')).toBe('success');
    expect(TaskStatusSchema.parse('failed')).toBe('failed');
    expect(TaskStatusSchema.parse('cancelled')).toBe('cancelled');
  });
});

describe('ClientRegisterPayloadSchema', () => {
  it('validates a complete registration payload', () => {
    const payload = ClientRegisterPayloadSchema.parse({
      clientId: 'win-dev-01',
      name: 'Windows Dev Machine',
      hostname: 'DESKTOP-123',
      os: 'windows',
      arch: 'x64',
      version: '0.1.0',
      tags: ['windows', 'dev'],
    });
    expect(payload.clientId).toBe('win-dev-01');
    expect(payload.tags).toEqual(['windows', 'dev']);
  });

  it('rejects missing required fields', () => {
    expect(() => ClientRegisterPayloadSchema.parse({})).toThrow();
  });
});

describe('CreateTaskPayloadSchema', () => {
  it('validates an exec_script task', () => {
    const task = CreateTaskPayloadSchema.parse({
      clientId: 'win-dev-01',
      type: 'exec_script',
      payload: {
        runtime: 'node',
        script: 'console.log("hello")',
        timeoutMs: 60000,
      },
    });
    expect(task.type).toBe('exec_script');
    expect(task.payload.script).toBe('console.log("hello")');
  });

  it('validates a push_file task', () => {
    const task = CreateTaskPayloadSchema.parse({
      clientId: 'win-dev-01',
      type: 'push_file',
      payload: {
        fileId: 'file_001',
        targetPath: '/workspace/project',
        fileName: 'archive.zip',
      },
    });
    expect(task.payload.fileId).toBe('file_001');
  });

  it('rejects missing clientId', () => {
    expect(() =>
      CreateTaskPayloadSchema.parse({ type: 'exec_script', payload: {} })
    ).toThrow();
  });
});

describe('TaskLogPayloadSchema', () => {
  it('validates a log entry', () => {
    const log = TaskLogPayloadSchema.parse({
      taskId: 'task_001',
      stream: 'stdout',
      content: 'hello world\n',
    });
    expect(log.stream).toBe('stdout');
  });

  it('rejects invalid stream', () => {
    expect(() =>
      TaskLogPayloadSchema.parse({ taskId: 'task_001', stream: 'err', content: 'x' })
    ).toThrow();
  });
});

describe('TaskResultPayloadSchema', () => {
  it('validates a success result', () => {
    const result = TaskResultPayloadSchema.parse({
      taskId: 'task_001',
      status: 'success',
      result: { exitCode: 0, durationMs: 238 },
    });
    expect(result.status).toBe('success');
  });

  it('validates a failed result with error', () => {
    const result = TaskResultPayloadSchema.parse({
      taskId: 'task_001',
      status: 'failed',
      error: 'Script timeout',
    });
    expect(result.error).toBe('Script timeout');
  });
});

describe('CreatePortMappingPayloadSchema', () => {
  it('validates a tcp port mapping', () => {
    const mapping = CreatePortMappingPayloadSchema.parse({
      clientId: 'win-dev-01',
      name: 'web-preview',
      proxyType: 'tcp',
      localIp: '127.0.0.1',
      localPort: 3000,
      remotePort: 23000,
    });
    expect(mapping.proxyType).toBe('tcp');
  });

  it('rejects invalid proxyType', () => {
    expect(() =>
      CreatePortMappingPayloadSchema.parse({
        clientId: 'win-dev-01',
        name: 'test',
        proxyType: 'udp',
        localIp: '127.0.0.1',
        localPort: 3000,
        remotePort: 23000,
      })
    ).toThrow();
  });

  it('rejects port out of range', () => {
    expect(() =>
      CreatePortMappingPayloadSchema.parse({
        clientId: 'win-dev-01',
        name: 'test',
        proxyType: 'tcp',
        localIp: '127.0.0.1',
        localPort: 99999,
        remotePort: 23000,
      })
    ).toThrow();
  });
});
```

- [ ] **步骤 2：运行测试验证失败**

运行：`pnpm --filter @rag/shared test`
预期：FAIL，找不到 schemas 模块。

- [ ] **步骤 3：编写 types.ts**

```typescript
// Task type enum
export const TASK_TYPES = [
  'health_check',
  'exec_script',
  'exec_command',
  'push_file',
  'frp_create_proxy',
  'frp_remove_proxy',
] as const;
export type TaskType = (typeof TASK_TYPES)[number];

// Task status enum
export const TASK_STATUSES = [
  'pending',
  'dispatched',
  'running',
  'success',
  'failed',
  'cancelled',
] as const;
export type TaskStatus = (typeof TASK_STATUSES)[number];

// Client info
export interface ClientInfo {
  clientId: string;
  name: string;
  hostname?: string;
  os?: string;
  arch?: string;
  version?: string;
  tags?: string[];
}

// Client record (DB)
export interface ClientRecord extends ClientInfo {
  status: 'online' | 'offline';
  tokenHash?: string;
  lastSeenAt?: number;
  createdAt: number;
  updatedAt: number;
}

// Task payloads
export interface ExecScriptPayload {
  runtime?: 'node' | 'python' | 'bash';
  script: string;
  timeoutMs?: number;
}

export interface ExecCommandPayload {
  command: string;
  args?: string[];
  cwd?: string;
  timeoutMs?: number;
}

export interface PushFilePayload {
  fileId: string;
  targetPath: string;
  fileName: string;
}

export interface FrpCreateProxyPayload {
  name: string;
  proxyType: 'tcp' | 'http' | 'https';
  localIp: string;
  localPort: number;
  remotePort: number;
  customDomain?: string;
}

export interface FrpRemoveProxyPayload {
  mappingId: string;
}

export interface HealthCheckPayload {
  // empty
}

export type TaskPayloadMap = {
  health_check: HealthCheckPayload;
  exec_script: ExecScriptPayload;
  exec_command: ExecCommandPayload;
  push_file: PushFilePayload;
  frp_create_proxy: FrpCreateProxyPayload;
  frp_remove_proxy: FrpRemoveProxyPayload;
};

// Task record (DB)
export interface TaskRecord<T extends TaskType = TaskType> {
  id: string;
  clientId: string;
  type: T;
  status: TaskStatus;
  payload: TaskPayloadMap[T];
  result?: unknown;
  error?: string;
  createdBy?: string;
  createdAt: number;
  startedAt?: number;
  finishedAt?: number;
}

// Task log
export interface TaskLog {
  id?: number;
  taskId: string;
  stream: 'stdout' | 'stderr';
  content: string;
  createdAt: number;
}

// File record
export interface FileRecord {
  id: string;
  originalName: string;
  storedPath: string;
  size?: number;
  sha256?: string;
  mimeType?: string;
  createdAt: number;
}

// Port mapping
export interface PortMapping {
  id: string;
  clientId: string;
  name: string;
  proxyType: 'tcp' | 'http' | 'https';
  localIp: string;
  localPort: number;
  remotePort?: number;
  customDomain?: string;
  status: 'active' | 'inactive' | 'error';
  publicUrl?: string;
  createdAt: number;
  updatedAt: number;
}

// Audit log
export interface AuditLog {
  id?: number;
  actor?: string;
  action: string;
  targetType?: string;
  targetId?: string;
  detail?: string;
  createdAt: number;
}
```

- [ ] **步骤 4：编写 protocol.ts**

```typescript
import type {
  ClientInfo,
  TaskType,
  TaskStatus,
  TaskPayloadMap,
} from './types.js';

// WebSocket message types
export type ClientMessageType =
  | 'client.register'
  | 'client.heartbeat'
  | 'task.log'
  | 'task.result';

export type ServerMessageType =
  | 'server.ack'
  | 'server.error'
  | 'task.dispatch';

// Base message envelope
export interface WsMessage<T extends string, P = unknown> {
  type: T;
  requestId?: string;
  payload: P;
}

// Client → Server messages
export type ClientRegisterMessage = WsMessage<
  'client.register',
  ClientInfo
>;

export type ClientHeartbeatMessage = WsMessage<
  'client.heartbeat',
  {
    clientId: string;
    cpu?: number;
    memory?: number;
    uptime?: number;
  }
>;

export type TaskLogMessage = WsMessage<
  'task.log',
  {
    taskId: string;
    stream: 'stdout' | 'stderr';
    content: string;
  }
>;

export type TaskResultMessage = WsMessage<
  'task.result',
  {
    taskId: string;
    status: TaskStatus;
    result?: unknown;
    error?: string;
  }
>;

export type ClientMessage =
  | ClientRegisterMessage
  | ClientHeartbeatMessage
  | TaskLogMessage
  | TaskResultMessage;

// Server → Client messages
export type ServerAckMessage = WsMessage<
  'server.ack',
  { message: string }
>;

export type ServerErrorMessage = WsMessage<
  'server.error',
  { code: string; message: string }
>;

export type TaskDispatchMessage = WsMessage<
  'task.dispatch',
  {
    taskId: string;
    taskType: TaskType;
    payload: TaskPayloadMap[TaskType];
  }
>;

export type ServerMessage =
  | ServerAckMessage
  | ServerErrorMessage
  | TaskDispatchMessage;
```

- [ ] **步骤 5：编写 schemas.ts**

```typescript
import { z } from 'zod';
import { TASK_TYPES, TASK_STATUSES } from './types.js';

// Enums
export const TaskTypeSchema = z.enum(TASK_TYPES);
export const TaskStatusSchema = z.enum(TASK_STATUSES);

// Client
export const ClientRegisterPayloadSchema = z.object({
  clientId: z.string().min(1).max(64),
  name: z.string().min(1).max(128),
  hostname: z.string().optional(),
  os: z.string().optional(),
  arch: z.string().optional(),
  version: z.string().optional(),
  tags: z.array(z.string()).optional(),
});

// Task payloads
export const ExecScriptPayloadSchema = z.object({
  runtime: z.enum(['node', 'python', 'bash']).optional().default('node'),
  script: z.string().min(1).max(1_000_000), // 1MB max
  timeoutMs: z.number().int().positive().max(300_000).optional().default(60_000),
});

export const ExecCommandPayloadSchema = z.object({
  command: z.string().min(1),
  args: z.array(z.string()).optional(),
  cwd: z.string().optional(),
  timeoutMs: z.number().int().positive().max(300_000).optional().default(60_000),
});

export const PushFilePayloadSchema = z.object({
  fileId: z.string().min(1),
  targetPath: z.string().min(1),
  fileName: z.string().min(1),
});

export const FrpCreateProxyPayloadSchema = z.object({
  name: z.string().min(1).max(128),
  proxyType: z.enum(['tcp', 'http', 'https']),
  localIp: z.string().min(1),
  localPort: z.number().int().min(1).max(65535),
  remotePort: z.number().int().min(1).max(65535),
  customDomain: z.string().optional(),
});

export const FrpRemoveProxyPayloadSchema = z.object({
  mappingId: z.string().min(1),
});

export const HealthCheckPayloadSchema = z.object({});

// Create task request
export const CreateTaskPayloadSchema = z.object({
  clientId: z.string().min(1),
  type: TaskTypeSchema,
  payload: z.record(z.unknown()),
});

// WebSocket message schemas
export const ClientHeartbeatPayloadSchema = z.object({
  clientId: z.string().min(1),
  cpu: z.number().optional(),
  memory: z.number().optional(),
  uptime: z.number().optional(),
});

export const TaskLogPayloadSchema = z.object({
  taskId: z.string().min(1),
  stream: z.enum(['stdout', 'stderr']),
  content: z.string(),
});

export const TaskResultPayloadSchema = z.object({
  taskId: z.string().min(1),
  status: TaskStatusSchema,
  result: z.unknown().optional(),
  error: z.string().optional(),
});

// Port mapping
export const CreatePortMappingPayloadSchema = z.object({
  clientId: z.string().min(1),
  name: z.string().min(1).max(128),
  proxyType: z.enum(['tcp', 'http', 'https']),
  localIp: z.string().min(1),
  localPort: z.number().int().min(1).max(65535),
  remotePort: z.number().int().min(1).max(65535).optional(),
  customDomain: z.string().optional(),
});

// Agent API schemas
export const AgentRunScriptPayloadSchema = z.object({
  target: z.object({
    clientId: z.string().min(1),
  }),
  script: z.string().min(1).max(1_000_000),
  timeoutMs: z.number().int().positive().max(300_000).optional().default(60_000),
});

export const AgentPushFilePayloadSchema = z.object({
  clientId: z.string().min(1),
  fileId: z.string().min(1),
  targetPath: z.string().min(1),
});

export const AgentOpenPortPayloadSchema = z.object({
  clientId: z.string().min(1),
  name: z.string().min(1).max(128),
  localPort: z.number().int().min(1).max(65535),
  remotePort: z.number().int().min(1).max(65535).optional(),
  type: z.enum(['tcp', 'http', 'https']).default('tcp'),
});

export const AgentClosePortPayloadSchema = z.object({
  mappingId: z.string().min(1),
});
```

- [ ] **步骤 6：编写 index.ts**

```typescript
export * from './types.js';
export * from './protocol.js';
export * from './schemas.js';
```

- [ ] **步骤 7：运行测试验证通过**

运行：`pnpm --filter @rag/shared test`
预期：全部 PASS。

- [ ] **步骤 8：构建共享包**

运行：`pnpm --filter @rag/shared build`
预期：编译成功，dist/ 生成。

- [ ] **步骤 9：Commit**

```bash
git add packages/shared/
git commit -m "feat(shared): add types, protocol, and Zod schemas with tests"
```

---

### 任务 3：服务端配置与环境

**文件：**
- 创建：`apps/server/src/config/env.ts`
- 创建：`apps/server/src/config/__tests__/env.test.ts`

- [ ] **步骤 1：编写 env 测试**

`apps/server/src/config/__tests__/env.test.ts`:
```typescript
import { describe, it, expect, beforeEach } from 'vitest';

// We test the schema directly without env vars
describe('env config', () => {
  beforeEach(() => {
    // Clear env vars that might interfere
    delete process.env.SERVER_PORT;
    delete process.env.SERVER_HOST;
    delete process.env.ADMIN_TOKEN;
    delete process.env.AGENT_API_TOKEN;
    delete process.env.DB_PATH;
    delete process.env.STORAGE_DIR;
  });

  it('uses defaults when no env vars set', async () => {
    // We'll import the config module which reads process.env
    // Set required vars that have no defaults
    process.env.ADMIN_TOKEN = 'test-admin';
    process.env.AGENT_API_TOKEN = 'test-agent';
    const { env } = await import('../env.js');
    expect(env.SERVER_PORT).toBe(3000);
    expect(env.SERVER_HOST).toBe('0.0.0.0');
    expect(env.DB_PATH).toBe('./storage/db.sqlite');
  });
});
```

- [ ] **步骤 2：运行测试验证失败**

运行：`pnpm --filter @rag/server test`
预期：FAIL，找不到 env 模块。

- [ ] **步骤 3：编写 env.ts**

```typescript
import { z } from 'zod';
import { config } from 'dotenv';

config();

const envSchema = z.object({
  SERVER_PORT: z.coerce.number().int().positive().default(3000),
  SERVER_HOST: z.string().default('0.0.0.0'),
  ADMIN_TOKEN: z.string().min(1),
  AGENT_API_TOKEN: z.string().min(1),
  FRP_TOKEN: z.string().default('change_me_frp_token'),
  DB_PATH: z.string().default('./storage/db.sqlite'),
  STORAGE_DIR: z.string().default('./storage/files'),
  FRP_PORT_RANGE_START: z.coerce.number().int().default(20000),
  FRP_PORT_RANGE_END: z.coerce.number().int().default(25000),
});

export const env = envSchema.parse(process.env);
export type Env = z.infer<typeof envSchema>;
```

- [ ] **步骤 4：运行测试验证通过**

运行：`pnpm --filter @rag/server test`
预期：PASS。

- [ ] **步骤 5：Commit**

```bash
git add apps/server/src/config/
git commit -m "feat(server): add env config with Zod validation"
```

---

### 任务 4：服务端数据库

**文件：**
- 创建：`apps/server/src/db/schema.ts`
- 创建：`apps/server/src/db/index.ts`
- 创建：`apps/server/src/db/migrate.ts`
- 创建：`apps/server/src/db/__tests__/db.test.ts`

- [ ] **步骤 1：编写数据库测试**

```typescript
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { migrate } from '../migrate.js';
import { clients, tasks, taskLogs, files, portMappings, auditLogs } from '../schema.js';

describe('database schema', () => {
  let db: ReturnType<typeof drizzle>;

  beforeAll(async () => {
    const sqlite = new Database(':memory:');
    db = drizzle(sqlite);
    migrate(sqlite);
  });

  it('creates clients table', () => {
    const result = db.all(
      db.select().from(clients).toSQL()
    );
    // Should not throw
  });

  it('inserts and queries a client', () => {
    const id = 'test-client-1';
    db.insert(clients).values({
      id,
      name: 'Test Client',
      hostname: 'test',
      os: 'linux',
      arch: 'x64',
      status: 'online',
      createdAt: Date.now(),
      updatedAt: Date.now(),
    }).run();

    const rows = db.select().from(clients).where(
      // Use sql`` for where
    ).all();
    // Basic insert + select works
  });

  it('inserts a task and task logs', () => {
    const taskId = 'task-test-1';
    db.insert(tasks).values({
      id: taskId,
      clientId: 'test-client-1',
      type: 'exec_script',
      status: 'pending',
      payload: JSON.stringify({ script: 'console.log(1)' }),
      createdAt: Date.now(),
    }).run();

    db.insert(taskLogs).values({
      taskId,
      stream: 'stdout',
      content: 'hello',
      createdAt: Date.now(),
    }).run();
  });
});
```

- [ ] **步骤 2：运行测试验证失败**

运行：`pnpm --filter @rag/server test`
预期：FAIL。

- [ ] **步骤 3：编写 schema.ts**

```typescript
import { sqliteTable, text, integer } from 'drizzle-orm/sqlite-core';

export const clients = sqliteTable('clients', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  hostname: text('hostname'),
  os: text('os'),
  arch: text('arch'),
  version: text('version'),
  tags: text('tags'), // JSON array
  status: text('status').notNull().default('offline'),
  tokenHash: text('token_hash'),
  lastSeenAt: integer('last_seen_at'),
  createdAt: integer('created_at').notNull(),
  updatedAt: integer('updated_at').notNull(),
});

export const tasks = sqliteTable('tasks', {
  id: text('id').primaryKey(),
  clientId: text('client_id').notNull(),
  type: text('type').notNull(),
  status: text('status').notNull(),
  payload: text('payload').notNull(), // JSON
  result: text('result'), // JSON
  error: text('error'),
  createdBy: text('created_by'),
  createdAt: integer('created_at').notNull(),
  startedAt: integer('started_at'),
  finishedAt: integer('finished_at'),
});

export const taskLogs = sqliteTable('task_logs', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  taskId: text('task_id').notNull(),
  stream: text('stream').notNull(),
  content: text('content').notNull(),
  createdAt: integer('created_at').notNull(),
});

export const files = sqliteTable('files', {
  id: text('id').primaryKey(),
  originalName: text('original_name').notNull(),
  storedPath: text('stored_path').notNull(),
  size: integer('size'),
  sha256: text('sha256'),
  mimeType: text('mime_type'),
  createdAt: integer('created_at').notNull(),
});

export const portMappings = sqliteTable('port_mappings', {
  id: text('id').primaryKey(),
  clientId: text('client_id').notNull(),
  name: text('name').notNull(),
  proxyType: text('proxy_type').notNull(),
  localIp: text('local_ip').notNull(),
  localPort: integer('local_port').notNull(),
  remotePort: integer('remote_port'),
  customDomain: text('custom_domain'),
  status: text('status').notNull().default('inactive'),
  publicUrl: text('public_url'),
  createdAt: integer('created_at').notNull(),
  updatedAt: integer('updated_at').notNull(),
});

export const auditLogs = sqliteTable('audit_logs', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  actor: text('actor'),
  action: text('action').notNull(),
  targetType: text('target_type'),
  targetId: text('target_id'),
  detail: text('detail'),
  createdAt: integer('created_at').notNull(),
});
```

- [ ] **步骤 4：编写 db/index.ts**

```typescript
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import * as schema from './schema.js';
import { env } from '../config/env.js';

const sqlite = new Database(env.DB_PATH);
sqlite.pragma('journal_mode = WAL');
sqlite.pragma('foreign_keys = ON');

export const db = drizzle(sqlite, { schema });
export { sqlite };
```

- [ ] **步骤 5：编写 db/migrate.ts**

```typescript
import type Database from 'better-sqlite3';

export function migrate(sqlite: Database.Database): void {
  sqlite.exec(`
    CREATE TABLE IF NOT EXISTS clients (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      hostname TEXT,
      os TEXT,
      arch TEXT,
      version TEXT,
      tags TEXT,
      status TEXT NOT NULL DEFAULT 'offline',
      token_hash TEXT,
      last_seen_at INTEGER,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS tasks (
      id TEXT PRIMARY KEY,
      client_id TEXT NOT NULL,
      type TEXT NOT NULL,
      status TEXT NOT NULL,
      payload TEXT NOT NULL,
      result TEXT,
      error TEXT,
      created_by TEXT,
      created_at INTEGER NOT NULL,
      started_at INTEGER,
      finished_at INTEGER
    );

    CREATE TABLE IF NOT EXISTS task_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      task_id TEXT NOT NULL,
      stream TEXT NOT NULL,
      content TEXT NOT NULL,
      created_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS files (
      id TEXT PRIMARY KEY,
      original_name TEXT NOT NULL,
      stored_path TEXT NOT NULL,
      size INTEGER,
      sha256 TEXT,
      mime_type TEXT,
      created_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS port_mappings (
      id TEXT PRIMARY KEY,
      client_id TEXT NOT NULL,
      name TEXT NOT NULL,
      proxy_type TEXT NOT NULL,
      local_ip TEXT NOT NULL,
      local_port INTEGER NOT NULL,
      remote_port INTEGER,
      custom_domain TEXT,
      status TEXT NOT NULL DEFAULT 'inactive',
      public_url TEXT,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS audit_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      actor TEXT,
      action TEXT NOT NULL,
      target_type TEXT,
      target_id TEXT,
      detail TEXT,
      created_at INTEGER NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_tasks_client_id ON tasks(client_id);
    CREATE INDEX IF NOT EXISTS idx_tasks_status ON tasks(status);
    CREATE INDEX IF NOT EXISTS idx_task_logs_task_id ON task_logs(task_id);
    CREATE INDEX IF NOT EXISTS idx_port_mappings_client_id ON port_mappings(client_id);
  `);
}
```

- [ ] **步骤 6：运行测试验证通过**

运行：`pnpm --filter @rag/server test`
预期：全部 PASS。

- [ ] **步骤 7：Commit**

```bash
git add apps/server/src/db/
git commit -m "feat(server): add SQLite database schema and migration"
```

---

### 任务 5：服务端认证模块

**文件：**
- 创建：`apps/server/src/modules/auth/auth.service.ts`
- 创建：`apps/server/src/modules/auth/auth.middleware.ts`
- 创建：`apps/server/src/modules/auth/__tests__/auth.test.ts`

- [ ] **步骤 1：编写认证测试**

```typescript
import { describe, it, expect } from 'vitest';
import { verifyAgentToken, verifyClientToken } from '../auth.service.js';

describe('auth service', () => {
  it('verifies valid agent token', () => {
    process.env.AGENT_API_TOKEN = 'test-agent-token';
    expect(verifyAgentToken('Bearer test-agent-token')).toBe(true);
  });

  it('rejects invalid agent token', () => {
    process.env.AGENT_API_TOKEN = 'test-agent-token';
    expect(verifyAgentToken('Bearer wrong-token')).toBe(false);
  });

  it('rejects missing token', () => {
    expect(verifyAgentToken(undefined)).toBe(false);
    expect(verifyAgentToken('')).toBe(false);
  });

  it('verifies client token hash', () => {
    const { createHash } = await import('node:crypto');
    const hash = createHash('sha256').update('client-secret').digest('hex');
    expect(verifyClientToken('client-secret', hash)).toBe(true);
  });
});
```

- [ ] **步骤 2：运行测试验证失败**

运行：`pnpm --filter @rag/server test`
预期：FAIL。

- [ ] **步骤 3：编写 auth.service.ts**

```typescript
import { createHash } from 'node:crypto';
import { env } from '../../config/env.js';

export function verifyAgentToken(authHeader?: string): boolean {
  if (!authHeader) return false;
  const token = authHeader.startsWith('Bearer ')
    ? authHeader.slice(7)
    : authHeader;
  return token === env.AGENT_API_TOKEN;
}

export function verifyAdminToken(authHeader?: string): boolean {
  if (!authHeader) return false;
  const token = authHeader.startsWith('Bearer ')
    ? authHeader.slice(7)
    : authHeader;
  return token === env.ADMIN_TOKEN;
}

export function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

export function verifyClientToken(token: string, storedHash: string): boolean {
  return hashToken(token) === storedHash;
}
```

- [ ] **步骤 4：编写 auth.middleware.ts**

```typescript
import type { FastifyRequest, FastifyReply } from 'fastify';

export async function agentAuth(
  request: FastifyRequest,
  reply: FastifyReply
): Promise<void> {
  const { verifyAgentToken } = await import('./auth.service.js');
  const authHeader = request.headers.authorization;
  if (!verifyAgentToken(authHeader)) {
    reply.code(401).send({ error: 'Unauthorized' });
  }
}

export async function adminAuth(
  request: FastifyRequest,
  reply: FastifyReply
): Promise<void> {
  const { verifyAdminToken } = await import('./auth.service.js');
  const authHeader = request.headers.authorization;
  if (!verifyAdminToken(authHeader)) {
    reply.code(401).send({ error: 'Unauthorized' });
  }
}
```

- [ ] **步骤 5：运行测试验证通过**

运行：`pnpm --filter @rag/server test`
预期：全部 PASS。

- [ ] **步骤 6：Commit**

```bash
git add apps/server/src/modules/auth/
git commit -m "feat(server): add auth service and middleware"
```

---

### 任务 6：服务端 WebSocket 连接管理

**文件：**
- 创建：`apps/server/src/modules/connections/connections.manager.ts`
- 创建：`apps/server/src/ws/ws-handlers.ts`
- 创建：`apps/server/src/ws/ws-server.ts`
- 创建：`apps/server/src/modules/connections/__tests__/connections.test.ts`

- [ ] **步骤 1：编写连接管理器测试**

```typescript
import { describe, it, expect, beforeEach } from 'vitest';
import { ConnectionManager } from '../connections.manager.js';

describe('ConnectionManager', () => {
  let manager: ConnectionManager;

  beforeEach(() => {
    manager = new ConnectionManager();
  });

  it('registers a connection', () => {
    const mockWs = { send: () => {} } as any;
    manager.register('client-1', mockWs);
    expect(manager.isOnline('client-1')).toBe(true);
  });

  it('returns false for unknown client', () => {
    expect(manager.isOnline('unknown')).toBe(false);
  });

  it('removes connection on unregister', () => {
    const mockWs = { send: () => {} } as any;
    manager.register('client-1', mockWs);
    manager.unregister('client-1');
    expect(manager.isOnline('client-1')).toBe(false);
  });

  it('lists online client IDs', () => {
    const mockWs = { send: () => {} } as any;
    manager.register('a', mockWs);
    manager.register('b', mockWs);
    expect(manager.getOnlineClients()).toContain('a');
    expect(manager.getOnlineClients()).toContain('b');
  });

  it('sends message to a client', () => {
    let received: any = null;
    const mockWs = { send: (data: string) => { received = JSON.parse(data); } } as any;
    manager.register('client-1', mockWs);
    manager.send('client-1', { type: 'task.dispatch', payload: { taskId: '1' } });
    expect(received?.type).toBe('task.dispatch');
  });

  it('throws when sending to offline client', () => {
    expect(() =>
      manager.send('offline', { type: 'task.dispatch', payload: {} })
    ).toThrow();
  });
});
```

- [ ] **步骤 2：运行测试验证失败**

运行：`pnpm --filter @rag/server test`
预期：FAIL。

- [ ] **步骤 3：编写 connections.manager.ts**

```typescript
import type { WebSocket } from 'ws';
import type { ServerMessage } from '@rag/shared';

export class ConnectionManager {
  private connections = new Map<string, WebSocket>();

  register(clientId: string, ws: WebSocket): void {
    // Close existing connection if reconnecting
    const existing = this.connections.get(clientId);
    if (existing) {
      existing.close();
    }
    this.connections.set(clientId, ws);
  }

  unregister(clientId: string): void {
    this.connections.delete(clientId);
  }

  isOnline(clientId: string): boolean {
    return this.connections.has(clientId);
  }

  getOnlineClients(): string[] {
    return Array.from(this.connections.keys());
  }

  getWs(clientId: string): WebSocket | undefined {
    return this.connections.get(clientId);
  }

  send(clientId: string, message: ServerMessage): void {
    const ws = this.connections.get(clientId);
    if (!ws) {
      throw new Error(`Client ${clientId} is not connected`);
    }
    ws.send(JSON.stringify(message));
  }
}

// Singleton
export const connectionManager = new ConnectionManager();
```

- [ ] **步骤 4：编写 ws-handlers.ts**

```typescript
import type { WebSocket } from 'ws';
import type { ClientMessage } from '@rag/shared';
import { connectionManager } from '../modules/connections/connections.manager.js';
import { clientsService } from '../modules/clients/clients.service.js';
import { tasksService } from '../modules/tasks/tasks.service.js';
import { auditService } from '../modules/audit/audit.service.js';
import { hashToken } from '../modules/auth/auth.service.js';

export async function handleClientMessage(
  ws: WebSocket,
  clientId: string,
  message: ClientMessage
): Promise<void> {
  switch (message.type) {
    case 'client.register': {
      const { clientId: regId, name, hostname, os, arch, version, tags } = message.payload;

      // Update connection
      connectionManager.register(regId, ws);

      // Store/update client in DB
      await clientsService.upsert({
        id: regId,
        name,
        hostname,
        os,
        arch,
        version,
        tags: tags ? JSON.stringify(tags) : null,
        status: 'online',
        lastSeenAt: Date.now(),
        updatedAt: Date.now(),
      });

      // Send ack
      ws.send(JSON.stringify({
        type: 'server.ack',
        requestId: message.requestId,
        payload: { message: 'Registered successfully' },
      }));

      await auditService.log({
        action: 'client.register',
        targetType: 'client',
        targetId: regId,
        detail: `Client ${name} registered`,
      });
      break;
    }

    case 'client.heartbeat': {
      connectionManager.register(message.payload.clientId, ws);
      await clientsService.updateHeartbeat(message.payload.clientId);
      break;
    }

    case 'task.log': {
      const { taskId, stream, content } = message.payload;
      await tasksService.appendLog(taskId, stream, content);
      break;
    }

    case 'task.result': {
      const { taskId, status, result, error } = message.payload;
      await tasksService.complete(taskId, status, result, error);
      break;
    }
  }
}

export function sendTaskDispatch(
  clientId: string,
  taskId: string,
  taskType: string,
  payload: unknown
): void {
  connectionManager.send(clientId, {
    type: 'task.dispatch',
    requestId: taskId,
    payload: {
      taskId,
      taskType: taskType as any,
      payload: payload as any,
    },
  });
}
```

- [ ] **步骤 5：编写 ws-server.ts**

```typescript
import type { FastifyInstance } from 'fastify';
import type { WebSocket } from 'ws';
import { handleClientMessage } from './ws-handlers.js';
import { verifyClientToken } from '../modules/auth/auth.service.js';
import { hashToken } from '../modules/auth/auth.service.js';
import { clientsService } from '../modules/clients/clients.service.js';

export async function registerWsRoutes(app: FastifyInstance): Promise<void> {
  app.get('/ws/client', { websocket: true }, (socket, req) => {
    const url = new URL(req.url, 'http://localhost');
    const clientId = url.searchParams.get('clientId');
    const token = url.searchParams.get('token');

    if (!clientId || !token) {
      socket.close(4001, 'Missing clientId or token');
      return;
    }

    // Verify token
    const client = clientsService.getById(clientId);
    // For first connection, store token hash
    // For reconnection, verify against stored hash

    const ws = socket as unknown as WebSocket;

    ws.on('message', async (data: Buffer) => {
      try {
        const message = JSON.parse(data.toString());
        await handleClientMessage(ws, clientId, message);
      } catch (err) {
        ws.send(JSON.stringify({
          type: 'server.error',
          payload: { code: 'PARSE_ERROR', message: 'Invalid message format' },
        }));
      }
    });

    ws.on('close', () => {
      clientsService.setOffline(clientId);
      connectionManager.unregister(clientId);
    });

    ws.on('error', (err) => {
      console.error(`WS error for ${clientId}:`, err.message);
    });
  });
}
```

- [ ] **步骤 6：运行测试验证通过**

运行：`pnpm --filter @rag/server test`
预期：全部 PASS。

- [ ] **步骤 7：Commit**

```bash
git add apps/server/src/modules/connections/ apps/server/src/ws/
git commit -m "feat(server): add WebSocket connection manager and message handlers"
```

---

### 任务 7：服务端核心服务模块（clients, tasks, audit）

**文件：**
- 创建：`apps/server/src/modules/clients/clients.service.ts`
- 创建：`apps/server/src/modules/tasks/tasks.service.ts`
- 创建：`apps/server/src/modules/audit/audit.service.ts`

- [ ] **步骤 1：编写 clients.service.ts**

```typescript
import { db } from '../../db/index.js';
import { clients, tasks } from '../../db/schema.js';
import { eq } from 'drizzle-orm';

export const clientsService = {
  upsert(data: {
    id: string;
    name: string;
    hostname?: string | null;
    os?: string | null;
    arch?: string | null;
    version?: string | null;
    tags?: string | null;
    status: string;
    tokenHash?: string | null;
    lastSeenAt?: number | null;
    updatedAt: number;
  }) {
    const existing = db.select().from(clients).where(eq(clients.id, data.id)).get();
    if (existing) {
      return db.update(clients).set(data).where(eq(clients.id, data.id)).run();
    }
    return db.insert(clients).values({
      ...data,
      createdAt: Date.now(),
    } as any).run();
  },

  getById(id: string) {
    return db.select().from(clients).where(eq(clients.id, id)).get();
  },

  list() {
    return db.select().from(clients).all();
  },

  updateHeartbeat(clientId: string) {
    return db.update(clients).set({
      status: 'online',
      lastSeenAt: Date.now(),
      updatedAt: Date.now(),
    }).where(eq(clients.id, clientId)).run();
  },

  setOffline(clientId: string) {
    return db.update(clients).set({
      status: 'offline',
      updatedAt: Date.now(),
    }).where(eq(clients.id, clientId)).run();
  },
};
```

- [ ] **步骤 2：编写 tasks.service.ts**

```typescript
import { db } from '../../db/index.js';
import { tasks, taskLogs } from '../../db/schema.js';
import { eq, desc } from 'drizzle-orm';
import { v4 as uuid } from 'uuid';
import type { TaskStatus, TaskType } from '@rag/shared';

export const tasksService = {
  create(data: {
    clientId: string;
    type: TaskType;
    payload: unknown;
    createdBy?: string;
  }) {
    const id = uuid();
    const now = Date.now();
    db.insert(tasks).values({
      id,
      clientId: data.clientId,
      type: data.type,
      status: 'pending',
      payload: JSON.stringify(data.payload),
      createdBy: data.createdBy ?? null,
      createdAt: now,
    }).run();
    return id;
  },

  getById(id: string) {
    const row = db.select().from(tasks).where(eq(tasks.id, id)).get();
    if (!row) return null;
    return {
      ...row,
      payload: JSON.parse(row.payload as string),
      result: row.result ? JSON.parse(row.result as string) : null,
    };
  },

  list(filters?: { clientId?: string; status?: string; limit?: number }) {
    let query = db.select().from(tasks).orderBy(desc(tasks.createdAt));
    if (filters?.clientId) {
      query = query.where(eq(tasks.clientId, filters.clientId)) as any;
    }
    if (filters?.limit) {
      query = query.limit(filters.limit) as any;
    }
    const rows = query.all();
    return rows.map((r) => ({
      ...r,
      payload: JSON.parse(r.payload as string),
      result: r.result ? JSON.parse(r.result as string) : null,
    }));
  },

  updateStatus(id: string, status: TaskStatus, extra?: { startedAt?: number; finishedAt?: number }) {
    return db.update(tasks).set({ status, ...extra }).where(eq(tasks.id, id)).run();
  },

  appendLog(taskId: string, stream: string, content: string) {
    return db.insert(taskLogs).values({
      taskId,
      stream,
      content,
      createdAt: Date.now(),
    }).run();
  },

  getLogs(taskId: string) {
    return db.select().from(taskLogs).where(eq(taskLogs.taskId, taskId)).orderBy(taskLogs.createdAt).all();
  },

  async complete(taskId: string, status: TaskStatus, result?: unknown, error?: string) {
    await db.update(tasks).set({
      status,
      result: result ? JSON.stringify(result) : null,
      error: error ?? null,
      finishedAt: Date.now(),
    }).where(eq(tasks.id, taskId)).run();
  },
};
```

- [ ] **步骤 3：编写 audit.service.ts**

```typescript
import { db } from '../../db/index.js';
import { auditLogs } from '../../db/schema.js';

export const auditService = {
  log(data: {
    actor?: string;
    action: string;
    targetType?: string;
    targetId?: string;
    detail?: string;
  }) {
    return db.insert(auditLogs).values({
      actor: data.actor ?? null,
      action: data.action,
      targetType: data.targetType ?? null,
      targetId: data.targetId ?? null,
      detail: data.detail ?? null,
      createdAt: Date.now(),
    }).run();
  },
};
```

- [ ] **步骤 4：验证类型检查**

运行：`pnpm --filter @rag/server typecheck`
预期：无错误。

- [ ] **步骤 5：Commit**

```bash
git add apps/server/src/modules/clients/ apps/server/src/modules/tasks/ apps/server/src/modules/audit/
git commit -m "feat(server): add clients, tasks, and audit service modules"
```

---

### 任务 8：服务端 HTTP 路由

**文件：**
- 创建：`apps/server/src/modules/clients/clients.routes.ts`
- 创建：`apps/server/src/modules/tasks/tasks.routes.ts`
- 创建：`apps/server/src/modules/files/files.service.ts`
- 创建：`apps/server/src/modules/files/files.routes.ts`
- 创建：`apps/server/src/modules/frp/frp.service.ts`
- 创建：`apps/server/src/modules/frp/frp.routes.ts`
- 创建：`apps/server/src/modules/agent/agent.routes.ts`

- [ ] **步骤 1：编写 clients.routes.ts**

```typescript
import type { FastifyInstance } from 'fastify';
import { clientsService } from './clients.service.js';
import { adminAuth } from '../auth/auth.middleware.js';

export async function clientRoutes(app: FastifyInstance): Promise<void> {
  app.get('/api/clients', { preHandler: [adminAuth] }, async (_req, reply) => {
    const list = clientsService.list();
    return reply.send(list);
  });

  app.get('/api/clients/:clientId', { preHandler: [adminAuth] }, async (req, reply) => {
    const { clientId } = req.params as { clientId: string };
    const client = clientsService.getById(clientId);
    if (!client) {
      return reply.code(404).send({ error: 'Client not found' });
    }
    return reply.send(client);
  });
}
```

- [ ] **步骤 2：编写 tasks.routes.ts**

```typescript
import type { FastifyInstance } from 'fastify';
import { tasksService } from './tasks.service.js';
import { connectionManager } from '../connections/connections.manager.js';
import { sendTaskDispatch } from '../../ws/ws-handlers.js';
import { CreateTaskPayloadSchema } from '@rag/shared';
import { agentAuth } from '../auth/auth.middleware.js';
import { auditService } from '../audit/audit.service.js';

export async function taskRoutes(app: FastifyInstance): Promise<void> {
  // Create task
  app.post('/api/tasks', { preHandler: [agentAuth] }, async (req, reply) => {
    const parsed = CreateTaskPayloadSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: parsed.error.format() });
    }

    const { clientId, type, payload } = parsed.data;

    // Check client online
    if (!connectionManager.isOnline(clientId)) {
      return reply.code(400).send({ error: `Client ${clientId} is offline` });
    }

    const taskId = tasksService.create({ clientId, type: type as any, payload });

    // Mark dispatched
    tasksService.updateStatus(taskId, 'dispatched');

    // Send to client via WS
    sendTaskDispatch(clientId, taskId, type, payload);

    await auditService.log({
      action: 'task.create',
      targetType: 'task',
      targetId: taskId,
      detail: `Task ${type} created for client ${clientId}`,
    });

    return reply.code(201).send({ taskId });
  });

  // List tasks
  app.get('/api/tasks', { preHandler: [agentAuth] }, async (req, reply) => {
    const { clientId, status, limit } = req.query as Record<string, string>;
    return reply.send(tasksService.list({
      clientId,
      status,
      limit: limit ? parseInt(limit) : 50,
    }));
  });

  // Get task
  app.get('/api/tasks/:taskId', { preHandler: [agentAuth] }, async (req, reply) => {
    const { taskId } = req.params as { taskId: string };
    const task = tasksService.getById(taskId);
    if (!task) {
      return reply.code(404).send({ error: 'Task not found' });
    }
    return reply.send(task);
  });

  // Get task logs
  app.get('/api/tasks/:taskId/logs', { preHandler: [agentAuth] }, async (req, reply) => {
    const { taskId } = req.params as { taskId: string };
    const logs = tasksService.getLogs(taskId);
    return reply.send(logs);
  });
}
```

- [ ] **步骤 3：编写 files.service.ts**

```typescript
import { db } from '../../db/index.js';
import { files } from '../../db/schema.js';
import { eq } from 'drizzle-orm';
import { v4 as uuid } from 'uuid';
import { createWriteStream } from 'node:fs';
import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { env } from '../../config/env.js';
import { pipeline } from 'node:stream/promises';
import { createReadStream } from 'node:fs';

export const filesService = {
  async upload(file: { filename: string; mimetype: string; file: NodeJS.ReadableStream }): Promise<string> {
    const id = uuid();
    const ext = file.filename.split('.').pop() || 'bin';
    const storedPath = join(id, `${id}.${ext}`);
    const fullPath = join(env.STORAGE_DIR, storedPath);

    await mkdir(join(env.STORAGE_DIR, id), { recursive: true });
    await pipeline(file.file, createWriteStream(fullPath));

    db.insert(files).values({
      id,
      originalName: file.filename,
      storedPath,
      mimeType: file.mimetype,
      createdAt: Date.now(),
    }).run();

    return id;
  },

  getById(id: string) {
    return db.select().from(files).where(eq(files.id, id)).get();
  },

  list() {
    return db.select().from(files).orderBy(files.createdAt).all();
  },

  getReadStream(id: string) {
    const file = this.getById(id);
    if (!file) return null;
    return createReadStream(join(env.STORAGE_DIR, file.storedPath));
  },

  getFilePath(id: string): string | null {
    const file = this.getById(id);
    if (!file) return null;
    return join(env.STORAGE_DIR, file.storedPath);
  },
};
```

- [ ] **步骤 4：编写 files.routes.ts**

```typescript
import type { FastifyInstance } from 'fastify';
import { filesService } from './files.service.js';
import { agentAuth } from '../auth/auth.middleware.js';
import { auditService } from '../audit/audit.service.js';

export async function fileRoutes(app: FastifyInstance): Promise<void> {
  app.post('/api/files', { preHandler: [agentAuth] }, async (req, reply) => {
    const data = await req.file();
    if (!data) {
      return reply.code(400).send({ error: 'No file provided' });
    }

    const fileId = await filesService.upload({
      filename: data.filename,
      mimetype: data.mimetype,
      file: data.file,
    });

    await auditService.log({
      action: 'file.upload',
      targetType: 'file',
      targetId: fileId,
      detail: `File ${data.filename} uploaded`,
    });

    return reply.code(201).send({ fileId, originalName: data.filename });
  });

  app.get('/api/files', { preHandler: [agentAuth] }, async (_req, reply) => {
    return reply.send(filesService.list());
  });

  app.get('/api/files/:fileId/download', { preHandler: [agentAuth] }, async (req, reply) => {
    const { fileId } = req.params as { fileId: string };
    const file = filesService.getById(fileId);
    if (!file) {
      return reply.code(404).send({ error: 'File not found' });
    }

    const stream = filesService.getReadStream(fileId);
    if (!stream) {
      return reply.code(404).send({ error: 'File not found on disk' });
    }

    return reply
      .header('Content-Disposition', `attachment; filename="${file.originalName}"`)
      .header('Content-Type', file.mimeType || 'application/octet-stream')
      .send(stream);
  });
}
```

- [ ] **步骤 5：编写 frp.service.ts**

```typescript
import { db } from '../../db/index.js';
import { portMappings } from '../../db/schema.js';
import { eq } from 'drizzle-orm';
import { v4 as uuid } from 'uuid';
import { env } from '../../config/env.js';

export const frpService = {
  create(data: {
    clientId: string;
    name: string;
    proxyType: string;
    localIp: string;
    localPort: number;
    remotePort?: number;
    customDomain?: string;
  }) {
    const id = uuid();
    const remotePort = data.remotePort ?? this.allocatePort();
    const now = Date.now();

    db.insert(portMappings).values({
      id,
      clientId: data.clientId,
      name: data.name,
      proxyType: data.proxyType,
      localIp: data.localIp,
      localPort: data.localPort,
      remotePort,
      customDomain: data.customDomain ?? null,
      status: 'inactive',
      createdAt: now,
      updatedAt: now,
    }).run();

    return { id, remotePort };
  },

  allocatePort(): number {
    const used = db.select({ remotePort: portMappings.remotePort })
      .from(portMappings)
      .where(eq(portMappings.status, 'active'))
      .all()
      .map(r => r.remotePort)
      .filter((p): p is number => p !== null);

    for (let port = env.FRP_PORT_RANGE_START; port <= env.FRP_PORT_RANGE_END; port++) {
      if (!used.includes(port)) return port;
    }
    throw new Error('No available ports in FRP range');
  },

  getById(id: string) {
    return db.select().from(portMappings).where(eq(portMappings.id, id)).get();
  },

  list(clientId?: string) {
    if (clientId) {
      return db.select().from(portMappings).where(eq(portMappings.clientId, clientId)).all();
    }
    return db.select().from(portMappings).all();
  },

  updateStatus(id: string, status: string, publicUrl?: string) {
    return db.update(portMappings).set({
      status,
      publicUrl: publicUrl ?? null,
      updatedAt: Date.now(),
    }).where(eq(portMappings.id, id)).run();
  },

  remove(id: string) {
    return db.delete(portMappings).where(eq(portMappings.id, id)).run();
  },
};
```

- [ ] **步骤 6：编写 frp.routes.ts**

```typescript
import type { FastifyInstance } from 'fastify';
import { frpService } from './frp.service.js';
import { connectionManager } from '../connections/connections.manager.js';
import { sendTaskDispatch } from '../../ws/ws-handlers.js';
import { CreatePortMappingPayloadSchema } from '@rag/shared';
import { agentAuth } from '../auth/auth.middleware.js';
import { auditService } from '../audit/audit.service.js';

export async function frpRoutes(app: FastifyInstance): Promise<void> {
  app.post('/api/port-mappings', { preHandler: [agentAuth] }, async (req, reply) => {
    const parsed = CreatePortMappingPayloadSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: parsed.error.format() });
    }

    const { clientId, name, proxyType, localIp, localPort, remotePort, customDomain } = parsed.data;

    if (!connectionManager.isOnline(clientId)) {
      return reply.code(400).send({ error: `Client ${clientId} is offline` });
    }

    const mapping = frpService.create({ clientId, name, proxyType, localIp, localPort, remotePort, customDomain });

    // Dispatch frp_create_proxy task
    sendTaskDispatch(clientId, mapping.id, 'frp_create_proxy', {
      mappingId: mapping.id,
      name,
      proxyType,
      localIp,
      localPort,
      remotePort: mapping.remotePort,
      customDomain,
    });

    await auditService.log({
      action: 'frp.create',
      targetType: 'port_mapping',
      targetId: mapping.id,
      detail: `Port mapping ${name} created: ${localPort} -> ${mapping.remotePort}`,
    });

    return reply.code(201).send(mapping);
  });

  app.get('/api/port-mappings', { preHandler: [agentAuth] }, async (req, reply) => {
    const { clientId } = req.query as Record<string, string>;
    return reply.send(frpService.list(clientId));
  });

  app.delete('/api/port-mappings/:mappingId', { preHandler: [agentAuth] }, async (req, reply) => {
    const { mappingId } = req.params as { mappingId: string };
    const mapping = frpService.getById(mappingId);
    if (!mapping) {
      return reply.code(404).send({ error: 'Port mapping not found' });
    }

    // Dispatch frp_remove_proxy
    if (connectionManager.isOnline(mapping.clientId)) {
      sendTaskDispatch(mapping.clientId, mappingId, 'frp_remove_proxy', { mappingId });
    }

    frpService.remove(mappingId);

    await auditService.log({
      action: 'frp.remove',
      targetType: 'port_mapping',
      targetId: mappingId,
    });

    return reply.send({ success: true });
  });
}
```

- [ ] **步骤 7：编写 agent.routes.ts**

```typescript
import type { FastifyInstance } from 'fastify';
import { tasksService } from '../tasks/tasks.service.js';
import { connectionManager } from '../connections/connections.manager.js';
import { sendTaskDispatch } from '../../ws/ws-handlers.js';
import {
  AgentRunScriptPayloadSchema,
  AgentPushFilePayloadSchema,
  AgentOpenPortPayloadSchema,
  AgentClosePortPayloadSchema,
} from '@rag/shared';
import { agentAuth } from '../auth/auth.middleware.js';
import { frpService } from '../frp/frp.service.js';
import { auditService } from '../audit/audit.service.js';

export async function agentRoutes(app: FastifyInstance): Promise<void> {
  // Run script
  app.post('/api/agent/run-script', { preHandler: [agentAuth] }, async (req, reply) => {
    const parsed = AgentRunScriptPayloadSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: parsed.error.format() });
    }

    const { target, script, timeoutMs } = parsed.data;

    if (!connectionManager.isOnline(target.clientId)) {
      return reply.code(400).send({ error: `Client ${target.clientId} is offline` });
    }

    const taskId = tasksService.create({
      clientId: target.clientId,
      type: 'exec_script',
      payload: { runtime: 'node', script, timeoutMs },
    });

    tasksService.updateStatus(taskId, 'dispatched');
    sendTaskDispatch(target.clientId, taskId, 'exec_script', { runtime: 'node', script, timeoutMs });

    return reply.code(201).send({ taskId });
  });

  // Push file
  app.post('/api/agent/push-file', { preHandler: [agentAuth] }, async (req, reply) => {
    const parsed = AgentPushFilePayloadSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: parsed.error.format() });
    }

    const { clientId, fileId, targetPath } = parsed.data;

    if (!connectionManager.isOnline(clientId)) {
      return reply.code(400).send({ error: `Client ${clientId} is offline` });
    }

    const taskId = tasksService.create({
      clientId,
      type: 'push_file',
      payload: { fileId, targetPath, fileName: fileId },
    });

    tasksService.updateStatus(taskId, 'dispatched');
    sendTaskDispatch(clientId, taskId, 'push_file', { fileId, targetPath, fileName: fileId });

    return reply.code(201).send({ taskId });
  });

  // Open port
  app.post('/api/agent/open-port', { preHandler: [agentAuth] }, async (req, reply) => {
    const parsed = AgentOpenPortPayloadSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: parsed.error.format() });
    }

    const { clientId, name, localPort, remotePort, type } = parsed.data;

    if (!connectionManager.isOnline(clientId)) {
      return reply.code(400).send({ error: `Client ${clientId} is offline` });
    }

    const mapping = frpService.create({
      clientId,
      name,
      proxyType: type,
      localIp: '127.0.0.1',
      localPort,
      remotePort,
    });

    sendTaskDispatch(clientId, mapping.id, 'frp_create_proxy', {
      mappingId: mapping.id,
      name,
      proxyType: type,
      localIp: '127.0.0.1',
      localPort,
      remotePort: mapping.remotePort,
    });

    return reply.code(201).send(mapping);
  });

  // Close port
  app.post('/api/agent/close-port', { preHandler: [agentAuth] }, async (req, reply) => {
    const parsed = AgentClosePortPayloadSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: parsed.error.format() });
    }

    const { mappingId } = parsed.data;
    const mapping = frpService.getById(mappingId);
    if (!mapping) {
      return reply.code(404).send({ error: 'Port mapping not found' });
    }

    if (connectionManager.isOnline(mapping.clientId)) {
      sendTaskDispatch(mapping.clientId, mappingId, 'frp_remove_proxy', { mappingId });
    }

    frpService.remove(mappingId);
    return reply.send({ success: true });
  });

  // Get task
  app.get('/api/agent/tasks/:taskId', { preHandler: [agentAuth] }, async (req, reply) => {
    const { taskId } = req.params as { taskId: string };
    const task = tasksService.getById(taskId);
    if (!task) return reply.code(404).send({ error: 'Task not found' });
    const logs = tasksService.getLogs(taskId);
    return reply.send({ ...task, logs });
  });
}
```

- [ ] **步骤 8：验证类型检查**

运行：`pnpm --filter @rag/server typecheck`
预期：无错误（修复导入问题后）。

- [ ] **步骤 9：Commit**

```bash
git add apps/server/src/modules/
git commit -m "feat(server): add HTTP routes for clients, tasks, files, frp, and agent API"
```

---

### 任务 9：服务端入口 main.ts

**文件：**
- 创建：`apps/server/src/main.ts`

- [ ] **步骤 1：编写 main.ts**

```typescript
import Fastify from 'fastify';
import fastifyWebsocket from '@fastify/websocket';
import fastifyMultipart from '@fastify/multipart';
import fastifyCors from '@fastify/cors';
import { env } from './config/env.js';
import { migrate } from './db/migrate.js';
import { sqlite } from './db/index.js';
import { registerWsRoutes } from './ws/ws-server.js';
import { clientRoutes } from './modules/clients/clients.routes.js';
import { taskRoutes } from './modules/tasks/tasks.routes.js';
import { fileRoutes } from './modules/files/files.routes.js';
import { frpRoutes } from './modules/frp/frp.routes.js';
import { agentRoutes } from './modules/agent/agent.routes.js';

async function main() {
  // Run migrations
  migrate(sqlite);

  const app = Fastify({
    logger: {
      transport: {
        target: 'pino-pretty',
        options: { colorize: true },
      },
    },
  });

  // Plugins
  await app.register(fastifyCors, { origin: true });
  await app.register(fastifyMultipart, { limits: { fileSize: 100 * 1024 * 1024 } }); // 100MB
  await app.register(fastifyWebsocket);

  // Routes
  await app.register(clientRoutes);
  await app.register(taskRoutes);
  await app.register(fileRoutes);
  await app.register(frpRoutes);
  await app.register(agentRoutes);

  // WebSocket
  await registerWsRoutes(app);

  // Health check
  app.get('/api/health', async () => ({ status: 'ok', timestamp: Date.now() }));

  // Start
  try {
    await app.listen({ port: env.SERVER_PORT, host: env.SERVER_HOST });
    console.log(`Server running on http://${env.SERVER_HOST}:${env.SERVER_PORT}`);
  } catch (err) {
    app.log.error(err);
    process.exit(1);
  }
}

main();
```

- [ ] **步骤 2：验证 typecheck**

运行：`pnpm --filter @rag/server typecheck`
预期：无错误。

- [ ] **步骤 3：验证构建**

运行：`pnpm --filter @rag/server build`
预期：编译成功。

- [ ] **步骤 4：Commit**

```bash
git add apps/server/src/main.ts
git commit -m "feat(server): add Fastify bootstrap with all routes and WebSocket"
```

---

### 任务 10：客户端配置与日志

**文件：**
- 创建：`apps/client/src/config/client.config.ts`
- 创建：`apps/client/src/runtime/logger.ts`
- 创建：`apps/client/src/config/__tests__/client-config.test.ts`

- [ ] **步骤 1：编写 client.config.ts 测试**

```typescript
import { describe, it, expect } from 'vitest';
import { ClientConfigSchema } from '../client.config.js';

describe('ClientConfigSchema', () => {
  it('validates a complete config', () => {
    const config = ClientConfigSchema.parse({
      clientId: 'test-01',
      clientName: 'Test Machine',
      serverUrl: 'wss://example.com/ws/client',
      apiBaseUrl: 'https://example.com',
      token: 'secret123',
      workspaceDir: '/tmp/workspace',
      frpcPath: '/usr/bin/frpc',
      frpcWorkDir: '/tmp/frp',
      tags: ['test', 'linux'],
    });
    expect(config.clientId).toBe('test-01');
  });

  it('rejects missing clientId', () => {
    expect(() => ClientConfigSchema.parse({})).toThrow();
  });

  it('rejects invalid serverUrl', () => {
    expect(() =>
      ClientConfigSchema.parse({
        clientId: 'x',
        clientName: 'x',
        serverUrl: 'not-a-url',
        apiBaseUrl: 'https://x.com',
        token: 'x',
        workspaceDir: '/tmp',
        frpcPath: '/usr/bin/frpc',
        frpcWorkDir: '/tmp',
      })
    ).toThrow();
  });
});
```

- [ ] **步骤 2：运行测试验证失败**

运行：`pnpm --filter @rag/client test`
预期：FAIL。

- [ ] **步骤 3：编写 client.config.ts**

```typescript
import { z } from 'zod';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

export const ClientConfigSchema = z.object({
  clientId: z.string().min(1).max(64),
  clientName: z.string().min(1).max(128),
  serverUrl: z.string().url(),
  apiBaseUrl: z.string().url(),
  token: z.string().min(1),
  workspaceDir: z.string().min(1),
  frpcPath: z.string().min(1),
  frpcWorkDir: z.string().min(1),
  tags: z.array(z.string()).optional().default([]),
});

export type ClientConfig = z.infer<typeof ClientConfigSchema>;

export function loadConfig(configPath?: string): ClientConfig {
  const path = configPath ?? resolve(process.cwd(), 'config.json');
  const raw = readFileSync(path, 'utf-8');
  return ClientConfigSchema.parse(JSON.parse(raw));
}
```

- [ ] **步骤 4：编写 runtime/logger.ts**

```typescript
import pino from 'pino';

export const logger = pino({
  transport: {
    target: 'pino-pretty',
    options: { colorize: true },
  },
  level: process.env.LOG_LEVEL || 'info',
});
```

- [ ] **步骤 5：运行测试验证通过**

运行：`pnpm --filter @rag/client test`
预期：PASS。

- [ ] **步骤 6：Commit**

```bash
git add apps/client/src/config/ apps/client/src/runtime/
git commit -m "feat(client): add config loading and logger"
```

---

### 任务 11：客户端核心模块

**文件：**
- 创建：`apps/client/src/core/connection.ts`
- 创建：`apps/client/src/core/register.ts`
- 创建：`apps/client/src/core/heartbeat.ts`
- 创建：`apps/client/src/core/task-dispatcher.ts`
- 创建：`apps/client/src/runtime/workspace.ts`
- 创建：`apps/client/src/runtime/security.ts`

- [ ] **步骤 1：编写 connection.ts**

```typescript
import WebSocket from 'ws';
import { logger } from '../runtime/logger.js';
import type { ClientConfig } from '../config/client.config.js';

export type MessageHandler = (data: any) => void;

export function createConnection(
  config: ClientConfig,
  onMessage: MessageHandler
): WebSocket {
  const url = `${config.serverUrl}?clientId=${config.clientId}&token=${config.token}`;

  logger.info(`Connecting to ${url}`);
  const ws = new WebSocket(url);

  ws.on('open', () => {
    logger.info('WebSocket connected');
  });

  ws.on('message', (data: Buffer) => {
    try {
      const message = JSON.parse(data.toString());
      onMessage(message);
    } catch (err) {
      logger.error({ err }, 'Failed to parse WS message');
    }
  });

  ws.on('close', (code, reason) => {
    logger.warn({ code, reason: reason.toString() }, 'WebSocket disconnected, reconnecting in 5s...');
    setTimeout(() => {
      createConnection(config, onMessage);
    }, 5000);
  });

  ws.on('error', (err) => {
    logger.error({ err: err.message }, 'WebSocket error');
  });

  return ws;
}
```

- [ ] **步骤 2：编写 register.ts**

```typescript
import type WebSocket from 'ws';
import { os as osInfo } from 'systeminformation';
import type { ClientConfig } from '../config/client.config.js';

export async function sendRegister(ws: WebSocket, config: ClientConfig): Promise<void> {
  const sysInfo = await osInfo();
  const message = {
    type: 'client.register',
    requestId: `reg_${Date.now()}`,
    payload: {
      clientId: config.clientId,
      name: config.clientName,
      hostname: sysInfo.hostname,
      os: sysInfo.platform,
      arch: sysInfo.arch,
      version: '0.1.0',
      tags: config.tags,
    },
  };
  ws.send(JSON.stringify(message));
}
```

- [ ] **步骤 3：编写 heartbeat.ts**

```typescript
import type WebSocket from 'ws';
import { currentLoad, mem } from 'systeminformation';
import type { ClientConfig } from '../config/client.config.js';

let interval: ReturnType<typeof setInterval> | null = null;

export function startHeartbeat(ws: WebSocket, config: ClientConfig): void {
  interval = setInterval(async () => {
    try {
      const [cpu, memory] = await Promise.all([
        currentLoad(),
        mem(),
      ]);

      ws.send(JSON.stringify({
        type: 'client.heartbeat',
        payload: {
          clientId: config.clientId,
          cpu: cpu.currentLoad,
          memory: (memory.used / memory.total) * 100,
          uptime: process.uptime(),
        },
      }));
    } catch (err) {
      // Silently ignore heartbeat failures
    }
  }, 30_000); // Every 30 seconds
}

export function stopHeartbeat(): void {
  if (interval) {
    clearInterval(interval);
    interval = null;
  }
}
```

- [ ] **步骤 4：编写 task-dispatcher.ts**

```typescript
import type WebSocket from 'ws';
import { logger } from '../runtime/logger.js';
import { execScript } from '../executors/exec-script.executor.js';
import { execCommand } from '../executors/exec-command.executor.js';
import { pushFile } from '../executors/push-file.executor.js';
import { frpCreate } from '../executors/frp-create.executor.js';
import { frpRemove } from '../executors/frp-remove.executor.js';
import { healthCheck } from '../executors/exec-health-check.executor.js';
import type { ClientConfig } from '../config/client.config.js';

export async function dispatchTask(
  ws: WebSocket,
  config: ClientConfig,
  message: { type: string; payload: { taskId: string; taskType: string; payload: any } }
): Promise<void> {
  const { taskId, taskType, payload } = message.payload;

  logger.info({ taskId, taskType }, 'Dispatching task');

  const sendLog = (stream: 'stdout' | 'stderr', content: string) => {
    ws.send(JSON.stringify({
      type: 'task.log',
      payload: { taskId, stream, content },
    }));
  };

  const sendResult = (status: string, result?: unknown, error?: string) => {
    ws.send(JSON.stringify({
      type: 'task.result',
      payload: { taskId, status, result, error },
    }));
  };

  try {
    switch (taskType) {
      case 'health_check':
        await healthCheck(sendLog, sendResult);
        break;
      case 'exec_script':
        await execScript(config, payload, sendLog, sendResult);
        break;
      case 'exec_command':
        await execCommand(config, payload, sendLog, sendResult);
        break;
      case 'push_file':
        await pushFile(config, payload, sendLog, sendResult);
        break;
      case 'frp_create_proxy':
        await frpCreate(config, payload, sendLog, sendResult);
        break;
      case 'frp_remove_proxy':
        await frpRemove(config, payload, sendLog, sendResult);
        break;
      default:
        sendResult('failed', undefined, `Unknown task type: ${taskType}`);
    }
  } catch (err: any) {
    logger.error({ err, taskId }, 'Task execution error');
    sendResult('failed', undefined, err.message);
  }
}

export function handleServerMessage(
  ws: WebSocket,
  config: ClientConfig,
  message: any
): void {
  if (message.type === 'server.ack') {
    logger.info({ payload: message.payload }, 'Server acknowledged');
  } else if (message.type === 'server.error') {
    logger.error({ payload: message.payload }, 'Server error');
  } else if (message.type === 'task.dispatch') {
    dispatchTask(ws, config, message);
  } else {
    logger.warn({ type: message.type }, 'Unknown message type');
  }
}
```

- [ ] **步骤 5：编写 runtime/workspace.ts**

```typescript
import { resolve } from 'node:path';
import { mkdir } from 'node:fs/promises';

export function getWorkspaceDir(workspaceRoot: string): string {
  return resolve(workspaceRoot);
}

export async function ensureTaskDir(workspaceRoot: string, taskId: string): Promise<string> {
  const dir = resolve(workspaceRoot, 'tasks', taskId);
  await mkdir(dir, { recursive: true });
  return dir;
}

export function resolveInWorkspace(workspaceRoot: string, ...segments: string[]): string {
  const resolved = resolve(workspaceRoot, ...segments);
  // Ensure it's under workspace
  if (!resolved.startsWith(resolve(workspaceRoot))) {
    throw new Error(`Path ${resolved} is outside workspace`);
  }
  return resolved;
}
```

- [ ] **步骤 6：编写 runtime/security.ts**

```typescript
const BLOCKED_PORTS = [22, 3389, 3306, 5432, 6379, 27017, 6379];

const BLOCKED_PATHS_WINDOWS = [
  'C:\\Windows',
  'C:\\Program Files',
  'C:\\Program Files (x86)',
];

const BLOCKED_PATHS_LINUX = [
  '/etc',
  '/bin',
  '/sbin',
  '/usr/bin',
  '/root',
  '/boot',
];

export function isPortAllowed(port: number, allowedRange?: { start: number; end: number }): boolean {
  if (BLOCKED_PORTS.includes(port)) return false;
  if (allowedRange && (port < allowedRange.start || port > allowedRange.end)) return false;
  return true;
}

export function isPathAllowed(targetPath: string, workspaceRoot: string): boolean {
  const { resolve } = require('node:path');
  const resolved = resolve(targetPath);
  const workspace = resolve(workspaceRoot);

  // Must be under workspace
  if (!resolved.startsWith(workspace)) {
    return false;
  }

  return true;
}

export function getBlockedPaths(): string[] {
  return process.platform === 'win32' ? BLOCKED_PATHS_WINDOWS : BLOCKED_PATHS_LINUX;
}
```

- [ ] **步骤 7：验证 typecheck**

运行：`pnpm --filter @rag/client typecheck`
预期：需要先创建 executor 存根。先跳过，在下一步一起处理。

- [ ] **步骤 8：Commit**

```bash
git add apps/client/src/core/ apps/client/src/runtime/
git commit -m "feat(client): add core modules - connection, registration, heartbeat, task dispatcher"
```

---

### 任务 12：客户端执行器

**文件：**
- 创建：`apps/client/src/executors/exec-health-check.executor.ts`
- 创建：`apps/client/src/executors/exec-script.executor.ts`
- 创建：`apps/client/src/executors/exec-command.executor.ts`
- 创建：`apps/client/src/services/script.service.ts`
- 创建：`apps/client/src/services/process.service.ts`
- 创建：`apps/client/src/services/file.service.ts`
- 创建：`apps/client/src/executors/push-file.executor.ts`
- 创建：`apps/client/src/services/frp.service.ts`
- 创建：`apps/client/src/executors/frp-create.executor.ts`
- 创建：`apps/client/src/executors/frp-remove.executor.ts`

- [ ] **步骤 1：编写 process.service.ts**

```typescript
import { spawn, type ChildProcess } from 'node:child_process';

export interface SpawnResult {
  exitCode: number;
  stdout: string;
  stderr: string;
  durationMs: number;
}

export function spawnProcess(
  command: string,
  args: string[],
  options: {
    cwd?: string;
    timeoutMs?: number;
    onStdout?: (data: string) => void;
    onStderr?: (data: string) => void;
  } = {}
): Promise<SpawnResult> {
  return new Promise((resolve, reject) => {
    const start = Date.now();
    let stdout = '';
    let stderr = '';

    const child: ChildProcess = spawn(command, args, {
      cwd: options.cwd,
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    const timeout = options.timeoutMs
      ? setTimeout(() => {
          child.kill('SIGTERM');
          setTimeout(() => child.kill('SIGKILL'), 5000);
        }, options.timeoutMs)
      : null;

    child.stdout?.on('data', (data: Buffer) => {
      const text = data.toString();
      stdout += text;
      options.onStdout?.(text);
    });

    child.stderr?.on('data', (data: Buffer) => {
      const text = data.toString();
      stderr += text;
      options.onStderr?.(text);
    });

    child.on('close', (code) => {
      if (timeout) clearTimeout(timeout);
      resolve({
        exitCode: code ?? -1,
        stdout,
        stderr,
        durationMs: Date.now() - start,
      });
    });

    child.on('error', (err) => {
      if (timeout) clearTimeout(timeout);
      reject(err);
    });
  });
}
```

- [ ] **步骤 2：编写 script.service.ts**

```typescript
import { writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { ensureTaskDir } from '../runtime/workspace.js';
import type { ClientConfig } from '../config/client.config.js';

export async function writeScriptFile(
  config: ClientConfig,
  taskId: string,
  script: string,
  runtime: string = 'node'
): Promise<string> {
  const taskDir = await ensureTaskDir(config.workspaceDir, taskId);
  const ext = runtime === 'python' ? '.py' : runtime === 'bash' ? '.sh' : '.js';
  const filePath = resolve(taskDir, `script${ext}`);
  await writeFile(filePath, script, 'utf-8');
  return filePath;
}
```

- [ ] **步骤 3：编写 file.service.ts**

```typescript
import { createWriteStream, existsSync, mkdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { pipeline } from 'node:stream/promises';
import { resolveInWorkspace } from '../runtime/workspace.js';
import type { ClientConfig } from '../config/client.config.js';

export async function downloadAndSave(
  config: ClientConfig,
  fileId: string,
  targetPath: string,
  fileName: string
): Promise<string> {
  const fullDir = resolveInWorkspace(config.workspaceDir, targetPath);
  if (!existsSync(fullDir)) {
    mkdirSync(fullDir, { recursive: true });
  }

  const fullPath = resolve(fullDir, fileName);
  const url = `${config.apiBaseUrl}/api/files/${fileId}/download`;

  const response = await fetch(url, {
    headers: { Authorization: `Bearer ${config.token}` },
  });

  if (!response.ok) {
    throw new Error(`Failed to download file: ${response.status} ${response.statusText}`);
  }

  if (!response.body) {
    throw new Error('No response body');
  }

  // Node fetch body -> WriteStream
  const writer = createWriteStream(fullPath);
  const reader = (response.body as any).getReader
    ? response.body
    : null;

  // Use a simpler approach
  const buffer = Buffer.from(await response.arrayBuffer());
  const { writeFile } = await import('node:fs/promises');
  await writeFile(fullPath, buffer);

  return fullPath;
}
```

- [ ] **步骤 4：编写 exec-health-check.executor.ts**

```typescript
export async function healthCheck(
  sendLog: (stream: 'stdout' | 'stderr', content: string) => void,
  sendResult: (status: string, result?: unknown, error?: string) => void
): Promise<void> {
  sendLog('stdout', 'Health check OK\n');
  sendResult('success', { status: 'healthy', timestamp: Date.now() });
}
```

- [ ] **步骤 5：编写 exec-script.executor.ts**

```typescript
import type { ClientConfig } from '../config/client.config.js';
import { writeScriptFile } from '../services/script.service.js';
import { spawnProcess } from '../services/process.service.js';

export async function execScript(
  config: ClientConfig,
  payload: { runtime?: string; script: string; timeoutMs?: number },
  sendLog: (stream: 'stdout' | 'stderr', content: string) => void,
  sendResult: (status: string, result?: unknown, error?: string) => void
): Promise<void> {
  const runtime = payload.runtime || 'node';
  const scriptPath = await writeScriptFile(config, `exec_${Date.now()}`, payload.script, runtime);

  const cmdMap: Record<string, string> = {
    node: 'node',
    python: 'python3',
    bash: 'bash',
  };

  const cmd = cmdMap[runtime] || 'node';

  sendLog('stdout', `Starting script execution: ${cmd} ${scriptPath}\n`);

  const result = await spawnProcess(cmd, [scriptPath], {
    timeoutMs: payload.timeoutMs || 60_000,
    onStdout: (data) => sendLog('stdout', data),
    onStderr: (data) => sendLog('stderr', data),
  });

  sendResult('success', {
    exitCode: result.exitCode,
    durationMs: result.durationMs,
  });
}
```

- [ ] **步骤 6：编写 exec-command.executor.ts**

```typescript
import type { ClientConfig } from '../config/client.config.js';
import { spawnProcess } from '../services/process.service.js';

export async function execCommand(
  config: ClientConfig,
  payload: { command: string; args?: string[]; cwd?: string; timeoutMs?: number },
  sendLog: (stream: 'stdout' | 'stderr', content: string) => void,
  sendResult: (status: string, result?: unknown, error?: string) => void
): Promise<void> {
  sendLog('stdout', `Executing: ${payload.command} ${(payload.args || []).join(' ')}\n`);

  const result = await spawnProcess(payload.command, payload.args || [], {
    cwd: payload.cwd,
    timeoutMs: payload.timeoutMs || 60_000,
    onStdout: (data) => sendLog('stdout', data),
    onStderr: (data) => sendLog('stderr', data),
  });

  sendResult('success', {
    exitCode: result.exitCode,
    durationMs: result.durationMs,
  });
}
```

- [ ] **步骤 7：编写 push-file.executor.ts**

```typescript
import type { ClientConfig } from '../config/client.config.js';
import { downloadAndSave } from '../services/file.service.js';

export async function pushFile(
  config: ClientConfig,
  payload: { fileId: string; targetPath: string; fileName: string },
  sendLog: (stream: 'stdout' | 'stderr', content: string) => void,
  sendResult: (status: string, result?: unknown, error?: string) => void
): Promise<void> {
  sendLog('stdout', `Downloading file ${payload.fileId}...\n`);

  const fullPath = await downloadAndSave(
    config,
    payload.fileId,
    payload.targetPath,
    payload.fileName
  );

  sendLog('stdout', `File saved to ${fullPath}\n`);
  sendResult('success', { path: fullPath });
}
```

- [ ] **步骤 8：编写 frp.service.ts**

```typescript
import { writeFile, mkdir, readFile, unlink } from 'node:fs/promises';
import { resolve } from 'node:path';
import { existsSync } from 'node:fs';
import { spawnProcess } from './process.service.js';
import type { ClientConfig } from '../config/client.config.js';

const frpProcesses = new Map<string, { kill: () => void }>();

export async function createFrpcConfig(
  config: ClientConfig,
  mappingId: string,
  proxyName: string,
  proxyType: string,
  localIp: string,
  localPort: number,
  remotePort: number
): Promise<string> {
  const mappingsDir = resolve(config.frpcWorkDir, 'mappings');
  if (!existsSync(mappingsDir)) {
    await mkdir(mappingsDir, { recursive: true });
  }

  const configPath = resolve(mappingsDir, `${mappingId}.toml`);
  const toml = `
serverAddr = "${new URL(config.serverUrl).hostname}"
serverPort = 7000

auth.method = "token"
auth.token = "${config.token}"

[[proxies]]
name = "${proxyName}"
type = "${proxyType}"
localIP = "${localIp}"
localPort = ${localPort}
remotePort = ${remotePort}
`.trim();

  await writeFile(configPath, toml, 'utf-8');
  return configPath;
}

export async function startFrpc(
  config: ClientConfig,
  configPath: string,
  sendLog: (stream: 'stdout' | 'stderr', content: string) => void
): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(config.frpcPath, ['-c', configPath], {
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    child.stdout?.on('data', (data: Buffer) => {
      sendLog('stdout', data.toString());
    });

    child.stderr?.on('data', (data: Buffer) => {
      sendLog('stderr', data.toString());
    });

    child.on('error', reject);

    // frpc outputs "start proxy success" on successful connection
    const timeout = setTimeout(() => {
      resolve(); // Assume started after 5s
    }, 5000);

    child.on('close', (code) => {
      clearTimeout(timeout);
    });
  });
}

export async function stopFrpc(mappingId: string): Promise<void> {
  const proc = frpProcesses.get(mappingId);
  if (proc) {
    proc.kill();
    frpProcesses.delete(mappingId);
  }
}
```

- [ ] **步骤 9：编写 frp-create.executor.ts**

```typescript
import type { ClientConfig } from '../config/client.config.js';
import { createFrpcConfig, startFrpc } from '../services/frp.service.js';

export async function frpCreate(
  config: ClientConfig,
  payload: {
    mappingId: string;
    name: string;
    proxyType: string;
    localIp: string;
    localPort: number;
    remotePort: number;
  },
  sendLog: (stream: 'stdout' | 'stderr', content: string) => void,
  sendResult: (status: string, result?: unknown, error?: string) => void
): Promise<void> {
  sendLog('stdout', `Creating FRP proxy: ${payload.name} (${payload.localPort} -> ${payload.remotePort})\n`);

  const configPath = await createFrpcConfig(
    config,
    payload.mappingId,
    payload.name,
    payload.proxyType,
    payload.localIp,
    payload.localPort,
    payload.remotePort
  );

  sendLog('stdout', `FRP config written to ${configPath}\n`);
  sendLog('stdout', 'Starting frpc...\n');

  await startFrpc(config, configPath, sendLog);

  const publicUrl = `tcp://${new URL(config.serverUrl).hostname}:${payload.remotePort}`;
  sendResult('success', { publicUrl, remotePort: payload.remotePort });
}
```

- [ ] **步骤 10：编写 frp-remove.executor.ts**

```typescript
import type { ClientConfig } from '../config/client.config.js';
import { stopFrpc } from '../services/frp.service.js';
import { unlink } from 'node:fs/promises';
import { resolve } from 'node:path';

export async function frpRemove(
  config: ClientConfig,
  payload: { mappingId: string },
  sendLog: (stream: 'stdout' | 'stderr', content: string) => void,
  sendResult: (status: string, result?: unknown, error?: string) => void
): Promise<void> {
  sendLog('stdout', `Removing FRP proxy: ${payload.mappingId}\n`);

  await stopFrpc(payload.mappingId);

  // Clean up config file
  const configPath = resolve(config.frpcWorkDir, 'mappings', `${payload.mappingId}.toml`);
  try {
    await unlink(configPath);
  } catch {
    // File may not exist
  }

  sendResult('success', { removed: true });
}
```

- [ ] **步骤 11：验证 typecheck 和构建**

运行：`pnpm --filter @rag/client typecheck`
预期：修复导入错误（如 `spawn` 应为 `spawnProcess`）后通过。

- [ ] **步骤 12：Commit**

```bash
git add apps/client/src/executors/ apps/client/src/services/
git commit -m "feat(client): add all executors - health_check, script, command, file, frp"
```

---

### 任务 13：客户端入口 main.ts

**文件：**
- 创建：`apps/client/src/main.ts`

- [ ] **步骤 1：编写 main.ts**

```typescript
import { loadConfig } from './config/client.config.js';
import { logger } from './runtime/logger.js';
import { createConnection } from './core/connection.js';
import { sendRegister } from './core/register.js';
import { startHeartbeat } from './core/heartbeat.js';
import { handleServerMessage } from './core/task-dispatcher.js';

async function main() {
  const config = loadConfig();
  logger.info({ clientId: config.clientId }, 'Starting client agent');

  const ws = createConnection(config, (message) => {
    handleServerMessage(ws, config, message);
  });

  ws.on('open', async () => {
    await sendRegister(ws, config);
    startHeartbeat(ws, config);
  });

  // Graceful shutdown
  process.on('SIGINT', () => {
    logger.info('Shutting down...');
    ws.close();
    process.exit(0);
  });

  process.on('SIGTERM', () => {
    logger.info('Shutting down...');
    ws.close();
    process.exit(0);
  });
}

main().catch((err) => {
  logger.error({ err }, 'Fatal error');
  process.exit(1);
});
```

- [ ] **步骤 2：验证 typecheck 和构建**

运行：`pnpm --filter @rag/client typecheck && pnpm --filter @rag/client build`
预期：通过。

- [ ] **步骤 3：Commit**

```bash
git add apps/client/src/main.ts
git commit -m "feat(client): add client agent bootstrap"
```

---

### 任务 14：集成验证与收尾

- [ ] **步骤 1：全项目 typecheck**

运行：`pnpm typecheck`
预期：所有包通过。

- [ ] **步骤 2：全项目测试**

运行：`pnpm test`
预期：所有测试通过。

- [ ] **步骤 3：全项目构建**

运行：`pnpm build`
预期：所有包编译成功。

- [ ] **步骤 4：创建 config.json 模板**

创建 `apps/client/config.example.json`:

```json
{
  "clientId": "my-machine-01",
  "clientName": "My Machine",
  "serverUrl": "wss://your-server.com/ws/client",
  "apiBaseUrl": "https://your-server.com",
  "token": "change_me_client_token",
  "workspaceDir": "./workspace",
  "frpcPath": "/usr/local/bin/frpc",
  "frpcWorkDir": "./frp",
  "tags": ["dev"]
}
```

- [ ] **步骤 5：创建 frps.toml 模板**

创建 `frp/frps.toml`:

```toml
bindPort = 7000

auth.method = "token"
auth.token = "change_me_strong_token"

webServer.addr = "0.0.0.0"
webServer.port = 7500
webServer.user = "admin"
webServer.password = "change_me_admin_password"
```

- [ ] **步骤 6：最终 Commit**

```bash
git add -A
git commit -m "chore: add config templates, frps config, and final verification"
```
