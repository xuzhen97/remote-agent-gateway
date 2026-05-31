# Remote Agent Gateway

> 面向 AI Agent 的远程机器控制、文件分发、脚本执行和端口映射平台。

统一的服务端 API，让 AI Agent（Claude Code、Codex、VCP 等）可以控制多台无公网 IP 的客户端机器——执行脚本、推送文件、创建临时端口映射。

---

## 架构

```
┌──────────────────────────────────────────────────┐
│                  AI Agent / CLI                   │
│            HTTP API (Bearer Token)                │
└─────────────────────┬────────────────────────────┘
                      │
┌─────────────────────▼────────────────────────────┐
│              Server (公网机器)                     │
│  Fastify + WebSocket + SQLite + 文件存储          │
│                                                   │
│  /api/clients    客户端管理                        │
│  /api/tasks      任务 CRUD + 日志                  │
│  /api/files      文件上传/下载                      │
│  /api/port-mappings   FRP 端口映射                 │
│  /api/agent/*    AI Agent 高级接口                 │
│  /ws/client      WebSocket 长连接                  │
└──────┬──────────────────────────────┬────────────┘
       │ WebSocket (客户端主动连接)     │
       ▼                              ▼
┌──────────────┐            ┌──────────────┐
│  Client #1   │            │  Client #2   │
│  内网机器     │            │  内网机器     │
│              │            │              │
│  执行脚本     │            │  执行脚本     │
│  执行命令     │            │  执行命令     │
│  接收文件     │            │  接收文件     │
│  管理 frpc   │            │  管理 frpc   │
└──────────────┘            └──────────────┘
```

**核心思路：** 客户端没有公网 IP → 客户端主动通过 WebSocket 连接服务端 → 服务端通过长连接下发任务。

---

## 项目结构

```
remote-agent-gateway/
├── packages/shared/          # 共享类型、Zod Schema、WebSocket 协议
│   └── src/
│       ├── types.ts          # TaskType, TaskStatus, ClientInfo 等
│       ├── protocol.ts       # WS 消息类型定义
│       └── schemas.ts        # Zod 校验规则
│
├── apps/server/              # 服务端：Fastify + WebSocket + SQLite
│   └── src/
│       ├── main.ts           # 入口：启动 HTTP + WS 服务
│       ├── config/env.ts     # 环境变量 Zod 校验
│       ├── db/               # SQLite（sql.js WASM）
│       │   ├── index.ts      # 数据库初始化 + 持久化
│       │   └── migrate.ts    # 建表迁移
│       ├── modules/
│       │   ├── auth/         # Token 鉴权中间件
│       │   ├── clients/      # 客户端注册、心跳、在线状态
│       │   ├── connections/  # WebSocket 连接池管理
│       │   ├── tasks/        # 任务创建、状态、日志
│       │   ├── files/        # 文件上传、存储、SHA256
│       │   ├── frp/          # FRP 端口映射 CRUD
│       │   ├── audit/        # 审计日志
│       │   └── agent/        # AI Agent 高级 API
│       └── ws/               # WebSocket 消息处理
│
├── apps/client/              # 客户端 Agent
│   └── src/
│       ├── main.ts           # 入口：连接 → 注册 → 心跳 → 等待任务
│       ├── config/           # config.json 加载
│       ├── core/             # 连接管理、注册、心跳、任务分发
│       ├── executors/        # 5 种执行器
│       │   ├── exec-script.executor.ts    # Node.js/Python/Bash 脚本
│       │   ├── exec-command.executor.ts   # Shell 命令
│       │   ├── push-file.executor.ts      # 从服务端下载文件
│       │   ├── frp-create.executor.ts     # 启动 frpc 进程
│       │   └── frp-remove.executor.ts     # 停止 frpc 进程
│       └── runtime/
│           └── workspace.ts   # 工作区路径安全限制
│
├── scripts/                  # 构建脚本
│   └── build-all.ts          # esbuild 打包 → dist/
│
└── dist/                     # 分发包（构建产出）
    ├── server.bundle.cjs     # 服务端单文件
    ├── client.bundle.cjs     # 客户端单文件
    ├── sql-wasm.wasm         # SQLite 运行时
    └── start-*.bat/sh        # 启动脚本
```

---

## 快速开始

### 环境要求

- **Node.js** ≥ 22
- **pnpm** ≥ 10

### 安装

```bash
git clone <repo-url>
cd remote-agent-gateway
pnpm install
```

### 开发模式

```bash
# 1. 配置服务端
cp .env.example .env
# 编辑 .env，至少修改 ADMIN_TOKEN 和 AGENT_API_TOKEN

# 2. 启动服务端
pnpm dev:server
# → http://localhost:3000

# 3. 配置客户端（另一台机器或本机）
cp apps/client/config.example.json apps/client/config.json
# 编辑 config.json，填写 serverUrl 和 token

# 4. 启动客户端
pnpm dev:client
# → 连接服务端，注册，等待任务
```

### 测试

```bash
pnpm test          # 全量测试（26 个）
pnpm typecheck     # 类型检查
```

---

## API 参考

所有 API 需要在 Header 中携带 `Authorization: Bearer <token>`。

### 客户端管理

| 方法 | 路径 | 说明 |
|------|------|------|
| `GET` | `/api/clients` | 列出所有客户端 |
| `GET` | `/api/clients/:id` | 获取单个客户端详情 |

### 任务管理

| 方法 | 路径 | 说明 |
|------|------|------|
| `POST` | `/api/tasks` | 创建任务 |
| `GET` | `/api/tasks` | 列出任务（支持 `?clientId=&status=&limit=`） |
| `GET` | `/api/tasks/:id` | 任务详情 |
| `GET` | `/api/tasks/:id/logs` | 任务实时日志 |

**创建任务示例：**

```json
{
  "clientId": "win-dev-01",
  "type": "exec_script",
  "payload": {
    "runtime": "node",
    "script": "console.log('hello from client')",
    "timeoutMs": 60000
  }
}
```

### 文件管理

| 方法 | 路径 | 说明 |
|------|------|------|
| `POST` | `/api/files` | 上传文件（multipart） |
| `GET` | `/api/files` | 列出文件 |
| `GET` | `/api/files/:id/download` | 下载文件 |

### 客户端文件管理

这些接口通过 WebSocket 启动客户端本地文件 HTTP 服务，并通过 FRP 暴露的数据面传输文件内容。客户端通过 `allowedRoots` 声明可浏览根目录；前端和服务端使用 `rootId + path` 组合来定位文件，而不是直接传递任意绝对路径。

客户端配置示例：

```json
{
  "workspaceDir": "./workspace",
  "allowedRoots": [
    "./workspace"
  ],
  "frpcPath": "./bin/frpc"
}
```

| 方法 | 路径 | 说明 |
|------|------|------|
| `POST` | `/api/clients/:clientId/file-session/start` | 启动客户端文件服务并创建 FRP 映射 |
| `GET` | `/api/clients/:clientId/file-session` | 查看文件服务会话 |
| `POST` | `/api/clients/:clientId/file-session/stop` | 停止文件服务会话 |
| `GET` | `/api/clients/:clientId/files/roots` | 获取当前客户端允许浏览的根目录列表 |
| `GET` | `/api/clients/:clientId/files?rootId=...&path=.` | 列出目录 |
| `GET` | `/api/clients/:clientId/files/stat?rootId=...&path=...` | 查看文件信息 |
| `GET` | `/api/clients/:clientId/files/read?rootId=...&path=...` | 读取文件内容 |
| `GET` | `/api/clients/:clientId/files/download?rootId=...&path=...` | 下载文件 |
| `PUT` | `/api/clients/:clientId/files/write?rootId=...&path=...` | 写入文件 |
| `POST` | `/api/clients/:clientId/files/upload?rootId=...&path=...&filename=...` | 上传文件到当前根目录路径 |
| `POST` | `/api/clients/:clientId/files/mkdir` | 创建目录（body 含 `rootId`, `path`） |
| `DELETE` | `/api/clients/:clientId/files?rootId=...&path=...` | 删除文件或目录 |
| `POST` | `/api/clients/:clientId/files/move` | 移动或重命名（body 含 `rootId`, `from`, `to`） |
| `POST` | `/api/clients/:clientId/files/copy` | 复制文件或目录（body 含 `rootId`, `from`, `to`） |

错误语义：

- `400`：路径非法、越界到允许根目录之外、`rootId` 不存在
- `403`：当前客户端进程无权限访问
- `404`：文件或目录不存在
- `409`：目标已存在或操作冲突

### 端口映射

| 方法 | 路径 | 说明 |
|------|------|------|
| `POST` | `/api/port-mappings` | 创建映射 |
| `GET` | `/api/port-mappings` | 列出映射 |
| `DELETE` | `/api/port-mappings/:id` | 删除映射 |

### AI Agent 高级接口

这些接口封装了底层 task 概念，让 AI Agent 直接调用高层语义：

| 方法 | 路径 | 说明 |
|------|------|------|
| `POST` | `/api/agent/run-script` | 在目标客户端执行脚本 |
| `POST` | `/api/agent/push-file` | 推送已上传的文件到客户端 |
| `POST` | `/api/agent/open-port` | 创建 FRP 端口映射 |
| `POST` | `/api/agent/close-port` | 删除端口映射 |
| `GET` | `/api/agent/tasks/:id` | 查询任务状态（含日志） |

---

## 任务类型

| 类型 | 说明 | 关键 payload |
|------|------|-------------|
| `health_check` | 心跳检测 | — |
| `exec_script` | 执行脚本（Node/Python/Bash） | `runtime`, `script`, `timeoutMs` |
| `exec_command` | 执行 Shell 命令 | `command`, `args`, `cwd` |
| `push_file` | 推送文件到客户端 | `fileId`, `targetPath`, `fileName` |
| `frp_create_proxy` | 创建 FRP 端口映射 | `name`, `proxyType`, `localPort`, `remotePort` |
| `frp_remove_proxy` | 删除 FRP 端口映射 | `mappingId` |

任务状态流转：`pending` → `dispatched` → `running` → `success` / `failed` / `cancelled`

---

## WebSocket 协议

客户端通过 `/ws/client?clientId=xxx&token=xxx` 建立长连接。

### 客户端 → 服务端

| 消息类型 | 说明 |
|----------|------|
| `client.register` | 注册客户端信息（OS、arch、tags） |
| `client.heartbeat` | 周期心跳（CPU、内存、uptime） |
| `task.log` | 任务实时日志（stdout/stderr） |
| `task.result` | 任务结果（exitCode、error） |

### 服务端 → 客户端

| 消息类型 | 说明 |
|----------|------|
| `server.ack` | 确认消息 |
| `server.error` | 错误信息 |
| `task.dispatch` | 下发任务 |

详细消息格式见 `packages/shared/src/protocol.ts`。

---

## 安全设计

| 层面 | 措施 |
|------|------|
| **API 鉴权** | Bearer Token，区分 admin/agent 角色 |
| **客户端认证** | clientId + token 通过 WebSocket 连接参数传递 |
| **路径限制** | 所有文件操作强制在 workspaceDir 下（防路径穿越） |
| **端口限制** | 只允许映射 20000-25000 范围内的端口 |
| **脚本限制** | 最大 1MB、超时 300s、日志 5MB、默认禁止 shell |
| **审计日志** | 记录所有关键操作（任务创建、文件上传、端口映射） |

---

## 分发部署

### 一键打包

```bash
pnpm package        # 构建 + 打包 Windows .zip
pnpm package:linux  # 构建 + 打包 Linux .tar.gz
pnpm package:all    # 两者都打
```

产出 `release/` 目录，包含可直接分发的压缩包（约 0.7 MB）。

### 包内容

```
rag-v0.1.0-win.zip / rag-v0.1.0-linux.tar.gz
├── server.bundle.cjs      # 服务端（~1.9 MB 原始）
├── client.bundle.cjs      # 客户端（~260 KB）
├── sql-wasm.wasm          # SQLite 运行时（~644 KB）
├── .env.example           # 服务端配置模板
├── config.example.json    # 客户端配置模板
├── DEPLOY.txt             # 部署说明
├── start-server.bat / .sh # 服务端启动脚本
└── start-client.bat / .sh # 客户端启动脚本
```

### 手动构建（仅 dist）

```bash
pnpm build:dist
```

产出 `dist/` 目录（约 2.8 MB），包含同上内容。

```
dist/
├── server.bundle.cjs      # 服务端单文件
├── client.bundle.cjs      # 客户端单文件
├── sql-wasm.wasm          # SQLite WASM
├── .env.example           # 服务端配置模板
├── config.example.json    # 客户端配置模板
├── start-server.bat / .sh # 启动脚本
└── start-client.bat / .sh # 启动脚本
```

### 部署服务端（公网机器）

```bash
# 1. 将 dist/ 上传到服务器
scp -r dist/ user@your-server:/opt/rag/

# 2. 配置
cd /opt/rag/dist
cp .env.example .env
# 编辑 .env：修改 ADMIN_TOKEN、AGENT_API_TOKEN

# 3. 确保 Node.js 22+ 已安装
node --version  # 应 ≥ 22

# 4. 启动
node server.bundle.cjs
# 或 ./start-server.sh

# 5. (可选) 使用 PM2 守护
pm2 start server.bundle.cjs --name rag-server
```

**需要开放端口：**

| 端口 | 用途 |
|------|------|
| 3000 | HTTP API + WebSocket |
| 7000 | frps（如需 FRP） |
| 20000-25000 | FRP TCP 映射范围 |

### 部署客户端（内网机器）

```bash
# 1. 将 dist/ 复制到客户端
# 2. 配置
cp config.example.json config.json
# 编辑 config.json：
#   - serverUrl: "ws://your-server:3000/ws/client"
#   - apiBaseUrl: "http://your-server:3000"
#   - token: 与服务端 AGENT_API_TOKEN 一致
#   - workspaceDir: 工作目录

# 3. 启动
node client.bundle.cjs
# 或 ./start-client.bat
```

**客户端配置示例：**

```json
{
  "clientId": "win-dev-01",
  "clientName": "Windows Dev Machine",
  "serverUrl": "ws://your-server.com:3000/ws/client",
  "apiBaseUrl": "http://your-server.com:3000",
  "token": "your_agent_token",
  "workspaceDir": "D:/rag-workspace",
  "frpcPath": "D:/rag/bin/frpc.exe",
  "frpcWorkDir": "D:/rag/frp",
  "tags": ["windows", "dev"]
}
```

### 容器化部署（可选）

```dockerfile
FROM node:22-alpine
WORKDIR /app
COPY dist/server.bundle.cjs .
COPY dist/sql-wasm.wasm .
COPY dist/.env.example .env
EXPOSE 3000
CMD ["node", "server.bundle.cjs"]
```

---

## 如何扩展

### 添加新的任务类型

**1. 定义类型** — `packages/shared/src/types.ts`

```ts
export interface MyNewPayload {
  // 你的 payload 字段
}
export type TaskPayloadMap = {
  // ...existing
  my_new_task: MyNewPayload;
};
```

**2. 添加 Zod Schema** — `packages/shared/src/schemas.ts`

```ts
export const MyNewPayloadSchema = z.object({
  // Zod 校验规则
});
```

**3. 服务端：创建任务** — 已有路由会通过 `CreateTaskPayloadSchema` 接受新类型。

**4. 客户端：添加执行器** — `apps/client/src/executors/my-new.executor.ts`

```ts
import type { ConnectionManager } from '../core/connection.js';
import type { ClientConfig } from '../config/client.config.js';
import type { MyNewPayload } from '@rag/shared';

export async function executeMyNewTask(
  conn: ConnectionManager,
  config: ClientConfig,
  taskId: string,
  payload: MyNewPayload,
): Promise<unknown> {
  // 实现你的任务逻辑
  // 使用 conn.send({ type: 'task.log', ... }) 回传日志
  return { success: true };
}
```

**5. 注册执行器** — `apps/client/src/core/task-dispatcher.ts`

```ts
case 'my_new_task':
  result = await executeMyNewTask(conn, config, taskId, payload as MyNewPayload);
  break;
```

### 添加新的 API 路由

服务端 `modules/<name>/` 下的每个模块都遵循同一模式：

```ts
// modules/<name>/<name>.service.ts  — 业务逻辑
// modules/<name>/<name>.routes.ts  — HTTP 路由注册
```

在 `main.ts` 中注册即可：

```ts
import { myRoutes } from './modules/my-feature/my-feature.routes.js';
await app.register(myRoutes);
```

### 扩展部署拓扑

- **多服务端**：每个客户端只能连一个服务端。如需多服务端，每台部署一个 Server 实例。
- **反向代理**：在 Fastify 前加 Nginx/Caddy 处理 TLS。
- **水平扩展**：SQLite 单机场景下无需。如果需要多服务端共享状态，将 SQLite 替换为 PostgreSQL（Drizzle schema 兼容）。

---

## 技术栈

| 层 | 技术 | 备注 |
|----|------|------|
| 运行时 | Node.js 22+ | TypeScript → esbuild bundle |
| HTTP | Fastify 5 | 高性能、插件化 |
| WebSocket | ws + @fastify/websocket | 长连接任务下发 |
| 数据库 | sql.js (SQLite WASM) | 零依赖、纯 JS |
| 校验 | Zod | 类型安全 + 运行时校验 |
| 日志 | Pino | 开发模式彩色输出 |
| 测试 | Vitest | 26 单元 + 17 E2E + 10 FRP 隧道测试 |
| 构建 | esbuild + tsx | 单文件分发 |
| 包管理 | pnpm | Monorepo workspace |

---

## 开发命令

```bash
pnpm dev:server        # 启动服务端（热重载）
pnpm dev:client        # 启动客户端（热重载）
pnpm test              # 单元测试（26 个）
pnpm test:e2e          # E2E 全链路测试（自动启停）
pnpm test:e2e:verbose  # E2E 详细输出
pnpm test:frp          # FRP 隧道穿透测试（自动启停）
pnpm test:frp:verbose  # FRP 测试详细输出
pnpm typecheck         # 类型检查
pnpm build             # 编译所有包
pnpm build:dist        # 构建分发包
pnpm build:dist:server # 只构建服务端
pnpm build:dist:client # 只构建客户端
pnpm download:frp      # 下载 FRP 二进制（frps + frpc）
pnpm package           # 一键打包当前平台
pnpm package:all       # 打包 Windows + Linux
pnpm package:win       # 打包 Windows .zip
pnpm package:linux     # 打包 Linux .tar.gz
```

---

## FRP 内网穿透

项目内置了 FRP 端口映射功能，可将客户端本地端口暴露到公网。支持三种 frps 部署模式。

### 部署模式

| 模式 | `.env` 配置 | frps 位置 | 谁管理 |
|------|------------|-----------|--------|
| **`builtin`** | `FRP_MODE=builtin` | 与服务端同机 | 服务端自动下载并管理 frps 进程 |
| **`external`** | `FRP_MODE=external` | 与服务端同机 | 用户手动启动 frps |
| **`remote`**（默认） | `FRP_MODE=remote` `FRPS_HOST=1.2.3.4` | 独立公网机器 | 用户部署和管理 |

```env
# .env 中的 FRP 配置段
FRP_MODE=remote              # builtin | external | remote
FRPS_HOST=your-server-ip      # remote 模式必填
FRPS_PORT=7000
FRPS_TOKEN=change_me_token   # 必须与 frps.toml 中一致
FRP_PORT_RANGE_START=20000
FRP_PORT_RANGE_END=25000
```

### 快速开始

```bash
# 1. 下载 FRP 二进制
pnpm download:frp
# → bin/frps + bin/frpc

# 2. 服务端：编辑 frp/frps.toml 修改 auth.token，启动 frps
./bin/frps -c frp/frps.toml
# 或设置 FRP_MODE=builtin 让服务端自动管理

# 3. 客户端 config.json 配置 frpc 路径
# "frpcPath": "./bin/frpc",
# "frpcWorkDir": "./frp"

# 4. 通过 API 创建映射
curl -X POST http://server:3000/api/agent/open-port \
  -H "Authorization: Bearer <token>" \
  -H "Content-Type: application/json" \
  -d '{"clientId":"my-client","name":"web","localPort":3000,"type":"tcp"}'

# 5. 访问公网地址
curl http://your-server-ip:20000
```

### 穿透测试

```bash
# 自动启动服务端+客户端，创建映射，验证隧道连通
pnpm test:frp
pnpm test:frp:verbose
```

### 架构

```
外部用户 → frps(公网:20000) → frpc(客户端) → localhost:3000
            ▲                       ▲
            │ 独立部署               │ Agent 自动管理
            │ 或 builtin 模式       │ 一个映射一个进程
```

### 防火墙要求

| 端口 | 协议 | 用途 |
|------|------|------|
| 3000 | TCP | RAG Server HTTP + WebSocket |
| 7000 | TCP | frpc ↔ frps 控制连接 |
| 20000-25000 | TCP | FRP 用户映射端口范围 |

### 相关文件

| 文件 | 说明 |
|------|------|
| `frp/frps.toml` | frps 配置模板（修改 auth.token） |
| `frp/frpc-example.toml` | frpc 手动测试参考 |
| `scripts/download-frp.ts` | FRP 二进制下载脚本 |
| `scripts/test-frp.ts` | FRP 隧道自动化测试 |
| `apps/server/src/modules/frp/frps-manager.ts` | 内置 frps 管理器 |

---

## License

MIT
