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
cp server.config.example.yaml server.config.yaml
# 编辑 server.config.yaml，至少修改：
# - auth.adminToken
# - auth.agentApiToken
# - frp.connectHost / publicHost / token / dashboard
# - clientHttp.tokenSecret

# 2. 配置客户端（另一台机器或本机）
cp client.config.example.yaml client.config.yaml
# 编辑 client.config.yaml，填写：
# - server.wsUrl
# - server.apiBaseUrl
# - server.token
# - workspace.allowedRoots
# - http.host / http.port

# 3. 一键启动 server + client
pnpm dev
# → server: http://127.0.0.1:3000
# → client: 注册并启动本地 HTTP control service

# 4. （可选）单独启动 React 前端开发服务
pnpm dev:web
# → http://127.0.0.1:5174
```

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
| `DELETE` | `/api/clients/:id/http/frp/mappings/:mappingId` | 通过 server 删除该 client 的业务映射 |
| `POST` | `/api/client-http/ports/allocate` | 为 client 业务映射分配端口（内部轻量分配接口） |
| `DELETE` | `/api/client-http/ports/:mappingId` | 删除业务映射记录（内部轻量删除接口） |

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
| `POST` | `/files/upload?rootId=...&path=...&filename=...` | 上传文件 |
| `POST` | `/files/mkdir` | 创建目录 |
| `DELETE` | `/files?rootId=...&path=...` | 删除文件或目录 |
| `POST` | `/files/move` | 移动/重命名 |
| `POST` | `/files/copy` | 复制文件或目录 |

#### FRP Mapping API

| 方法 | 路径 | 说明 |
|------|------|------|
| `GET` | `/frp/mappings` | 查看当前 client 的系统/业务映射 |
| `POST` | `/frp/mappings` | 创建业务映射 |
| `DELETE` | `/frp/mappings/:id` | 删除业务映射（系统 control 映射只读） |

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
├── server.config.example.yaml # 服务端配置模板
├── client.config.example.yaml # 客户端配置模板
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
├── server.config.example.yaml # 服务端配置模板
├── client.config.example.yaml # 客户端配置模板
├── start-server.bat / .sh # 启动脚本
└── start-client.bat / .sh # 启动脚本
```

### 部署服务端（公网机器）

```bash
# 1. 将 dist/ 上传到服务器
scp -r dist/ user@your-server:/opt/rag/

# 2. 配置
cd /opt/rag/dist
cp server.config.example.yaml server.config.yaml
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
cp client.config.example.yaml client.config.yaml
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
  binPath: D:/rag/bin/frpc.exe
  workDir: D:/rag/frp
```

### 容器化部署（可选）

```dockerfile
FROM node:22-alpine
WORKDIR /app
COPY dist/server.bundle.cjs .
COPY dist/sql-wasm.wasm .
COPY dist/server.config.example.yaml server.config.yaml
EXPOSE 3000
CMD ["node", "server.bundle.cjs"]
```

---

## AI Agent CLI (`rag`)

远程 Agent Gateway 为 AI Agent 提供了专用的 `rag` 命令行工具。Agent 通过它完成客户端发现、脚本执行、文件管理、FRP 隧道、审计历史查询等操作——**无需手写 curl 或直接拼 JSON payload**。

### 安装 CLI

CLI 源码位于 `apps/cli/`，提供多种使用方式。

#### 方式一：仓库内直接使用（无需额外安装）

```bash
# 构建
pnpm build:cli

# 直接运行
node bin/rag doctor
node bin/rag clients list
```

提供了跨平台 wrapper：

| 平台 | 命令 |
|------|------|
| Windows | `bin\rag.bat doctor` |
| Linux / macOS | `node bin/rag doctor` |

#### 方式二：配置 PATH 全局使用（推荐）

将 `bin/` 加入系统 PATH，或创建别名。

**Windows PowerShell** 添加到 PATH：

```powershell
$userPath = [Environment]::GetEnvironmentVariable("Path", "User")
$repoBin = "D:\remote-agent-gateway\bin"
[Environment]::SetEnvironmentVariable("Path", "$repoBin;$userPath", "User")
# 重启终端后生效
```

之后可直接执行：

```bash
rag doctor
rag clients list
```

Windows 上 `rag` 会通过 `rag.bat` 调用 Node。

**Linux / macOS** 添加到 PATH：

```bash
export PATH="/path/to/remote-agent-gateway/bin:$PATH"
```

或创建 shell alias：

```bash
alias rag="node /path/to/remote-agent-gateway/bin/rag"
```

#### 方式三：npm link 安装

```bash
cd apps/cli
pnpm link --global
rag doctor
```

### 配置

CLI 需要 server URL 和 token 才能操作。**环境变量是最推荐的方式**，对 AI Agent 最友好。

```bash
# 环境变量（推荐 ✅，Agent 无需手填）
export RAG_SERVER_URL=http://your-server:3000
export RAG_AGENT_TOKEN=your-agent-token
```

完整的配置解析顺序（高优先级覆盖低优先级）：

| 优先级 | 来源 | 示例 |
|--------|------|------|
| 1 | CLI flags | `rag --server http://... --token xxx doctor` |
| 2 | 环境变量 | `RAG_SERVER_URL`, `RAG_AGENT_TOKEN`, `RAG_ADMIN_TOKEN`, `RAG_AGENT_API_TOKEN`, `AGENT_API_TOKEN` |
| 3 | `.ragrc` 文件 | 当前目录或祖先目录 |
| 4 | `.env` 文件 | 当前目录或祖先目录 |
| 5 | `server.config.yaml` | `server.port` + `auth.agentApiToken` |

查看当前解析结果：

```bash
rag config show
# {"ok":true,"data":{"serverUrl":"http://localhost:3000","token":"test_age...oken","sources":{...}}}
```

Token 只会输出脱敏后的形式。

### 命令分组

CLI 围绕当前正式架构设计——先通过 server discovery 拿到 `clientHttpBaseUrl + clientHttpToken`，再直连 client HTTP 操作数据。

```text
rag
├── config show              查看配置（脱敏）
├── doctor [--client <id>]   诊断连通性
├── clients list             列出在线/离线客户端
├── clients get --client <id> 获取客户端详情（含 HTTP 直连信息）
├── jobs run|script|get|logs|events|cancel --client <id>  执行命令/脚本
├── files roots|list|stat|read|write|upload|download|mkdir|delete|move|copy --client <id>
├── frp list|create|delete --client <id>  FRP 端口映射
└── tasks list|get             审计历史
```

### 常用命令速查

```bash
# 诊断
rag doctor
rag doctor --client win-dev-01

# 客户端发现
rag clients list
rag clients get --client win-dev-01

# 远程执行命令
rag jobs run --client win-dev-01 -- node -v
rag jobs run --client win-dev-01 -- bash -c 'uname -a'
rag jobs script --client win-dev-01 --inline "console.log(process.platform)"
rag jobs script --client win-dev-01 --file ./deploy.sh --runtime bash
rag jobs get --client win-dev-01 --job job_abc123
rag jobs logs --client win-dev-01 --job job_abc123
rag jobs events --client win-dev-01 --job job_abc123     # SSE → JSON Lines
rag jobs cancel --client win-dev-01 --job job_abc123

# 文件管理
rag files roots --client win-dev-01
rag files list --client win-dev-01 --root root-0 --path .
rag files read --client win-dev-01 --root root-0 --path README.md
rag files read --client win-dev-01 --root root-0 --path README.md --raw   # 纯文本输出
rag files write --client win-dev-01 --root root-0 --path note.txt --content "hello"
rag files upload --client win-dev-01 --root root-0 --path . --file ./app.jar
rag files download --client win-dev-01 --root root-0 --path /tmp/report.pdf --output ./report.pdf
rag files mkdir --client win-dev-01 --root root-0 --path logs
rag files delete --client win-dev-01 --root root-0 --path temp --recursive
rag files move --client win-dev-01 --root root-0 --from a.txt --to b.txt
rag files copy --client win-dev-01 --root root-0 --from src --to backup --overwrite

# 端口映射
rag frp list --client win-dev-01
rag frp create --client win-dev-01 --name web --type tcp --local-port 3000
rag frp create --client win-dev-01 --name preview --type http --local-port 8080 --custom-domain preview.example.com
rag frp delete --client win-dev-01 --mapping pm_abc123

# 审计历史
rag tasks list
rag tasks list --client win-dev-01
rag tasks list --action file.write
rag tasks get --record rec_abc123
```

### 输出格式

默认 JSON，便于 AI Agent 稳定解析：

```json
{"ok":true,"data":{"id":"win-dev-01","status":"online"}}
```

失败输出：

```json
{
  "ok": false,
  "error": {
    "code": "HTTP_ERROR",
    "message": "Client not found",
    "status": 404
  }
}
```

特殊输出模式：

| 命令 | 模式 | 说明 |
|------|------|------|
| `files read --raw` | 纯文本 | 不包 JSON，直接输出文件内容 |
| `jobs events` | JSON Lines | 每行一个 JSON 事件对象 |

### 核心规则

AI Agent 使用时必须遵守以下规则——skill 中已内置这些指令：

- **每条操作命令必须显式 `--client <clientId>`**，CLI 不保存默认 client（避免 Agent 误操作到错误机器）。
- **解析 JSON 必须先检查 `ok`**，再读 `data` 或 `error`。
- **`jobs` 用于实时命令/脚本执行**，`tasks` 用于查询 server 端审计历史。
- **破坏性操作前必须向用户确认**：
  - `rag files delete ...`
  - `rag files write ...` 覆盖重要文件
  - `rag frp delete ...`
  - `rag jobs cancel ...`

### 架构对照

CLI 命令到实际 API 的映射详见 `skills/rag-agent/references/api-map.md`。核心理念：

```text
rag clients list           → GET  /api/clients（server 控制面）
rag clients get --client   → GET  /api/clients/:id（获取 clientHttpBaseUrl + token）
rag jobs/files/frp ...     → 直连 {clientHttpBaseUrl}/jobs/... /files/... /frp/...（数据面）
rag tasks ...              → GET  /api/tasks（server 审计镜像）
```

---

## 项目 Skill（给 AI Agent 的能力包）

项目自带的 Agent skill 源文件位于 `skills/rag-agent/`，包含：

```text
skills/rag-agent/
├── SKILL.md                        # 入口：规则、常用命令、工作流引导
└── references/
    ├── cli.md                      # 完整 CLI 命令参考 + JSON 输出示例
    ├── workflows.md                # 常见 Agent 工作流
    └── api-map.md                  # CLI 命令 ↔ 实际 API 映射
```

### 安装 Skill 到你的 AI Agent

**适用场景：** 你希望在 Pi Agent（或任何支持 Agent Skills 的工具）中加载该 skill，使 Agent 自动知道如何使用 RAG 平台。

```bash
pnpm install:pi-skill
```

这会将 `skills/rag-agent/` 复制到：

```text
~/.pi/agent/skills/rag-agent/
```

安装后**重启 Pi Agent 或重新加载 skills**，之后可以在对话中输入：

```text
/skill:rag-agent
```

Agent 将加载该 skill，按照 SKILL.md 中的规则使用 `rag` CLI。

### Skill + CLI 协作流程

一套典型的 Agent 工作流：

```text
1. 用户："帮我在远端 win-dev 上看看 D 盘有什么文件"
2. Agent 加载 rag-agent skill
3. Agent 执行 rag doctor                          → 确认连通性
4. Agent 执行 rag clients list                     → 选择目标 client
5. Agent 执行 rag files roots --client win-dev-01  → 获取可浏览的根目录
6. Agent 执行 rag files list --client win-dev-01 --root root-0 --path D:/ → 列出文件
7. Agent 解析 JSON 输出，将文件列表展示给用户
```

Skill 告诉 Agent 不要手写 curl、优先用 CLI、如何解析输出、何时需要用户确认——这些规则都在 `SKILL.md` 和 `references/` 中。

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

## 开发命令

```bash
pnpm dev               # 一键启动 server + client
pnpm dev:server        # 启动服务端（热重载）
pnpm dev:client        # 启动客户端（热重载）
pnpm dev:web           # 启动 React 管理台（Vite）
pnpm --filter @rag/shared test
pnpm --filter @rag/server test
pnpm --filter @rag/client test
pnpm --filter @rag/web test
pnpm typecheck         # 类型检查
pnpm build             # 编译所有包
pnpm build:dist        # 构建分发包
pnpm build:web         # 构建 React 管理台
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
- `frp.dashboard.scheme/host/port/user/password`：服务端查询 frps dashboard / API，用于确认代理是否已注册到 frps

`connectHost` 和 `publicHost` 可以相同，但它们不是同一个概念。

### 快速开始

```bash
# 1. 下载 FRP 二进制
pnpm download:frp
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
