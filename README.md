# Remote Agent Gateway

> 面向 AI Agent 的远程机器控制、文件管理、脚本执行和端口映射平台。

统一的服务端 API 用于**发现客户端、协调配置和提供轻量管理入口**；实际的数据与操作流量通过 `frps -> frpc -> client HTTP` 直达客户端机器，不占用 server 应用层带宽。AI Agent（Claude Code、Codex、VCP 等）通过 server 拿到 `clientHttpBaseUrl + clientHttpToken` 后，直接调用 client HTTP 完成脚本执行、文件管理和映射管理。

---

## 架构

```text
控制面: client <──WebSocket──> server
数据面: AI Agent / Browser <──HTTP/SSE via frps/frpc──> client HTTP service
```

```
┌─────────────────────────────────────────────────────────────┐
│                     AI Agent / Browser                      │
│                                                             │
│  1. 调 server discovery API                                 │
│  2. 直连 client HTTP / SSE                                  │
└──────────────────────────┬──────────────────────────────────┘
                           │
                           ▼
┌─────────────────────────────────────────────────────────────┐
│                 Server (公网机器 / 控制面)                   │
│  Fastify + WebSocket + SQLite                               │
│                                                             │
│  /api/clients                  客户端发现                    │
│  /api/clients/:id/http/*       轻量管理编排                  │
│  /api/client-http/ports/*      业务映射端口分配              │
│  /ws/client                    注册 / 心跳 / 配置协调        │
└──────────────────────────┬──────────────────────────────────┘
                           │ WebSocket control plane
                           ▼
┌─────────────────────────────────────────────────────────────┐
│                  Client (内网机器 / 数据面)                  │
│  local HTTP control service                                 │
│  - /jobs/*      脚本 / 命令异步任务 + SSE                   │
│  - /files/*     文件管理                                     │
│  - /frp/*       业务映射管理                                 │
│  - single frpc  唯一 FRP 客户端进程                          │
└──────────────────────────┬──────────────────────────────────┘
                           │ frps/frpc tunnel
                           ▼
                     http://<publicHost>:<remotePort>
```

**核心思路：**

- server 只负责 discovery、token/端口协调、轻量管理编排。
- client 启动后常驻一个本地 HTTP 控制服务。
- AI Agent 与管理后台通过 frps/frpc 直接访问 client HTTP。
- 旧的 WebSocket task 下发体系已经移除，不再作为正式能力存在。

---

## 项目结构

```
remote-agent-gateway/
├── packages/shared/          # 共享类型、Zod Schema、WebSocket 协议
│   └── src/
│       ├── types.ts          # client HTTP / file / mapping 共享类型
│       ├── protocol.ts       # WS 控制面消息定义
│       └── schemas.ts        # 新体系运行时校验规则
│
├── apps/server/              # 服务端：Fastify + WebSocket + SQLite
│   └── src/
│       ├── main.ts           # 入口：启动 HTTP + WS 服务
│       ├── config/           # YAML 配置加载与 env 导出
│       ├── db/               # SQLite（sql.js WASM）
│       ├── modules/
│       │   ├── auth/         # Token 鉴权中间件
│       │   ├── clients/      # 客户端 discovery / 在线状态
│       │   ├── client-http/  # 轻量管理编排 / 端口分配 / token 协调
│       │   ├── connections/  # WebSocket 连接池管理
│       │   ├── files/        # server 侧文件仓库存储
│       │   ├── frp/          # FRPS dashboard / 端口分配 / cleanup
│       │   └── audit/        # 审计日志
│       └── ws/               # register / heartbeat / http_ready 协调
│
├── apps/client/              # 客户端 Agent
│   └── src/
│       ├── main.ts           # 入口：启动本地 HTTP → 注册 → 心跳
│       ├── config/           # client.config.yaml 加载与解析
│       └── runtime/
│           ├── control-http/ # /jobs/* /files/* /frp/* 新体系入口
│           ├── frpc-daemon.ts# 唯一 frpc 进程管理
│           └── workspace.ts  # 工作区路径安全限制
│
├── apps/web/                 # React + Ant Design 管理后台
│   └── src/
│       ├── pages/            # Dashboard / Clients / Files / Mappings
│       ├── api/              # server discovery 与轻量管理 API
│       └── components/       # 布局与通用组件
│
├── scripts/                  # 构建脚本
│   └── build-all.ts          # server/client/web 分发构建
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
# 在仓库根目录提供 server.config.yaml
# 可参考仓库中的 YAML 模板自行创建
# 至少修改：
# - auth.adminToken
# - auth.agentApiToken
# - frp.connectHost / publicHost / token / dashboard
# - clientHttp.tokenSecret

# 2. 配置客户端（另一台机器或本机）
# 在仓库根目录提供 client.config.yaml
# 可参考仓库中的 YAML 模板自行创建
# 填写：
# - server.wsUrl
# - server.apiBaseUrl
# - server.token
# - workspace.allowedRoots
# - http.host / http.port

# 3. 一键启动 server + client + web
pnpm dev
# → server: http://127.0.0.1:3000
# → client: 注册并启动本地 HTTP control service
# → web:    http://127.0.0.1:5174
```

> Server / Client 运行时统一使用 YAML 配置文件；CLI 不读取这些 YAML，而是只使用命令行参数或系统环境变量。

### 测试

```bash
pnpm --filter @rag/shared test
pnpm --filter @rag/server test
pnpm --filter @rag/client test
pnpm --filter @rag/web test
pnpm typecheck
```

---

## API 参考

所有 API 需要在 Header 中携带 `Authorization: Bearer <token>`。

### 客户端管理

| 方法 | 路径 | 说明 |
|------|------|------|
| `GET` | `/api/clients` | 列出所有客户端 |
| `GET` | `/api/clients/:id` | 获取单个客户端详情 |

### Server 文件仓库

这些接口只负责 **server 本地文件仓库**，适合上传发布包、脚本模板或需要复用的静态文件；它们**不会**直接把文件推送到 client，也不再触发旧 task 执行流。

| 方法 | 路径 | 说明 |
|------|------|------|
| `POST` | `/api/files` | 上传文件到 server 仓库（multipart） |
| `GET` | `/api/files` | 列出 server 仓库文件 |
| `GET` | `/api/files/:id/download` | 从 server 仓库下载文件 |

### Client discovery / 轻量管理 API

当前正式的 server API 只负责客户端发现与轻量管理编排：

| 方法 | 路径 | 说明 |
|------|------|------|
| `GET` | `/api/clients` | 列出所有客户端（不返回 client HTTP token） |
| `GET` | `/api/clients/:id` | 获取客户端详情（返回 `clientHttpBaseUrl` / `clientHttpToken`） |
| `GET` | `/api/clients/:id/http/health` | 通过 server 轻量调用 client HTTP 健康检查 |
| `GET` | `/api/clients/:id/http/frp/mappings` | 通过 server 查看该 client 当前映射 |
| `POST` | `/api/clients/:id/http/frp/mappings` | 通过 server 创建该 client 的业务映射 |
| `DELETE` | `/api/clients/:id/http/frp/mappings/:mappingId` | 通过 server 删除该 client 的业务映射，并等待 FRPS dashboard 中对应代理清理完成 |
| `POST` | `/api/client-http/ports/allocate` | 为 client 业务映射分配端口（内部轻量分配接口） |
| `DELETE` | `/api/client-http/ports/:mappingId` | 删除业务映射记录（内部轻量删除接口） |
| `POST` | `/api/client-http/ports/cleanup-dashboard` | 清理已删除映射在 FRPS dashboard 中的离线残留（内部接口） |

### Client HTTP API（正式数据面）

client 启动后会暴露一个常驻 HTTP 控制服务：

```text
http://<frpsPublicHost>:<clientHttpRemotePort>
```

server discovery 返回这个地址与对应 token 后，AI Agent / Browser 直接调用这些接口。

#### Job API

| 方法 | 路径 | 说明 |
|------|------|------|
| `POST` | `/jobs/command` | 创建命令执行 job |
| `POST` | `/jobs/script` | 创建脚本执行 job |
| `GET` | `/jobs/:jobId` | 查询 job 状态 |
| `GET` | `/jobs/:jobId/logs` | 拉取 job 历史日志 |
| `GET` | `/jobs/:jobId/events` | SSE 实时日志 / 状态流 |
| `POST` | `/jobs/:jobId/cancel` | 取消 job |

#### File API

| 方法 | 路径 | 说明 |
|------|------|------|
| `GET` | `/files/roots` | 获取 `allowedRoots` 列表 |
| `GET` | `/files?rootId=...&path=.` | 列目录 |
| `GET` | `/files/stat?rootId=...&path=...` | 查看文件信息 |
| `GET` | `/files/read?rootId=...&path=...` | 读取文件内容 |
| `GET` | `/files/download?rootId=...&path=...` | 下载文件 |
| `PUT` | `/files/write?rootId=...&path=...` | 写入文件 |
| `POST` | `/files/uploads/init` | 初始化/恢复分片上传会话 |
| `GET` | `/files/uploads/:uploadId/status` | 查询分片上传状态 |
| `PUT` | `/files/uploads/:uploadId/parts/:partNumber?offset=...&size=...` | 上传单个分片 |
| `POST` | `/files/uploads/:uploadId/complete` | 合并并发布最终文件 |
| `DELETE` | `/files/uploads/:uploadId` | 中止并清理上传会话 |
| `POST` | `/files/mkdir` | 创建目录 |
| `DELETE` | `/files?rootId=...&path=...` | 删除文件或目录 |
| `POST` | `/files/move` | 移动/重命名 |
| `POST` | `/files/copy` | 复制文件或目录 |

#### FRP Mapping API

| 方法 | 路径 | 说明 |
|------|------|------|
| `GET` | `/frp/mappings` | 查看当前 client 的系统/业务映射 |
| `POST` | `/frp/mappings` | 创建业务映射 |
| `DELETE` | `/frp/mappings/:id` | 删除业务映射（系统 control 映射只读）；成功返回后会等待对应代理从 FRPS dashboard/API 中消失 |

### WebSocket 协议（仅控制面）

客户端通过 `/ws/client?clientId=xxx&token=xxx` 建立长连接。

#### 客户端 → 服务端

| 消息类型 | 说明 |
|----------|------|
| `client.register` | 注册 client 元信息 + 本地 HTTP 信息 |
| `client.heartbeat` | 周期心跳 |
| `client.http_ready` | client HTTP + FRP control tunnel 就绪 |
| `client.http_failed` | client HTTP 或 control tunnel 启动失败 |

#### 服务端 → 客户端

| 消息类型 | 说明 |
|----------|------|
| `server.ack` | 注册/心跳/控制面确认消息 |
| `server.error` | 错误信息 |

> 旧的 `task.dispatch / task.log / task.result` 已移除，不再是正式能力。

---

## 任务审计与历史

所有会改动状态的 client HTTP 操作现在会生成结构化任务审计记录：

- Client 本地持久化原始审计记录
- server 收到脱敏摘要镜像
- Web 控制台提供 `任务` 页面，支持全局跨 client 视图与单 client 视图

审计覆盖的操作包括：

- 命令/脚本执行与取消（`POST /jobs/command`, `/jobs/script`, `/jobs/:id/cancel`）
- 文件写入、上传、创建目录、删除、移动、复制
- FRP 映射创建与删除

敏感字段（token、env 值、脚本正文、文件内容）不会存入 server 端历史镜像。

---

## 安全设计

| 层面 | 措施 |
|------|------|
| **Server API 鉴权** | Bearer Token，区分 admin/agent 角色 |
| **Client HTTP 鉴权** | 每个 client 独立 `clientHttpToken` |
| **客户端认证** | clientId + token 通过 WebSocket 连接参数传递 |
| **路径限制** | 文件操作严格限制在 `workspace.allowedRoots` 内 |
| **端口限制** | FRP 业务端口只在配置范围内分配 |
| **脚本限制** | job 超时、并发数、日志缓冲上限可配置 |
| **审计日志** | 记录 discovery、映射管理、server 仓库等关键操作 |

---

## 分发部署

### 一键打包

```bash
pnpm package        # 默认同时打包 Windows + Linux
# 如需指定平台：pnpm exec tsx scripts/package.ts --win|--linux|--all
```

产出 `release/` 目录，包含可直接分发的压缩包（约 0.7 MB）。

### 包内容

```
rag-v0.1.0-win.zip / rag-v0.1.0-linux.tar.gz
├── server.bundle.cjs      # 服务端（~1.9 MB 原始）
├── client.bundle.cjs      # 客户端（~260 KB）
├── sql-wasm.wasm          # SQLite 运行时（~644 KB）
├── DEPLOY.txt             # 部署说明
├── start-server.bat / .sh # 服务端启动脚本（要求已提供 server.config.yaml）
└── start-client.bat / .sh # 客户端启动脚本（要求已提供 client.config.yaml）
```

### 手动构建（仅 dist）

```bash
pnpm build
```

产出 `dist/` 目录（约 2.8 MB），包含同上内容。

```
dist/
├── server.bundle.cjs      # 服务端单文件
├── client.bundle.cjs      # 客户端单文件
├── sql-wasm.wasm          # SQLite WASM
├── start-server.bat / .sh # 启动脚本（要求已提供 server.config.yaml）
└── start-client.bat / .sh # 启动脚本（要求已提供 client.config.yaml）
```

### 部署服务端（公网机器）

```bash
# 1. 将 dist/ 上传到服务器
scp -r dist/ user@your-server:/opt/rag/

# 2. 配置
cd /opt/rag/dist
# 复制 server.config.example.yaml 为 server.config.yaml
# 然后按需修改
# 编辑 server.config.yaml：修改 auth.adminToken、auth.agentApiToken

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
# 复制 client.config.example.yaml 为 client.config.yaml
# 然后按需修改
# 编辑 client.config.yaml：
#   - server.wsUrl: "ws://your-server:3000/ws/client"
#   - server.apiBaseUrl: "http://your-server:3000"
#   - server.token: 与服务端 auth.agentApiToken 一致
#   - workspace.dir: 工作目录

# 3. 启动
node client.bundle.cjs
# 或 ./start-client.bat
```

**客户端配置示例：**

```yaml
client:
  id: win-dev-01
  name: Windows Dev Machine
  tags:
    - windows
    - dev

server:
  wsUrl: ws://your-server.com:3000/ws/client
  apiBaseUrl: http://your-server.com:3000
  token: your_agent_token

workspace:
  dir: D:/rag-workspace
  allowedRoots:
    - D:/rag-workspace

frp:
  binPath: ./bin/frpc
  workDir: ./frp
```

### 容器化部署（可选）

```dockerfile
FROM node:22-alpine
WORKDIR /app
COPY dist/server.bundle.cjs .
COPY dist/sql-wasm.wasm .
COPY server.config.yaml .
EXPOSE 3000
CMD ["node", "server.bundle.cjs"]
```

---

---

## 仓库本地开发 CLI 使用

供本仓库开发者和维护者使用，依赖仓库目录结构：

```bash
# 开发构建
pnpm --filter @rag/cli build

# 本地运行
node bin/rag doctor
node bin/rag clients list
```

跨平台 wrapper：

| 平台 | 命令 |
|------|------|
| Windows | `bin\rag.bat doctor` |
| Linux / macOS | `node bin/rag doctor` |

> **注意**：`bin/rag` 是仓库内开发入口，不适合分发。分发场景请使用下文介绍的 **skill bundle**。

---

## 分布式 Skill Bundle 使用

构建可分发的 skill bundle，将 CLI 打包进 skill 目录：

```bash
pnpm exec tsx scripts/build-skill-cli.ts
```

这将从 `apps/cli/` 源码构建单文件 CLI 产物，输出到：

```text
skills/rag-agent/
├── SKILL.md
├── references/
├── run.cjs
└── dist/
    └── rag.cjs
```

`skills/rag-agent/` 就是**完整分发单元**。构建后目录中包含自带的 launcher `run.cjs` 与 CLI 构建物 `dist/rag.cjs`，可以复制到其它仓库或 Pi skill 目录，不依赖原始 monorepo 布局。`run.cjs` 会相对自身位置解析 `dist/rag.cjs`，因此不依赖调用者当前工作目录。

### 标准分发入口

```bash
node ./run.cjs doctor
node ./run.cjs clients list
node ./run.cjs jobs run --client <clientId> -- node -v
node ./run.cjs files read --client <clientId> --root root-0 --path README.md
```

### 配置

CLI 需要 server URL 和 token。**推荐环境变量**：

```bash
export RAG_SERVER_URL=http://your-server:3000
export RAG_AGENT_TOKEN=your-agent-token
```

配置解析顺序（高优先级覆盖低优先级）：

| 优先级 | 来源 | 示例 |
|--------|------|------|
| 1 | CLI flags | `--server http://...` `--token ...` |
| 2 | 系统环境变量 | `RAG_SERVER_URL`, `RAG_AGENT_TOKEN`, `RAG_ADMIN_TOKEN`, `RAG_AGENT_API_TOKEN`, `AGENT_API_TOKEN` |

CLI **不会**读取 `.env`、`.ragrc` 或 `server.config.yaml`。

查看当前配置（token 脱敏）：

```bash
node ./run.cjs config show
```

### 输出格式

默认 JSON：

```json
{"ok":true,"data":{}}
```

失败：

```json
{"ok":false,"error":{"code":"HTTP_ERROR","message":"Client not found","status":404}}
```

`files read --raw` 输出纯文本，`jobs events` 输出 JSON Lines。

### 命令分组

```text
node ./run.cjs
├── config show              查看当前 CLI 解析结果（脱敏）
├── doctor [--client <id>]   诊断连通性
├── clients list|get         客户端发现
├── jobs run|script|get|logs|events|cancel  命令/脚本执行
├── files roots|list|read|write|upload|download|mkdir|delete|move|copy  文件管理
├── frp list|create|delete   FRP 端口映射
└── tasks list|get           审计历史
```

所有客户端操作必须显式 `--client <clientId>`，CLI 不保存默认 client。

`files upload` 现在默认使用可续传的分片上传协议：

- 对调用方仍然保持同一条命令
- 自动显示进度、速度与剩余时间
- 弱网/FRP 抖动时按分片重试
- 再次执行同样的上传命令时会尽量续传，而不是从 0 开始

---

## 安装 Skill 到 Pi Agent

```bash
pnpm exec tsx scripts/install-pi-skill.ts
```

该命令会：
1. 构建 `skills/rag-agent/dist/rag.cjs`
2. 校验 `skills/rag-agent/run.cjs` 与 bundled CLI 都存在
3. 复制整个 `skills/rag-agent/` 到 `~/.pi/agent/skills/rag-agent/`

安装后重启 Pi Agent 或重新加载 skills，之后可使用 `/skill:rag-agent`。

Skill 文档详见 `skills/rag-agent/SKILL.md` 和 `references/`。

---

## 如何扩展

### 添加新的 client HTTP 能力

现在的正式扩展方式不再是“新增 task 类型”，而是：

1. 在 `packages/shared/src/types.ts` / `schemas.ts` 定义新的 client HTTP payload
2. 在 `apps/client/src/runtime/control-http/` 下增加新的 route handler
3. 如有需要，在 `apps/server/src/modules/client-http/` 下增加对应的轻量管理编排接口
4. 在 `apps/web/src/pages/` / `api/` 中补充前端入口

例如新增一个新的 client HTTP 路由：

```ts
router.add('POST', /^\/my-feature$/, async (req, res) => {
  if (!requireBearerToken(req, res, token)) return;
  const payload = await readJson<MyPayload>(req);
  const result = await doSomething(payload);
  sendOk(res, result);
});
```

### 添加新的 server 轻量管理 API

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
| 测试 | Vitest | shared/client/server/web 分包测试 + 独立构建验证 |
| 构建 | esbuild + tsx | 单文件分发 |
| 包管理 | pnpm | Monorepo workspace |

---

## 版本管理

项目采用**根驱动统一版本**策略：根 `package.json` 是唯一版本真相源，所有 5 个子包自动同步。

```text
root/package.json  version: "0.2.0"  ← 唯一真相源
  ├─ apps/server    version: =root   (自动同步)
  ├─ apps/client    version: =root   (自动同步)
  ├─ apps/web       version: =root   (自动同步)
  ├─ apps/cli       version: =root   (自动同步)
  └─ packages/shared version: =root  (自动同步)
```

### 版本号规则

| 类型 | 命令 | 示例 | 何时使用 |
|------|------|------|----------|
| **patch** | `pnpm version:patch` | 0.1.0 → 0.1.1 | Bug fix，不改变 API |
| **minor** | `pnpm version:minor` | 0.1.0 → 0.2.0 | 新增功能，向后兼容 |
| **major** | `pnpm version:major` | 0.1.0 → 1.0.0 | 破坏性变更 |
| **sync** | `pnpm version:sync` | 仅同步 | 子包版本偏离时对齐 |

### 工作流

```bash
# 1) 开发功能 → 功能完成，准备发布
pnpm version:minor   # 自动 bump 根版本 + 同步所有子包 + git commit + tag

# 2) 检查结果
git log --oneline -1
# chore: bump version to 0.2.0
git tag
# v0.2.0

# 3) 子包版本自动反映
# - Client 重连 → register 上报 0.2.0
# - Server /api/health → serverVersion: "0.2.0"
# - Web UI 侧边栏 + 仪表盘 → 自动显示新版本

# 4) 如果手动改了根版本后子包没跟上：
pnpm version:sync
```

### 版本展示位置

| 位置 | 数据来源 | 展示方式 |
|------|----------|----------|
| Server API | `apps/server/package.json` → `/api/health` | `serverVersion` 字段 |
| Client 注册 | `apps/client/package.json` → WS `client.register` | 客户端列表 `version` 字段 |
| Web 侧边栏 | `/api/health` 查询 | 退出按钮上方灰色文字 |
| Web 仪表盘 | `/api/health` + `/api/clients` | Server 版本卡片 + 客户端版本列 |
| CLI 分发包 | `package.json` → `scripts/package.ts` | `rag-v0.2.0-win.zip` |

### 实现细节

- 脚本：`scripts/sync-version.ts`
- Client 版本读取：`apps/client/src/core/register.ts` 在运行时读 `../../package.json`
- Server 版本读取：`apps/server/src/main.ts` 在启动时读 `../package.json`
- 两者都不硬编码版本号，改版本只需 `pnpm version:xxx`

---

## 开发命令

```bash
pnpm dev               # 一键启动 server + client
pnpm test              # 运行所有测试
pnpm typecheck         # 类型检查
pnpm compile           # 编译所有包
pnpm build             # 构建分发包
pnpm package           # 按当前平台打包
```

---

## FRP 内网穿透

项目内置了 FRP 端口映射功能，可将客户端本地端口暴露到公网。支持三种 frps 部署模式。

### 部署模式

| 模式 | `server.config.yaml` 配置 | frps 位置 | 谁管理 |
|------|--------------------------|-----------|--------|
| **`builtin`** | `frp.mode=builtin` | 与服务端同机 | 服务端自动下载并管理 frps 进程 |
| **`external`** | `frp.mode=external` | 与服务端同机 | 用户手动启动 frps |
| **`remote`**（默认） | `frp.mode=remote` | 独立公网机器 | 用户部署和管理 |

```yaml
frp:
  mode: remote
  connectHost: your-server-ip   # client/frpc 实际连接的 frps 地址
  publicHost: your-server-ip    # 外部用户访问映射时看到的地址；留空时回退到 connectHost
  port: 7000
  token: change_me_token        # 必须与 frps.toml 中一致
  dashboard:
    scheme: http
    host: your-server-ip
    port: 7500
    user: admin
    password: change_me_dashboard_password
  portRange:
    start: 20000
    end: 25000
```

### 配置语义

- `frp.connectHost`：服务端下发给 client，供 frpc 连接 frps 使用
- `frp.publicHost`：服务端生成 `publicUrl` 时使用，供人类/外部系统访问映射使用
- `frp.port`：frps 控制端口
- `frp.token`：frps token
- `frp.dashboard.scheme/host/port/user/password`：服务端查询 frps dashboard / API，用于确认代理是否已注册到 frps，以及在删除映射后清理 dashboard 中的离线残留记录

`connectHost` 和 `publicHost` 可以相同，但它们不是同一个概念。

### 快速开始

```bash
# 1. 下载 FRP 二进制
pnpm exec tsx scripts/download-frp.ts
# → bin/frps + bin/frpc

# 2. 服务端：编辑 frp/frps.toml 修改 auth.token，启动 frps
./bin/frps -c frp/frps.toml
# 或设置 server.config.yaml 中 frp.mode=builtin 让服务端自动管理

# 3. 客户端 client.config.yaml 配置 frp 路径
# frp:
#   binPath: ./bin/frpc
#   workDir: ./frp

# 4. 启动 client 后，先通过 discovery 获取 clientHttpBaseUrl + clientHttpToken
curl http://server:3000/api/clients/my-client \
  -H "Authorization: Bearer <admin-or-agent-token>"

# 5. 直接调用 client HTTP 创建业务映射
curl -X POST http://your-server-ip:20003/frp/mappings \
  -H "Authorization: Bearer <client-http-token>" \
  -H "Content-Type: application/json" \
  -d '{"name":"web","type":"tcp","localHost":"127.0.0.1","localPort":3000}'

# 6. 访问公网地址
curl http://your-server-ip:20000
# 如果使用 http/https + customDomain，publicUrl 会按协议生成，例如：
#   http://preview.example.com
#   https://secure.example.com
#
# Web 控制台里的“检查注册”按钮会查询 frps dashboard API，
# 用于确认代理是否已注册到 frps，而不是判断业务端口是否可访问。
```

### 删除行为

删除业务映射时，系统现在会执行完整清理链路：

1. 删除 server 侧 `port_mappings` 记录
2. client 重写本地 `frpc` 配置并重载唯一 `frpc` 进程
3. 轮询 FRPS dashboard，等待目标代理变为 `offline` 或直接消失
4. 调用 FRPS `DELETE /api/proxies?status=offline`
5. 再次确认目标 `GET /api/proxy/<type>/<name>` 返回 `404`

因此，对调用方而言，`DELETE /frp/mappings/:id` 成功不再只是“本地配置已删除”，而是“对应代理已从 FRPS dashboard/API 中消失”，而不是长期停留在 `offline`。

### 穿透测试

```bash
# 自动启动服务端+客户端，创建映射，验证隧道连通
pnpm test:frp
pnpm test:frp:verbose
```

### 架构

```
外部用户 → frps(publicHost:remotePort / customDomain) → frpc(客户端) → localhost:3000
            ▲                                            ▲
            │ publicHost 用于外部访问                     │ connectHost 用于 frpc 连接 frps
            │ 独立部署或 builtin 模式                    │ Agent 自动管理
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
