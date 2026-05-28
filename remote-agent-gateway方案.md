# Remote Agent Gateway 方案设计

> 面向 AI Agent 的远程机器控制、文件分发、脚本执行和端口映射平台。  
> 适用场景：个人使用、小规模、纯 Node.js 技术栈、SQLite、本地客户端无公网、服务端有公网、通过 frp 实现临时端口映射。

---

## 1. 项目目标

本系统用于让 AI Agent、VCP、Codex 或其他自动化工具，通过统一的服务端 API 控制多台客户端机器，完成以下任务：

- 客户端注册与在线状态管理
- 文件上传到服务端
- 文件推送到指定客户端
- 上传 Node.js 脚本并在客户端执行
- 执行指定命令
- 通过 frpc/frps 创建临时端口映射
- 查询任务状态和实时日志
- 后续扩展部署、自动化运维、远程调试等能力

核心思路：

> 客户端没有公网，所以客户端主动连接服务端；服务端通过 WebSocket 长连接向客户端下发任务。

---

## 2. 总体架构

```mermaid
flowchart TB
    A[AI Agent / VCP / Codex / Web 控制台] -->|HTTP API| B[Server 服务端\n公网机器]

    B --> B1[Client Registry\n客户端注册中心]
    B --> B2[Connection Manager\nWebSocket 连接管理]
    B --> B3[Task Manager\n任务中心]
    B --> B4[File Manager\n文件中心]
    B --> B5[FRP Manager\n端口映射管理]
    B --> B6[Audit Manager\n审计日志]
    B --> DB[(SQLite)]
    B --> FS[(本地文件存储)]

    B2 <-->|WebSocket 长连接| C[Client Agent\n无公网客户端]

    C --> C1[Task Dispatcher\n任务分发器]
    C1 --> C2[Script Executor\n脚本执行器]
    C1 --> C3[Command Executor\n命令执行器]
    C1 --> C4[File Executor\n文件执行器]
    C1 --> C5[FRP Executor\nfrpc 管理器]

    C2 --> M[目标机器本地环境]
    C3 --> M
    C4 --> M
    C5 --> F[frpc]

    F -->|连接| G[frps\n公网服务器]
    G -->|暴露端口| H[外部访问者 / AI Agent]
```

---

## 3. 核心通信模型

### 3.1 为什么不让服务端直接请求客户端？

因为客户端通常在内网、NAT、家庭宽带、公司网络或安全组之后，没有公网 IP，服务端无法稳定主动访问客户端。

所以采用：

```mermaid
sequenceDiagram
    participant Client as Client Agent
    participant Server as Server 服务端
    participant Agent as AI Agent

    Client->>Server: 建立 WebSocket 长连接
    Client->>Server: 注册 clientId、hostname、os、tags
    Client->>Server: 周期性心跳
    Agent->>Server: HTTP API 创建任务
    Server->>Client: WebSocket 下发 task.dispatch
    Client->>Client: 执行任务
    Client->>Server: 回传 task.log
    Client->>Server: 回传 task.result
    Agent->>Server: 查询任务状态和日志
```

---

## 4. 技术选型

### 4.1 服务端

| 模块 | 技术 |
|---|---|
| 运行时 | Node.js 22+ |
| 语言 | TypeScript |
| HTTP 框架 | Fastify |
| WebSocket | ws 或 @fastify/websocket |
| 数据库 | SQLite |
| ORM | Drizzle ORM 或 better-sqlite3 |
| 参数校验 | Zod |
| 日志 | Pino |
| 文件上传 | @fastify/multipart |
| 进程管理 | PM2 / systemd / Docker |

### 4.2 客户端

| 模块 | 技术 |
|---|---|
| 运行时 | Node.js 22+ |
| 语言 | TypeScript |
| WebSocket 客户端 | ws |
| 执行命令 | child_process / execa |
| 文件操作 | fs-extra |
| 配置校验 | Zod |
| 系统信息采集 | systeminformation |
| 日志 | Pino |
| frp 管理 | 调用本地 frpc 二进制 |

### 4.3 内网穿透

| 模块 | 说明 |
|---|---|
| frps | 部署在公网服务端 |
| frpc | 部署在客户端机器，由 Client Agent 管理 |
| 映射方式 | MVP 阶段建议一个映射对应一个 frpc 进程 |

---

## 5. 项目结构

```text
remote-agent-gateway/
  package.json
  pnpm-workspace.yaml
  tsconfig.base.json

  apps/
    server/
      src/
        main.ts

        config/
          env.ts

        db/
          index.ts
          schema.ts
          migrations/

        modules/
          auth/
          clients/
          connections/
          tasks/
          files/
          scripts/
          frp/
          audit/

        routes/
          client.routes.ts
          task.routes.ts
          file.routes.ts
          frp.routes.ts
          agent.routes.ts

        ws/
          ws-server.ts
          protocol.ts

    client/
      src/
        main.ts

        config/
          client.config.ts

        core/
          register.ts
          heartbeat.ts
          connection.ts
          task-dispatcher.ts

        executors/
          exec-script.executor.ts
          exec-command.executor.ts
          push-file.executor.ts
          frp-create.executor.ts
          frp-remove.executor.ts

        services/
          file.service.ts
          script.service.ts
          frp.service.ts
          process.service.ts
          system.service.ts

        runtime/
          workspace.ts
          security.ts
          logger.ts

  packages/
    shared/
      src/
        types.ts
        protocol.ts
        schemas.ts

  storage/
    files/
    logs/
    db.sqlite

  frp/
    frps.toml

  docs/
    remote-agent-gateway方案.md
```

---

## 6. 服务端模块设计

```mermaid
flowchart LR
    API[HTTP API] --> Auth[Auth Module]
    API --> Clients[Clients Module]
    API --> Tasks[Tasks Module]
    API --> Files[Files Module]
    API --> FRP[FRP Module]
    API --> AgentAPI[Agent API Module]

    WS[WebSocket Server] --> Conn[Connection Manager]
    Conn --> Tasks

    Clients --> DB[(SQLite)]
    Tasks --> DB
    Files --> DB
    Files --> Storage[(storage/files)]
    FRP --> DB
    Auth --> DB
    AgentAPI --> Tasks
    AgentAPI --> Files
    AgentAPI --> FRP
```

### 6.1 Client Registry

负责：

- 保存客户端信息
- 更新在线/离线状态
- 记录心跳时间
- 通过 tags 筛选目标机器

### 6.2 Connection Manager

负责：

- 保存 clientId 与 WebSocket 连接的映射
- 客户端断开时标记 offline
- 服务端通过连接下发任务

### 6.3 Task Manager

负责：

- 创建任务
- 保存任务状态
- 下发任务
- 接收任务日志
- 接收任务结果

### 6.4 File Manager

负责：

- 接收文件上传
- 保存文件元数据
- 提供文件下载接口
- 计算 sha256

### 6.5 FRP Manager

负责：

- 创建端口映射记录
- 下发 frp_create_proxy 任务
- 删除端口映射
- 下发 frp_remove_proxy 任务

### 6.6 Audit Manager

负责记录：

- 谁创建了任务
- 谁上传了文件
- 谁打开了端口
- 哪台客户端执行了什么操作

---

## 7. 客户端模块设计

```mermaid
flowchart TB
    Start[Client 启动] --> Config[读取 config.json]
    Config --> Connect[连接服务端 WebSocket]
    Connect --> Register[注册客户端信息]
    Register --> Heartbeat[定时心跳]
    Register --> Listen[监听任务]

    Listen --> Dispatcher[Task Dispatcher]

    Dispatcher --> Script[ExecScriptExecutor]
    Dispatcher --> Command[ExecCommandExecutor]
    Dispatcher --> PushFile[PushFileExecutor]
    Dispatcher --> FrpCreate[FrpCreateProxyExecutor]
    Dispatcher --> FrpRemove[FrpRemoveProxyExecutor]

    Script --> Result[回传日志和结果]
    Command --> Result
    PushFile --> Result
    FrpCreate --> Result
    FrpRemove --> Result

    Result --> Listen
```

客户端配置示例：

```json
{
  "clientId": "win-dev-01",
  "clientName": "Windows Dev Machine",
  "serverUrl": "wss://your-server.com/ws/client",
  "apiBaseUrl": "https://your-server.com",
  "token": "client_secret_xxx",
  "workspaceDir": "D:/remote-agent/workspace",
  "frpcPath": "D:/remote-agent/bin/frpc.exe",
  "frpcWorkDir": "D:/remote-agent/frp",
  "tags": ["windows", "dev"]
}
```

Linux 客户端示例：

```json
{
  "clientId": "linux-01",
  "clientName": "Linux Server 01",
  "serverUrl": "wss://your-server.com/ws/client",
  "apiBaseUrl": "https://your-server.com",
  "token": "client_secret_xxx",
  "workspaceDir": "/opt/remote-agent/workspace",
  "frpcPath": "/opt/remote-agent/bin/frpc",
  "frpcWorkDir": "/opt/remote-agent/frp",
  "tags": ["linux", "test"]
}
```

---

## 8. SQLite 数据库设计

### 8.1 clients

```sql
CREATE TABLE clients (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  hostname TEXT,
  os TEXT,
  arch TEXT,
  version TEXT,
  tags TEXT,
  status TEXT DEFAULT 'offline',
  token_hash TEXT,
  last_seen_at INTEGER,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
```

### 8.2 tasks

```sql
CREATE TABLE tasks (
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
```

### 8.3 task_logs

```sql
CREATE TABLE task_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  task_id TEXT NOT NULL,
  stream TEXT NOT NULL,
  content TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
```

### 8.4 files

```sql
CREATE TABLE files (
  id TEXT PRIMARY KEY,
  original_name TEXT NOT NULL,
  stored_path TEXT NOT NULL,
  size INTEGER,
  sha256 TEXT,
  mime_type TEXT,
  created_at INTEGER NOT NULL
);
```

### 8.5 port_mappings

```sql
CREATE TABLE port_mappings (
  id TEXT PRIMARY KEY,
  client_id TEXT NOT NULL,
  name TEXT NOT NULL,
  proxy_type TEXT NOT NULL,
  local_ip TEXT NOT NULL,
  local_port INTEGER NOT NULL,
  remote_port INTEGER,
  custom_domain TEXT,
  status TEXT NOT NULL,
  public_url TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
```

### 8.6 audit_logs

```sql
CREATE TABLE audit_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  actor TEXT,
  action TEXT NOT NULL,
  target_type TEXT,
  target_id TEXT,
  detail TEXT,
  created_at INTEGER NOT NULL
);
```

---

## 9. 核心任务类型

```ts
type TaskType =
  | 'health_check'
  | 'exec_script'
  | 'exec_command'
  | 'push_file'
  | 'frp_create_proxy'
  | 'frp_remove_proxy';
```

任务状态：

```ts
type TaskStatus =
  | 'pending'
  | 'dispatched'
  | 'running'
  | 'success'
  | 'failed'
  | 'cancelled';
```

---

## 10. WebSocket 协议设计

### 10.1 客户端注册

```json
{
  "type": "client.register",
  "requestId": "req_001",
  "payload": {
    "clientId": "win-dev-01",
    "name": "Windows Dev Machine",
    "hostname": "DESKTOP-123",
    "os": "windows",
    "arch": "x64",
    "version": "0.1.0",
    "tags": ["windows", "dev"]
  }
}
```

### 10.2 客户端心跳

```json
{
  "type": "client.heartbeat",
  "payload": {
    "clientId": "win-dev-01",
    "cpu": 12.5,
    "memory": 62.3,
    "uptime": 123456
  }
}
```

### 10.3 服务端下发任务

```json
{
  "type": "task.dispatch",
  "requestId": "req_100",
  "payload": {
    "taskId": "task_001",
    "taskType": "exec_script",
    "payload": {
      "script": "console.log(process.platform)",
      "timeoutMs": 60000
    }
  }
}
```

### 10.4 客户端回传日志

```json
{
  "type": "task.log",
  "payload": {
    "taskId": "task_001",
    "stream": "stdout",
    "content": "win32\n"
  }
}
```

### 10.5 客户端回传结果

```json
{
  "type": "task.result",
  "payload": {
    "taskId": "task_001",
    "status": "success",
    "result": {
      "exitCode": 0,
      "durationMs": 238
    }
  }
}
```

---

## 11. 服务端 HTTP API 设计

### 11.1 客户端管理

```http
GET /api/clients
GET /api/clients/:clientId
```

### 11.2 任务管理

```http
POST /api/tasks
GET  /api/tasks
GET  /api/tasks/:taskId
GET  /api/tasks/:taskId/logs
```

创建任务示例：

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

### 11.3 文件管理

```http
POST /api/files
GET  /api/files
GET  /api/files/:fileId/download
```

### 11.4 端口映射

```http
POST   /api/port-mappings
GET    /api/port-mappings
DELETE /api/port-mappings/:mappingId
```

创建端口映射示例：

```json
{
  "clientId": "win-dev-01",
  "name": "local-web-preview",
  "proxyType": "tcp",
  "localIp": "127.0.0.1",
  "localPort": 3000,
  "remotePort": 23000
}
```

### 11.5 给 AI Agent 使用的高级 API

```http
POST /api/agent/run-script
POST /api/agent/push-file
POST /api/agent/open-port
POST /api/agent/close-port
GET  /api/agent/tasks/:taskId
```

示例：运行脚本

```json
{
  "target": {
    "clientId": "win-dev-01"
  },
  "script": "console.log('hello')",
  "timeoutMs": 60000
}
```

示例：打开端口

```json
{
  "clientId": "win-dev-01",
  "name": "preview",
  "localPort": 3000,
  "remotePort": 23000,
  "type": "tcp"
}
```

---

## 12. 文件传输流程

```mermaid
sequenceDiagram
    participant Agent as AI Agent
    participant Server as Server
    participant Client as Client Agent
    participant FS as Client Workspace

    Agent->>Server: POST /api/files 上传文件
    Server->>Server: 保存到 storage/files
    Server-->>Agent: 返回 fileId
    Agent->>Server: POST /api/tasks push_file
    Server->>Client: WebSocket 下发 push_file 任务
    Client->>Server: GET /api/files/:fileId/download
    Server-->>Client: 返回文件流
    Client->>FS: 写入 targetPath
    Client->>Server: 回传 task.log
    Client->>Server: 回传 task.result
```

---

## 13. 脚本执行流程

```mermaid
sequenceDiagram
    participant Agent as AI Agent
    participant Server as Server
    participant Client as Client Agent
    participant Node as Node.js 子进程

    Agent->>Server: POST /api/agent/run-script
    Server->>Server: 创建 exec_script 任务
    Server->>Client: WebSocket task.dispatch
    Client->>Client: 创建 workspace/tasks/{taskId}/script.js
    Client->>Node: spawn node script.js
    Node-->>Client: stdout/stderr
    Client->>Server: task.log 实时回传
    Node-->>Client: exitCode
    Client->>Server: task.result
    Agent->>Server: GET /api/tasks/:taskId/logs
```

脚本执行规则：

- 不使用 `node:vm` 作为安全沙箱
- 使用子进程执行
- 设置超时时间
- 限制日志大小
- 限制工作目录在 workspace 下
- 任务结束后可保留或清理任务目录

---

## 14. frp 端口映射流程

```mermaid
sequenceDiagram
    participant Agent as AI Agent
    participant Server as Server
    participant Client as Client Agent
    participant Frpc as frpc
    participant Frps as frps
    participant User as 外部访问者

    Agent->>Server: POST /api/agent/open-port
    Server->>Server: 创建 port_mapping 记录
    Server->>Client: 下发 frp_create_proxy 任务
    Client->>Client: 生成 frpc toml 配置
    Client->>Frpc: 启动 frpc -c mapping.toml
    Frpc->>Frps: 建立连接
    Client->>Server: 回传 publicUrl
    Server-->>Agent: 返回 publicUrl
    User->>Frps: 访问公网端口
    Frps->>Frpc: 转发流量
    Frpc->>Client: 转发到本地 localPort
```

---

## 15. frps 配置示例

`frps.toml`：

```toml
bindPort = 7000

auth.method = "token"
auth.token = "change_me_strong_token"

webServer.addr = "0.0.0.0"
webServer.port = 7500
webServer.user = "admin"
webServer.password = "change_me_admin_password"
```

公网服务器需要开放：

| 端口 | 用途 |
|---|---|
| 7000 | frpc 连接 frps |
| 7500 | frps Dashboard，可选，建议限制 IP |
| 20000-25000 | TCP 映射端口范围 |
| 80/443 | HTTP/HTTPS 映射，可选 |

---

## 16. frpc 动态配置示例

客户端根据任务生成：

```toml
serverAddr = "your-server-ip"
serverPort = 7000

auth.method = "token"
auth.token = "change_me_strong_token"

[[proxies]]
name = "win-dev-01-local-web-preview"
type = "tcp"
localIP = "127.0.0.1"
localPort = 3000
remotePort = 23000
```

启动：

```bash
frpc -c mapping-local-web-preview.toml
```

MVP 建议：

```text
一个端口映射 = 一个 frpc 配置文件 = 一个 frpc 进程
```

客户端保存：

```text
client-data/
  frp/
    mappings/
      map_001.toml
      map_002.toml
    pids/
      map_001.pid
      map_002.pid
```

---

## 17. 安全设计

### 17.1 基础认证

服务端 `.env`：

```env
ADMIN_TOKEN=change_me_admin_token
AGENT_API_TOKEN=change_me_agent_token
FRP_TOKEN=change_me_frp_token
```

AI Agent 调用 API：

```http
Authorization: Bearer change_me_agent_token
```

客户端连接服务端：

```text
wss://your-server.com/ws/client?clientId=win-dev-01&token=client_secret_xxx
```

服务端保存客户端 token 的 hash，不保存明文。

---

### 17.2 路径限制

MVP 阶段建议：

> 所有文件写入默认只能发生在 workspaceDir 下。

例如：

```text
D:/remote-agent/workspace/
/opt/remote-agent/workspace/
```

禁止客户端任务写入系统敏感目录。

Windows 禁止：

```text
C:\Windows
C:\Program Files
C:\Users\*\AppData\Roaming\Microsoft\Windows\Start Menu\Programs\Startup
```

Linux 禁止：

```text
/
/etc
/bin
/sbin
/usr/bin
/root
/boot
```

---

### 17.3 端口限制

只允许映射固定公网端口范围：

```text
20000-25000
```

默认禁止映射：

```text
22
3389
3306
5432
6379
```

---

### 17.4 脚本执行限制

建议默认限制：

| 项目 | 默认值 |
|---|---|
| 脚本最大大小 | 1MB |
| 最大执行时间 | 300 秒 |
| stdout/stderr 最大大小 | 5MB |
| 工作目录 | workspace/tasks/{taskId} |
| 默认权限 | 非管理员 / 非 root |
| 是否允许 shell | 默认关闭 |

---

## 18. MVP 开发路线

```mermaid
gantt
    title Remote Agent Gateway MVP 开发路线
    dateFormat  YYYY-MM-DD
    section 第 1 阶段
    服务端骨架 Fastify + SQLite + WebSocket :a1, 2026-01-01, 1d
    客户端连接注册和心跳 :a2, after a1, 1d

    section 第 2 阶段
    任务中心和 health_check :b1, after a2, 1d
    exec_script 脚本执行 :b2, after b1, 1d

    section 第 3 阶段
    文件上传和下载接口 :c1, after b2, 1d
    push_file 文件推送 :c2, after c1, 1d

    section 第 4 阶段
    frps 部署和 frpc 管理 :d1, after c2, 1d
    open-port / close-port :d2, after d1, 1d

    section 第 5 阶段
    AI Agent 高级接口整理 :e1, after d2, 1d
    审计日志和安全限制 :e2, after e1, 1d
```

> 上面的日期只是 Mermaid Gantt 图占位，实际开发时按阶段推进即可。

---

## 19. 第一版功能范围

第一版只做：

- 服务端公网部署
- 客户端主动连接服务端
- 客户端注册
- 在线/离线状态
- 创建任务
- 下发任务
- 执行 Node.js 脚本
- 实时日志回传
- 文件上传到服务端
- 文件推送到客户端 workspace
- 创建 TCP 端口映射
- 删除 TCP 端口映射
- SQLite 记录任务、日志、客户端、文件、端口映射
- Token 鉴权

第一版先不要做：

- 多用户系统
- 复杂权限系统
- 审批流
- 分布式队列
- Kubernetes
- 复杂 Web UI
- 复杂沙箱
- 多 frps 集群
- P2P 穿透

---

## 20. 推荐开发顺序

### 第一步：服务端骨架

实现：

```text
Fastify
SQLite
clients 表
tasks 表
WebSocket server
/api/clients
/api/tasks
```

目标：

```text
服务端可以启动
客户端可以连接
服务端可以看到客户端 online
```

### 第二步：客户端骨架

实现：

```text
读取 config.json
连接 WebSocket
注册客户端
定时心跳
监听 task.dispatch
回传 task.result
```

目标：

```text
服务端可以下发 health_check
客户端返回 success
```

### 第三步：脚本执行

实现：

```text
exec_script executor
写入 script.js
spawn node script.js
回传 stdout/stderr
回传 exitCode
```

目标：

```text
AI Agent 调用服务端 API
服务端下发任务
客户端执行 Node 脚本
服务端可以看到日志
```

### 第四步：文件上传和推送

实现：

```text
POST /api/files
GET /api/files/:id/download
push_file executor
sha256 校验
```

目标：

```text
上传一个 zip
推送到客户端 workspace
```

### 第五步：frp 映射

实现：

```text
frps 部署
frp_create_proxy
frp_remove_proxy
一个映射一个 frpc 进程
```

目标：

```text
客户端本地 3000 端口
映射到公网服务器 23000
外部可以访问
```

### 第六步：AI Agent API 整理

实现：

```text
POST /api/agent/run-script
POST /api/agent/push-file
POST /api/agent/open-port
POST /api/agent/close-port
GET  /api/agent/tasks/:id
```

目标：

```text
AI Agent 不需要理解底层 task 结构
只调用高层接口即可完成自动化动作
```

---

## 21. 最终结论

这个项目推荐采用：

```text
服务端：Fastify + WebSocket + SQLite + 本地文件存储
客户端：Node.js 常驻 Agent + WebSocket 主动连接 + 子进程执行任务
内网穿透：frps 公网部署 + 客户端动态启动 frpc
任务模型：所有操作统一抽象为 Task
AI 调用：只暴露高层 Agent API
```

最关键的设计原则：

> frp 只负责临时暴露端口，不负责主控制通道。主控制通道应该是客户端主动连服务端的 WebSocket 长连接。

