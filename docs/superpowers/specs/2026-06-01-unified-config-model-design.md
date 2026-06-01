# Remote Agent Gateway 配置统一化设计

## 1. 背景与问题

当前项目的配置方式分裂为两套：

- 服务端使用根目录 `.env`
- 客户端使用 `apps/client/config.json`
- `dist/` 分发产物也延续这一模式：
  - `dist/.env`
  - `dist/config.json`

这种混搭在当前阶段已经暴露出几个实际问题：

1. **配置来源分散**：排查问题时需要同时检查 `.env`、`config.json`、`config.example.json`、README、打包脚本。
2. **表达能力不一致**：服务端配置天然被限制在扁平 key/value；客户端配置支持数组与结构化字段，导致设计风格割裂。
3. **文档与分发流程复杂**：`README.md`、`scripts/build-all.ts`、`scripts/package.ts`、`scripts/e2e-test.ts` 都要分别处理两类配置。
4. **扩展成本高**：客户端已有 `allowedRoots`、`tags` 等结构化配置；服务端未来若新增复杂配置，也会继续挤压 `.env` 的可维护性。
5. **迁移和运维认知成本高**：新用户必须理解“server 改 `.env`，client 改 `config.json`”，学习成本偏高。

本设计目标不是简单替换文件后缀，而是建立一套**统一、可扩展、可分发、易文档化**的配置模型。

---

## 2. 设计目标

### 2.1 核心目标

1. **统一配置心智模型**：server/client 都采用单文件配置，不再出现 `.env + json` 混搭。
2. **保留部署现实**：server 和 client 仍各自维护自己的配置文件，不强行合并成一个总文件。
3. **提升可读性与可维护性**：配置支持注释、分组、数组、路径、结构化字段。
4. **统一加载与校验机制**：两端都使用“读取配置文件 → 解析 → Zod 校验 → 归一化”的相同流程。
5. **降低分发和测试复杂度**：构建脚本、启动脚本、E2E 测试、README 使用同一套配置约定。
6. **支持平滑迁移**：兼容旧 `.env` / `config.json` 一段时间，避免一次性破坏现有使用方式。

### 2.2 非目标

1. 本次不引入远程配置中心。
2. 本次不实现多环境配置继承（如 dev/staging/prod overlay）。
3. 本次不改变现有业务配置语义，只改变配置承载形式与加载方式。
4. 本次不强制把所有敏感信息移出本地文件；仅提供可选环境变量覆盖能力。

---

## 3. 已评估方案

### 方案 A：全部改成 `.env`

**结论：不推荐。**

原因：

- `.env` 不适合表达 `allowedRoots`、`tags`、端口范围、未来嵌套配置。
- Windows 路径和数组会变得难写、难读、难校验。
- 只会把“统一”变成“统一扁平化”，不是更好维护。

### 方案 B：根目录单一总配置文件

例如 `gateway.config.yaml`，内部区分 `server` 与 `client`。

**结论：不作为主方案。**

原因：

- 本地一体化开发体验好，但不符合实际部署场景。
- server/client 往往运行在不同机器，总配置文件不利于分发。
- 容易把服务端配置与客户端配置混在一起，增加泄漏与误配风险。

### 方案 C：server/client 各自单文件配置，统一格式与加载机制

**结论：推荐采用。**

原因：

- 符合实际部署形态。
- 消除 `.env + json` 混搭。
- 可读性强，支持注释、数组、结构分组。
- 能以最低认知成本统一 README、dist、测试与代码。

---

## 4. 最终设计

### 4.1 配置文件形态

引入两个新的主配置文件：

- `server.config.yaml`
- `client.config.yaml`

对应模板文件：

- `server.config.example.yaml`
- `client.config.example.yaml`

根目录开发模式：

- `./server.config.yaml`
- `./apps/client/client.config.yaml` 或 `./client.config.yaml`

分发模式 `dist/`：

- `dist/server.config.yaml`
- `dist/client.config.yaml`
- `dist/server.config.example.yaml`
- `dist/client.config.example.yaml`

**推荐落地路径：**

- 开发期保持：
  - `server.config.yaml` 放在仓库根目录
  - `apps/client/client.config.yaml` 放在 client 目录
- 分发期统一复制到 `dist/` 根目录，便于最终用户操作

这样兼顾源代码结构与分发体验。

---

### 4.2 为什么选择 YAML

选择 YAML 而不是 JSON/ENV，原因如下：

1. 支持注释，适合配置说明。
2. 支持数组和嵌套对象，天然适合 `allowedRoots`、`tags`、`frp.portRange`。
3. 对运维和人工编辑更友好。
4. 可以把 server/client 配置结构设计成统一风格。

本项目中 YAML 的主要价值是**可维护性**，不是技术炫技。

---

### 4.3 统一后的配置结构

#### 服务端配置示例

```yaml
server:
  host: 0.0.0.0
  port: 3000

auth:
  adminToken: change_me_admin_token
  agentApiToken: change_me_agent_token

storage:
  dbPath: ./storage/db.sqlite
  filesDir: ./storage/files

frp:
  mode: remote
  host: ""
  port: 7000
  token: change_me_frp_token
  dashboardPort: 7500
  binPath: ./bin/frps
  portRange:
    start: 20000
    end: 25000
```

#### 客户端配置示例

```yaml
client:
  id: dev-client-01
  name: Development Machine
  tags:
    - dev

server:
  wsUrl: ws://localhost:3000/ws/client
  apiBaseUrl: http://localhost:3000
  token: test_agent_token

workspace:
  dir: ./workspace
  allowedRoots:
    - ./workspace
    - D:/

frp:
  binPath: ./bin/frpc
  workDir: ./frp
```

### 4.4 字段映射原则

旧字段迁移到新结构时遵循以下规则：

#### Server

- `SERVER_HOST` → `server.host`
- `SERVER_PORT` → `server.port`
- `ADMIN_TOKEN` → `auth.adminToken`
- `AGENT_API_TOKEN` → `auth.agentApiToken`
- `DB_PATH` → `storage.dbPath`
- `STORAGE_DIR` → `storage.filesDir`
- `FRP_MODE` → `frp.mode`
- `FRPS_HOST` → `frp.host`
- `FRPS_PORT` → `frp.port`
- `FRPS_TOKEN` → `frp.token`
- `FRPS_DASHBOARD_PORT` → `frp.dashboardPort`
- `FRPS_BIN_PATH` → `frp.binPath`
- `FRP_PORT_RANGE_START` → `frp.portRange.start`
- `FRP_PORT_RANGE_END` → `frp.portRange.end`

#### Client

- `clientId` → `client.id`
- `clientName` → `client.name`
- `serverUrl` → `server.wsUrl`
- `apiBaseUrl` → `server.apiBaseUrl`
- `token` → `server.token`
- `workspaceDir` → `workspace.dir`
- `allowedRoots` → `workspace.allowedRoots`
- `frpcPath` → `frp.binPath`
- `frpcWorkDir` → `frp.workDir`
- `tags` → `client.tags`

这样可以把当前“扁平 server、半结构化 client”的模式，统一成“显式分组的结构化配置”。

---

## 5. 加载机制设计

### 5.1 统一加载生命周期

server/client 都采用相同的四阶段流程：

1. **定位配置文件**
2. **读取 YAML**
3. **Zod 校验**
4. **归一化/派生字段处理**

统一后的加载接口形态建议为：

- `loadServerConfig(configPath?: string)`
- `loadClientConfig(configPath?: string)`

### 5.2 配置文件查找规则

配置文件查找优先级建议如下：

#### Server

1. CLI 参数 `--config <path>`
2. 环境变量 `RAG_SERVER_CONFIG`
3. 当前工作目录 `server.config.yaml`
4. 向上递归查找 `server.config.yaml`
5. bundled/dist 当前目录中的 `server.config.yaml`
6. 兼容回退：旧 `.env`

#### Client

1. CLI 参数 `--config <path>`
2. 环境变量 `RAG_CLIENT_CONFIG`
3. 当前工作目录 `client.config.yaml`
4. 当前工作目录 `config.yaml`（仅兼容可选）
5. 向上递归查找 `client.config.yaml`
6. `apps/client/client.config.yaml`
7. bundled/dist 当前目录中的 `client.config.yaml`
8. 兼容回退：旧 `config.json`

### 5.3 环境变量覆盖策略

环境变量只作为**可选覆盖层**，不再作为主要配置来源。

建议只覆盖少量高变或敏感字段，例如：

#### Server override

- `RAG_SERVER_HOST`
- `RAG_SERVER_PORT`
- `RAG_ADMIN_TOKEN`
- `RAG_AGENT_API_TOKEN`
- `RAG_FRP_TOKEN`

#### Client override

- `RAG_CLIENT_WS_URL`
- `RAG_CLIENT_API_BASE_URL`
- `RAG_CLIENT_TOKEN`

原则：

- 不为每个字段都设计 override，避免重新变回 `.env` 心智模型。
- override 优先级高于 YAML 文件。
- README 中明确标注这是“高级用法”。

---

## 6. 兼容与迁移策略

### 6.1 迁移阶段

采用两阶段迁移：

#### Phase 1：兼容发布

- 默认优先读取 YAML 新配置。
- 如果 YAML 不存在，则回退到旧 `.env` / `config.json`。
- 启动时打印一次明确警告：
  - server: `Legacy .env config is deprecated; migrate to server.config.yaml`
  - client: `Legacy config.json is deprecated; migrate to client.config.yaml`
- README、示例、打包脚本全面切换到 YAML。

#### Phase 2：移除旧格式

- 在后续版本删除 `.env` / `config.json` 回退逻辑。
- 保留迁移脚本或迁移说明。

### 6.2 自动生成与模板策略

如果主配置文件不存在：

- server 从 `server.config.example.yaml` 复制生成 `server.config.yaml`
- client 从 `client.config.example.yaml` 复制生成 `client.config.yaml`

这延续当前“缺文件时自动复制模板”的体验，但模板命名更统一。

### 6.3 迁移脚本建议

增加一个脚本用于把旧配置迁移成新 YAML：

- `pnpm migrate:config`

功能：

1. 读取 `.env`
2. 读取 `apps/client/config.json`
3. 生成新 YAML 文件
4. 不覆盖已有新配置文件
5. 打印迁移摘要

这不是必须首发功能，但建议在兼容期尽快补上，可显著降低升级成本。

---

## 7. 代码结构调整建议

### 7.1 服务端

当前文件：

- `apps/server/src/config/env.ts`

建议重构为：

- `apps/server/src/config/server.config.ts`：YAML 加载、查找、兼容回退、Zod 校验
- `apps/server/src/config/server.config.schema.ts`：schema 与类型
- `apps/server/src/config/server.config.resolve.ts`：路径解析、override、兼容转换

`env.ts` 可以在兼容期保留为薄包装层，最终删除。

### 7.2 客户端

当前文件：

- `apps/client/src/config/client.config.ts`

建议拆分为：

- `apps/client/src/config/client.config.ts`：对外 `loadClientConfig`
- `apps/client/src/config/client.config.schema.ts`：schema 与类型
- `apps/client/src/config/client.config.legacy.ts`：旧 `config.json` 兼容转换
- `apps/client/src/config/config-path.ts`：查找规则与路径解析

### 7.3 共享能力

建议抽取一个轻量共享模块到 `packages/shared` 或本地 util：

- YAML 读取封装
- 通用配置查找工具
- 统一错误格式化

但不建议过度抽象到“万能配置框架”。本项目只需服务 server/client 两类配置。

---

## 8. 启动与分发流程调整

### 8.1 README

README 需要全面改为：

- server：复制 `server.config.example.yaml` 为 `server.config.yaml`
- client：复制 `client.config.example.yaml` 为 `client.config.yaml`
- 不再要求用户同时理解 `.env` 和 `config.json`

### 8.2 构建脚本 `scripts/build-all.ts`

需要调整：

- 复制 `server.config.example.yaml` 到 `dist/`
- 复制 `client.config.example.yaml` 到 `dist/`
- 若 `dist/server.config.yaml` 不存在且根目录配置存在，则可复制现有 server 配置
- 若 `dist/client.config.yaml` 不存在且 client 配置存在，则可复制现有 client 配置
- 不再把 `.env.example` 与 `config.example.json` 作为主模板

### 8.3 打包脚本 `scripts/package.ts`

需要调整：

- release 包保留 `server.config.example.yaml`
- release 包保留 `client.config.example.yaml`
- `DEPLOY.txt` 文案改为 YAML 配置说明
- 清理规则改为保留 `*.config*.yaml`

### 8.4 启动脚本

`start-server.bat/.sh`：

- 若无 `server.config.yaml` 则从 `server.config.example.yaml` 复制
- 提示用户编辑 YAML

`start-client.bat/.sh`：

- 若无 `client.config.yaml` 则从 `client.config.example.yaml` 复制
- 提示用户编辑 YAML

---

## 9. 测试设计

### 9.1 单元测试

需要新增/调整以下覆盖：

#### Server config tests

验证：

1. 正常加载 `server.config.yaml`
2. `--config` 优先级高于默认路径
3. `RAG_SERVER_CONFIG` 生效
4. 环境变量 override 生效
5. 旧 `.env` 兼容回退生效
6. `FRP_MODE=remote` 时 host 必填逻辑仍成立
7. 路径解析在 bundled 与源码模式下行为一致

#### Client config tests

验证：

1. 正常加载 `client.config.yaml`
2. `allowedRoots` 数组正确解析
3. `frp.binPath` 仍支持向上查找和 Windows `.exe` 补全
4. `--config` 与 `RAG_CLIENT_CONFIG` 优先级正确
5. 旧 `config.json` 兼容回退生效
6. override 正常覆盖 token / URL

### 9.2 E2E 测试

`scripts/e2e-test.ts` 需要调整为：

- 写入 `dist/server.config.yaml`
- 写入 `dist/client.config.yaml`
- 验证 server/client 在 YAML 模式下都能启动
- 兼容期可保留一组 legacy regression 测试，确保旧配置仍能运行

### 9.3 手动验证

必须覆盖以下场景：

1. 仓库开发模式启动 server/client
2. `dist/` 启动 server/client
3. Windows client 使用 `frpc.exe`
4. Linux/macOS client 使用 `frpc`
5. remote FRP 模式
6. builtin FRP 模式
7. 缺失配置文件时自动复制模板

---

## 10. 错误处理设计

统一后的配置错误要满足：**明确指出文件、字段、期望值、修复建议**。

### 10.1 错误示例要求

不应只报：

- `Invalid config`
- `ZodError`

应报成类似：

```text
Failed to load client config: D:/remote-agent-gateway/dist/client.config.yaml
- server.wsUrl: Expected valid URL
- server.token: Required
Tip: copy client.config.example.yaml and fill required fields.
```

### 10.2 兼容回退提示

当使用旧配置格式成功启动时，也要打印提示：

```text
Using legacy client config.json. Please migrate to client.config.yaml.
```

这能避免兼容层变成“永久隐形分支”。

---

## 11. 对现有行为的影响

### 会保持不变的部分

- 业务 API 不变
- WebSocket 协议不变
- FRP 功能语义不变
- `frpcPath` 的解析能力保留
- `resolveFrpsHost()` / `buildFrpPublicUrl()` 这类业务逻辑仍保留，只是从新配置对象取值

### 会改变的部分

- 配置文件命名
- README 操作步骤
- 构建产物中的模板文件
- E2E 测试写入配置的方式
- server/client 启动时的配置查找逻辑

---

## 12. 风险与控制

### 风险 1：YAML 解析引入新依赖

**控制：** 选择成熟、体积小、Node 生态常用的 YAML 库；只用于启动阶段，性能影响可忽略。

### 风险 2：兼容层让代码复杂化

**控制：** 明确兼容层是临时模块，集中在 `legacy` 文件中，不把兼容逻辑散落到业务代码。

### 风险 3：dist 与源码模式路径处理不一致

**控制：** 将“配置文件定位”和“相对路径解析”做成可单测的纯函数，重点覆盖 Windows 路径场景。

### 风险 4：用户升级时混用新旧配置

**控制：** 明确优先级与警告；README 只展示新方式；启动日志显式说明当前使用的配置文件路径与格式。

---

## 13. 推荐实施顺序

1. 新增 YAML 配置 schema 与加载器
2. 为 server/client 接入新加载器
3. 保留旧 `.env` / `config.json` 兼容回退
4. 更新单元测试
5. 更新 E2E 测试
6. 更新 `build-all.ts`、`package.ts`、启动脚本
7. 更新 README、`docs/TESTING.md`
8. 增加迁移说明或迁移脚本
9. 在后续版本删除 legacy 支持

---

## 14. 结论

本项目最合适的配置统一化方案是：

**server/client 各自一个单文件配置，统一采用 YAML 作为主配置格式，统一加载/校验/模板/分发流程，并在过渡期兼容旧 `.env` 与 `config.json`。**

这套方案兼顾了：

- 实际部署形态
- 可读性与扩展性
- 分发便利性
- 升级平滑性

相比“全部 `.env`”或“一个总配置文件”，这是当前项目成本最低、收益最高、后续最稳的一条路径。
