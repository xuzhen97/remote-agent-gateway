# Remote Agent Gateway — 部署与配置指南

> 面向 AI Agent 的远程机器控制、文件管理、端口映射平台。本文档覆盖从零到生产的完整部署流程。

---

## 目录

1. [架构概览](#架构概览)
2. [环境要求](#环境要求)
3. [FRP 公网穿透服务部署](#frp-公网穿透服务部署)
4. [Server 部署](#server-部署)
5. [Client 部署](#client-部署)
6. [配置参考](#配置参考)
7. [AI Agent 接入](#ai-agent-接入)
8. [生产环境建议](#生产环境建议)
9. [常见问题](#常见问题)

---

## 架构概览

```
┌──────────────────────────────────────────────────────┐
│                    AI Agent / CLI                     │
│              HTTP API (Bearer Token)                  │
└────────────────────────┬─────────────────────────────┘
                         │
┌────────────────────────▼─────────────────────────────┐
│              Server (公网机器)                         │
│  Fastify + WebSocket + SQLite + FRPS                 │
│                                                       │
│  端口 3000 — HTTP API (admin/agent 入口)              │
│  端口 7000 — FRPS 控制端口                            │
│  端口 7500 — FRPS Dashboard                          │
│  端口 20000-25000 — FRP 隧道端口                      │
│  /ws/client — WebSocket 长连接                        │
└──────┬───────────────────────────────────┬───────────┘
       │ WebSocket (客户端主动连接)          │
       ▼                                   ▼
┌──────────────┐                    ┌──────────────┐
│ Client A     │                    │ Client B     │
│ 执行脚本     │                    │ 执行脚本     │
│ 文件服务     │                    │ 文件服务     │
│ frpc 隧道    │                    │ frpc 隧道    │
└──────────────┘                    └──────────────┘
```

**核心概念**：
- **Server**：部署在公网机器上，提供 API 和 WebSocket 长连接，管理 frps
- **Client**：部署在目标机器上（无需公网 IP），通过 WebSocket 主动连接 Server，执行任务
- **FRP**：用于建立公网到客户端的隧道（文件服务、端口映射）
- **AI Agent**：通过 HTTP API 控制所有客户端

---

## 环境要求

| 组件 | 要求 | 说明 |
|------|------|------|
| Node.js | ≥ 22 | Server 和 Client 运行环境 |
| pnpm | ≥ 10 | 包管理器（也可用 npm） |
| frps | v0.69+ | FRP 服务端，部署在 Server 所在机器 |
| frpc | v0.69+ | FRP 客户端，部署在 Client 所在机器 |

---

## 部署方式选择

两种部署方式可选：

| 方式 | 适用场景 | 内容 |
|------|---------|------|
| **打包部署（推荐）** | 生产环境、分发到多台机器 | 构建 dist/ → 打包 → 上传到服务器 → 自动下载 FRP → 启动 |
| **源码部署** | 开发环境、需要修改源码 | git clone → pnpm install → 配置 yaml → 启动 |

下面先讲打包部署（推荐生产使用），源码方式留在后面各组件独立部署章节。

---

## 打包部署（推荐）

### 1. 在开发机上构建

```bash
# 安装依赖
pnpm install

# 构建 dist/ 目录（包含 server + client 打包文件 + 启动脚本 + FRP 下载脚本）
pnpm build

# 打包为发布包（自动包含 FRP 下载脚本）
pnpm package          # 当前平台
# 如需指定平台：pnpm exec tsx scripts/package.ts --win|--linux|--all
```

构建后的 `dist/` 目录内容：

```
dist/
├── server.bundle.cjs        # Server 单文件可执行
├── client.bundle.cjs        # Client 单文件可执行
├── sql-wasm.wasm            # SQLite 运行时
├── ecosystem.config.cjs     # PM2 进程管理配置 ⭐
├── start-server.sh / .bat   # Server 启动脚本（要求已提供 server.config.yaml）
├── start-client.sh / .bat   # Client 启动脚本（要求已提供 client.config.yaml）
├── download-frp.sh / .bat   # FRP 自动下载脚本 ⭐
└── web/                     # 管理控制台
```

打包后的发布包在 `release/` 目录，如 `rag-server-v0.1.0-linux.tar.gz`。

### 2. 部署到服务器

```bash
# 在目标服务器上
# 上传发布包（以 Linux Server 为例）
scp release/rag-server-v0.1.0-linux.tar.gz user@your-server:/opt/

# SSH 到服务器
ssh user@your-server
cd /opt
tar xzf rag-server-v0.1.0-linux.tar.gz
cd dist
```

### 3. 自动下载安装 FRP

dist/ 目录内置了 FRP 自动下载脚本，运行即可：

**Linux/macOS:**

```bash
# 下载 frps + frpc 到 ./bin/ 目录
./download-frp.sh

# 或者指定输出目录
./download-frp.sh /opt/frp
```

脚本会自动检测当前平台和架构，**默认通过国内加速镜像下载** v0.69.1 版本的 FRP。
如果所有镜像失败，会自动回退到 GitHub 直连。

**Windows:**

```cmd
download-frp.bat

REM 或指定目录
download-frp.bat D:\frp
```

下载完成后确认：

```bash
ls -la bin/frp*
# 应看到: frps, frpc
```

### 网络选项

**默认使用国内加速镜像**，无需额外配置。如需调整：

```bash
# 默认（镜像模式，适合国内服务器）
./download-frp.sh

# 直连 GitHub（海外服务器或镜像不可用时）
./download-frp.sh --direct

# 自定义镜像地址
FRP_MIRROR=https://ghfast.top/ ./download-frp.sh
```

**Windows:**

```cmd
REM 默认（镜像模式）
download-frp.bat

REM 直连 GitHub
download-frp.bat --direct

REM 自定义镜像
set FRP_MIRROR=https://ghfast.top/ && download-frp.bat
```

**内置镜像列表**（按优先级尝试）：

| 镜像地址 | 说明 |
|---------|------|
| `https://ghfast.top/` | ghproxy 加速 |
| `https://gh-proxy.com/` | ghproxy 备用 |
| `https://gh.llkk.cc/` | 第三方加速 |

> 如果以上镜像都不可用，可以自行搜索 "github 加速" 找到最新的可用地址，通过 `FRP_MIRROR` 环境变量指定。
>
> FRP 直链下载地址：`https://github.com/fatedier/frp/releases/tag/v0.69.1`

### 4. 配置并启动

#### 方式 A：PM2（推荐生产环境）

```bash
# 1. 安装 PM2
npm install -g pm2

# 2. 配置（首次）
# 在当前目录提供 server.config.yaml
vim server.config.yaml

# 如果也运行 client：
# 在当前目录提供 client.config.yaml
vim client.config.yaml

# 3. 下载 FRP
./download-frp.sh

# 4. 启动
pm2 start ecosystem.config.cjs

# 5. 确认运行
pm2 status
pm2 logs --lines 20
```

#### 方式 B：直接启动（开发/调试）

**Server：**

```bash
# 启动前先提供配置文件
vim server.config.yaml  # 修改 host, tokens, FRP 连接信息
./start-server.sh
```

**Client：**

```bash
# 同样，先下载 FRP
./download-frp.sh

# 启动前先提供配置文件
vim client.config.yaml  # 修改 server URL, token, workspace
./start-client.sh
```

### 5. 快速验证

```bash
# 访问管理控制台
curl http://<server-host>:3000

# 检查客户端连接状态
curl -H "Authorization: Bearer <adminToken>" \
  http://<server-host>:3000/api/clients
```

---

## 源码部署（开发/自定义场景）

以下各章节按组件拆分，适用于需要修改源码或分步部署的场景。

### FRP 下载（源码方式）

在源码项目中：

```bash
# 项目内置脚本（自动检测平台）
pnpm exec tsx scripts/download-frp.ts
```

手动下载（用于打包部署或无 pnpm 环境）：

---

## FRP 公网穿透服务部署

FRP 是整个系统的隧道层，用于让 AI Agent 直接访问客户端本地的文件服务和端口映射。

### 下载 frps（服务端）

在 Server 机器上：

```bash
# 下载 frp（以 linux/amd64 为例）
wget https://github.com/fatedier/frp/releases/download/v0.69.1/frp_0.69.1_linux_amd64.tar.gz
tar xzf frp_0.69.1_linux_amd64.tar.gz

# 复制 frps 到项目 bin 目录
cp frp_0.69.1_linux_amd64/frps /path/to/remote-agent-gateway/bin/frps
```

也可用项目内置脚本：
```bash
pnpm exec tsx scripts/download-frp.ts
```

### 配置 frps

创建 `frps.toml`（在项目根目录或 frps 工作目录）：

```toml
bindAddr = "0.0.0.0"
bindPort = 7000
kcpBindPort = 7000

auth.method = "token"
auth.token = "your_secure_frp_token"

# Dashboard（可选，建议开启用于监控和 agent unregistration 检测）
webServer.addr = "0.0.0.0"
webServer.port = 7500
webServer.user = "admin"
webServer.password = "your_dashboard_password"

# 允许的隧道端口范围
allowPorts = [
  { start = 20000, end = 25000 }
]
```

### 启动 frps

```bash
./bin/frps -c frps.toml
```

建议使用 systemd 或 pm2 守护进程。

### 防火墙配置

在 Server 机器上开放以下端口：

| 端口 | 用途 | 协议 |
|------|------|------|
| 7000 | FRPS 控制端口 | TCP |
| 7500 | FRPS Dashboard（可选） | TCP |
| 20000-25000 | FRP 隧道端口 | TCP |

---

## Server 部署（源码方式）

### 1. 获取代码

```bash
git clone <repo-url>
cd remote-agent-gateway
pnpm install
```

### 2. 配置 Server

编辑并提供 `server.config.yaml`：

```yaml
server:
  host: 0.0.0.0
  port: 3000

auth:
  adminToken: "your_secure_admin_token"    # ⚠️ 必须修改
  agentApiToken: "your_secure_agent_token" # ⚠️ 必须修改

storage:
  dbPath: ./storage/db.sqlite
  filesDir: ./storage/files

frp:
  mode: remote                     # 使用独立部署的 frps
  connectHost: "your-frps-host"   # frps 所在机器的 IP 或域名
  publicHost: "your-frps-host"    # 公网地址（用于生成 publicUrl）
  port: 7000
  token: "your_secure_frp_token"  # ⚠️ 必须与 frps.toml 一致
  dashboard:
    scheme: http
    host: "your-frps-host"
    port: 7500
    user: "admin"
    password: "your_dashboard_password"
  binPath: ./bin/frps
  portRange:
    start: 20000
    end: 25000
```

**FRP 模式说明**：

| 模式 | 适用场景 | frps 管理方式 |
|------|---------|-------------|
| `builtin` | 单机部署，Server 与 frps 同机 | Server 自动启动/管理 frps 进程 |
| `external` | frps 同机但手动管理 | 用户自行启动 frps，Server 不管理 |
| `remote` | frps 部署在独立机器（推荐生产） | frps 独立部署，Server 通过 API 连接 |

### 3. 启动 Server

```bash
# 开发模式
pnpm --filter @rag/server dev

# 生产模式
pnpm --filter @rag/server build
NODE_ENV=production node apps/server/dist/main.js
```

Server 启动后：
- HTTP API: `http://<server-host>:3000`
- 管理控制台: `http://<server-host>:3000`（同一地址，浏览器打开即见）

### 4. 验证 Server

```bash
# 访问管理控制台
curl http://localhost:3000

# 用 admin token 测试 API
curl -H "Authorization: Bearer your_secure_admin_token" \
  http://localhost:3000/api/clients
```

---

## Client 部署（源码方式）

### 1. 准备

在目标机器上（Linux/Windows/macOS），确保已安装 Node.js ≥ 22。

```bash
git clone <repo-url>
cd remote-agent-gateway
pnpm install
```

### 2. 配置 Client

编辑并提供 `client.config.yaml`：

```yaml
client:
  id: "prod-server-01"           # 唯一标识，建议用机器名
  name: "Production Server"      # 显示名称
  tags:
    - production
    - backend

server:
  wsUrl: "ws://<server-host>:3000/ws/client"  # Server 的 WebSocket 地址
  apiBaseUrl: "http://<server-host>:3000"     # Server 的 API 地址
  token: "your_secure_agent_token"            # ⚠️ 必须与 server.config.yaml 一致

workspace:
  dir: ./workspace               # 工作目录（客户端本地）
  allowedRoots:                  # AI Agent 可浏览的目录白名单
    - ./workspace
    - /home/user/projects
    # - D:/projects              # Windows 示例

frp:
  binPath: ./bin/frpc            # frpc 可执行文件路径
  workDir: ./frp                 # frpc 工作目录（放配置文件）
```

**关键配置说明**：

| 字段 | 说明 |
|------|------|
| `client.id` | 客户端的唯一标识，注册后不可更改 |
| `client.tags` | 标签，方便 Agent 按标签筛选目标机器 |
| `server.wsUrl` | Server 的 WebSocket 地址，Client 通过它保持长连接 |
| `server.token` | 必须与 Server 的 `agentApiToken` 一致 |
| `workspace.allowedRoots` | 安全白名单，AI Agent 只能访问这些目录 |

### 3. 下载 frpc

```bash
# 项目内置脚本
pnpm exec tsx scripts/download-frp.ts

# 或者手动下载
# Linux: wget https://github.com/fatedier/frp/releases/download/v0.69.1/frp_0.69.1_linux_amd64.tar.gz
# 解压后复制 frpc 到 bin/ 目录
```

### 4. 启动 Client

```bash
# 开发模式
pnpm --filter @rag/client dev

# 生产模式
pnpm --filter @rag/client build
NODE_ENV=production node apps/client/dist/main.js

# 或指定配置文件路径
RAG_CLIENT_CONFIG=/etc/rag/client.yaml node apps/client/dist/main.js
```

Client 启动后会自动：
1. 通过 WebSocket 连接到 Server
2. 注册自身信息（ID、名称、标签、OS 等）
3. 启动文件服务（供后续 AI Agent 文件操作使用）
4. 启动 frpc 连接 FRP 隧道

### 5. 验证 Client 连接

在管理控制台或 API 中确认客户端已在线：

```bash
curl -H "Authorization: Bearer your_secure_admin_token" \
  http://localhost:3000/api/clients | jq '.[].online'
```

---

## 配置参考

### Server 完整配置项

| 路径 | 类型 | 默认值 | 说明 |
|------|------|--------|------|
| `server.host` | string | `0.0.0.0` | 监听地址 |
| `server.port` | number | `3000` | HTTP/WS 端口 |
| `auth.adminToken` | string | **必填** | 管理员 token，访问管理 API |
| `auth.agentApiToken` | string | **必填** | Agent token，AI Agent 用此 token 调用 |
| `storage.dbPath` | string | `./storage/db.sqlite` | SQLite 数据库路径 |
| `storage.filesDir` | string | `./storage/files` | 服务端文件仓库路径 |
| `frp.mode` | enum | `remote` | `builtin` / `external` / `remote` |
| `frp.connectHost` | string | **必填** | frps 所在机器地址 |
| `frp.publicHost` | string | **必填** | 公网可访问地址（用于 publicUrl） |
| `frp.port` | number | `7000` | frps 控制端口 |
| `frp.token` | string | **必填** | frps 鉴权 token |
| `frp.dashboard.scheme` | string | `http` | frps dashboard 协议 |
| `frp.dashboard.host` | string | 同 connectHost | frps dashboard 地址 |
| `frp.dashboard.port` | number | `7500` | frps dashboard 端口 |
| `frp.dashboard.user` | string | `admin` | dashboard 用户名 |
| `frp.dashboard.password` | string | `admin` | dashboard 密码 |
| `frp.binPath` | string | `./bin/frps` | frps 可执行文件路径 |
| `frp.portRange.start` | number | `20000` | 可分配端口范围起始 |
| `frp.portRange.end` | number | `25000` | 可分配端口范围结束 |

### Client 完整配置项

| 路径 | 类型 | 默认值 | 说明 |
|------|------|--------|------|
| `client.id` | string | **必填** | 客户端唯一 ID |
| `client.name` | string | **必填** | 显示名称 |
| `client.tags` | string[] | `[]` | 标签（用于筛选） |
| `server.wsUrl` | string | **必填** | Server WebSocket 地址 |
| `server.apiBaseUrl` | string | **必填** | Server API 地址 |
| `server.token` | string | **必填** | Agent API Token |
| `workspace.dir` | string | **必填** | 客户端工作目录 |
| `workspace.allowedRoots` | string[] | `[]` | 可访问路径白名单 |
| `frp.binPath` | string | `./bin/frpc` | frpc 可执行文件路径 |
| `frp.workDir` | string | `./frp` | frpc 工作目录 |

### 环境变量覆盖

Server 配置可通过环境变量覆盖（优先级高于 YAML）：

| 环境变量 | 对应配置 |
|----------|---------|
| `RAG_SERVER_CONFIG` | 指定 server 配置文件路径 |
| `RAG_SERVER_HOST` | `server.host` |
| `RAG_SERVER_PORT` | `server.port` |
| `RAG_ADMIN_TOKEN` | `auth.adminToken` |
| `RAG_AGENT_API_TOKEN` | `auth.agentApiToken` |
| `RAG_FRP_TOKEN` | `frp.token` |

Client 配置可通过环境变量覆盖：

| 环境变量 | 对应配置 |
|----------|---------|
| `RAG_CLIENT_CONFIG` | 指定 client 配置文件路径 |
| `RAG_CLIENT_WS_URL` | `server.wsUrl` |
| `RAG_CLIENT_API_BASE_URL` | `server.apiBaseUrl` |
| `RAG_CLIENT_TOKEN` | `server.token` |

### API 鉴权模型

```
                   ┌──────────────┐
                   │ adminToken   │ → 管理控制台完全权限
                   │      │       │    (clients CRUD, tasks, files, ports)
                   │      ▼       │
                   │ agentApiToken│ → AI Agent 权限
                   │      │       │    (run-script, file-session, open-port, ...)
                   │      ▼       │
                   │ clientToken  │ → 客户端注册
                   └──────────────┘
```

---

## AI Agent 接入

### 1. 获取 Agent Token

Server 启动后，Agent Token 即配置文件中 `auth.agentApiToken` 的值。

### 2. 配置 AI Agent

为 AI Agent 设置环境变量或系统提示词：

```bash
export RAG_SERVER_URL="http://<server-host>:3000"
export RAG_AGENT_TOKEN="your_secure_agent_token"
```

### 3. Agent Skill 加载

项目内置 `.claude/skills/rag-agent/SKILL.md`，当 AI Agent 需要远程控制机器时会自动触发。

### 4. Agent 操作流程

```
1. GET  /api/agent/clients              → 查看在线机器列表
2. POST /api/agent/file-session         → 建立文件会话（获取 publicUrl + token）
3. 用 publicUrl 直连操作文件              → 文件数据不经过 Server
4. POST /api/agent/run-script           → 执行远程脚本
5. POST /api/agent/open-port            → 暴露端口
6. GET  /api/agent/tasks/:taskId        → 查看任务状态和日志
```

### 5. API 快速参考

完整 API 参考见 `.claude/skills/rag-agent/SKILL.md`。

**鉴权**：所有请求带 `Authorization: Bearer <agentApiToken>` 头。

| 端点 | 方法 | 说明 |
|------|------|------|
| `/api/agent/clients` | GET | 列出所有客户端 |
| `/api/agent/clients/:clientId` | GET | 获取单个客户端 |
| `/api/agent/file-session` | POST | 创建/复用文件会话 |
| `/api/agent/file-session` | DELETE | 停止文件会话 |
| `/api/agent/run-script` | POST | 执行脚本 |
| `/api/agent/push-file` | POST | 推送服务端文件到客户端 |
| `/api/agent/open-port` | POST | 创建 FRP 端口映射 |
| `/api/agent/close-port` | POST | 删除端口映射 |
| `/api/agent/tasks/:taskId` | GET | 查询任务状态 |

---

## 生产环境建议

### 网络拓扑

```
┌─────────────────────────────────────────────────┐
│          公网 (Public Internet)                   │
│                                                   │
│  ┌──────────────┐    ┌───────────────────────┐   │
│  │  AI Agent    │    │  Server (公网机器)      │   │
│  │  (任意位置)   │───→│  - HTTP API :3000     │   │
│  └──────────────┘    │  - FRPS :7000/:7500    │   │
│                      │  - 隧道 :20000-25000   │   │
│                      └──────┬────────────────┘   │
└─────────────────────────────│────────────────────┘
                              │
┌─────────────────────────────│────────────────────┐
│          内网 / NAT 后       │                     │
│                              ▼                     │
│  ┌──────────────┐    ┌──────────────┐             │
│  │ Client A     │    │ Client B     │             │
│  │ (主动 WS 连接)│    │ (主动 WS 连接)│             │
│  └──────────────┘    └──────────────┘             │
└───────────────────────────────────────────────────┘
```

### 安全建议

1. **修改所有默认 Token** — `adminToken`、`agentApiToken`、`frp.token` 使用强随机值
2. **HTTPS** — 生产环境使用 Nginx/Caddy 反向代理 Server 的 3000 端口，开启 TLS
3. **frps Dashboard** — 如果不需要，关闭 Dashboard 或使用强密码 + HTTPS
4. **防火墙** — 只开放必要端口（3000 通过反向代理、7000 仅供 client 连接）
5. **allowedRoots 白名单** — 客户端严格限制 Agent 可访问的目录
6. **环境变量覆盖** — 生产环境用环境变量注入敏感配置，不要将 token 写在配置文件中
7. **Token 轮换** — 定期更换 `agentApiToken` 和 `frp.token`

### 进程守护

#### PM2（推荐，Server + Client）

dist/ 目录内置了 `ecosystem.config.cjs`，一键管理所有进程：

```bash
# 安装 PM2
npm install -g pm2

# 启动全部（server + client）
pm2 start ecosystem.config.cjs

# 仅启动 server
pm2 start ecosystem.config.cjs --only rag-server

# 仅启动 client
pm2 start ecosystem.config.cjs --only rag-client

# 查看状态
pm2 status

# 查看日志
pm2 logs                # 全部
pm2 logs rag-server     # 仅 server
pm2 logs rag-client     # 仅 client

# 实时监控
pm2 monit

# 重启
pm2 restart all

# 停止
pm2 stop all

# 设置开机自启
pm2 save
pm2 startup              # 按提示复制粘贴命令
```

#### ecosystem.config.cjs 配置说明

| 配置项 | Server | Client | 说明 |
|--------|--------|--------|------|
| 内存上限 | 500M | 300M | 超限自动重启 |
| 日志位置 | `logs/server-*.log` | `logs/client-*.log` | 自动轮转 |
| 重启策略 | 崩溃自动重启 | 崩溃自动重启 | — |
| 环境变量 | `RAG_SERVER_CONFIG` | `RAG_CLIENT_CONFIG` | 指定配置文件路径 |

日志默认输出到 `logs/` 目录。可通过环境变量自定义：

```bash
PM2_LOG_DIR=/var/log/rag pm2 start ecosystem.config.cjs
```

#### systemd（frps）

frps 建议用 systemd 守护：

```ini
# /etc/systemd/system/frps.service
[Unit]
Description=FRP Server
After=network.target

[Service]
Type=simple
ExecStart=/opt/frp/frps -c /opt/frp/frps.toml
Restart=on-failure

[Install]
WantedBy=multi-user.target
```

```bash
sudo systemctl daemon-reload
sudo systemctl enable frps
sudo systemctl start frps
sudo systemctl status frps
```

### 数据备份

- **SQLite 数据库**：定期备份 `storage/db.sqlite`
- **文件仓库**：按需备份 `storage/files/`
- **配置**：备份 `server.config.yaml` 和 `frps.toml`

### 监控

- Server 健康检查：`GET http://<server>:3000/api/clients`（返回 200 即正常）
- Client 在线状态：通过 API 查询 `/api/agent/clients`，检查 `online` 字段
- frps Dashboard：`http://<server>:7500`（查看活跃代理和流量）
- 日志：Server 和 Client 均输出到 stdout，可用 pm2 logs 或重定向到文件

---

## 常见问题

### Client 连不上 Server？

1. 检查 Server 是否启动：`curl http://<server>:3000`
2. 检查 `client.config.yaml` 中 `server.wsUrl` 是否正确
3. 检查 `server.token` 是否与 Server 的 `agentApiToken` 一致
4. 检查防火墙是否放行 Server 端口（3000）

### 文件管理界面卡住？

1. 确认 Client 已在线且 frpc 已连接
2. 检查 frps Dashboard 看文件服务的代理是否已注册
3. 查看 Server 日志中的 `[file-session]` 信息
4. 如果 pre-created session 过期，Service 会自动重建（等待 2-5 秒）

### 端口映射不生效？

1. 检查 `frp.portRange` 范围内是否有可用端口
2. 检查 frps Dashboard 中的代理注册状态
3. 用 `/api/port-mappings/:id/check-registration` API 检查
4. 确认目标 client 的本地端口确实在监听

### 删除映射后 dashboard 里还残留 `offline`？

当前版本在删除业务映射时，会自动：

1. 删除 server 侧映射记录
2. 让 client 重建单一 `frpc` 配置/进程
3. 轮询目标代理在 FRPS dashboard 中的状态
4. 调用 FRPS `DELETE /api/proxies?status=offline` 清理离线残留
5. 确认目标代理查询返回 `404`

因此如果删除接口成功，目标代理应当从 FRPS dashboard/API 中消失，而不是长期保留为 `offline`。
如果仍然可见，请优先检查：

- `server.config.yaml` 中 `frp.dashboard.*` 凭据是否正确
- server 是否能访问 FRPS dashboard API
- 删除请求是否真正走到了当前版本的 server/client 代码

### AI Agent 无法访问直连 URL？

1. 确认 `frp.publicHost` 是公网可达的地址
2. 检查防火墙是否放行了隧道端口范围（20000-25000）
3. 如果是内网环境，Agent 可能需要在 Server 所在网络内

### 如何更换配置？

- **Server**：修改 `server.config.yaml` 后重启 Server
- **Client**：修改 `client.config.yaml` 后重启 Client
- **frps**：修改 `frps.toml` 后重启 frps
- 环境变量覆盖的值在重启后生效

### 如何升级？

**打包部署：**

```bash
# 1. 在开发机重新构建分发产物
pnpm build
pnpm package

# 2. 上传并解压到服务器
scp release/rag-server-*.tar.gz user@server:/opt/rag/
ssh user@server
cd /opt/rag
tar xzf rag-server-*.tar.gz -C dist/  # 替换 bundle 文件

# 3. 重启
pm2 restart all
pm2 logs --lines 20
```

**源码部署：**

```bash
# 拉取最新代码
git pull

# 重新安装依赖（如有新增）
pnpm install

# 重新编译工作区包
pnpm compile

# 重启服务
pm2 restart all
```
