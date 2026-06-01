# 服务端统一端口分配与自动映射生命周期设计

日期：2026-06-02  
状态：已确认设计，待实现计划  
范围：服务端 FRP 端口分配、Dashboard 交叉校验、client 自动文件 HTTP 映射生命周期管理

## 1. 背景

当前项目在 `apps/server/src/modules/frp/frp.service.ts` 中通过 `getNextAvailablePort()` 进行 remote port 自动分配。现有实现仅扫描 `port_mappings` 表并在配置范围内寻找第一个未记录的端口。

该实现存在以下问题：

1. 只检查本地 DB，不检查 FRPS 实际注册状态。
2. 若 FRPS Dashboard 上已有不受本系统管理的 proxy 占用端口，当前分配器无法识别，会产生冲突风险。
3. 当 Dashboard 暂时不可达时，系统缺少明确的降级和审计策略。
4. client 连接后没有自动建立文件 HTTP 服务的对外映射，后续操作链路较长。
5. client 异常下线时，若直接释放自动映射，可能导致 DB 与 FRPS 实际占用状态不一致。

本设计的目标是：

- 所有 remote port 分配统一由服务端管理。
- 在正常情况下通过 FRPS Dashboard 做交叉校验，确保分配的端口未被实际占用。
- Dashboard 不可达时允许降级为 DB-only 分配，但必须留下日志和审计痕迹。
- 自动为 client 建立文件 HTTP 服务映射，并以生命周期方式管理清理与重建。

## 2. 设计目标

### 2.1 功能目标

1. 所有 remote port 分配必须经过统一分配器。
2. 用户未指定 `remotePort` 时，由服务端在配置范围内自动分配。
3. 用户指定 `remotePort` 时，服务端必须先校验可用性，冲突时返回 409。
4. 分配器在正常情况下必须查询 FRPS Dashboard 上的 proxy 占用情况。
5. Dashboard 上发现端口被占用但 DB 中无记录时，必须跳过该端口并写入 `audit_logs`。
6. client 注册后自动启动文件 HTTP 服务并创建 FRP 映射。
7. client 下线后自动映射不能被过早释放，必须使用延迟清理机制。
8. client 再次上线时，应先清理旧的待清理自动映射，再创建新的自动映射。

### 2.2 非目标

1. 本次不处理 OS 级端口监听探测。
2. 本次不实现自动映射的通用 UI 管理界面。
3. 本次不实现周期性后台 reconcile job，仅保留手动触发接口和可扩展点。
4. 本次不改变现有 FRP probe、frps builtin 管理逻辑。

## 3. 总体架构

新增两个核心模块：

- `PortAllocatorService`：统一 remote port 分配与可用性校验。
- `AutoMappingService`：管理 client 上线/下线时的自动映射生命周期。

建议目录结构：

```text
apps/server/src/modules/
├── frp/
│   ├── frp.service.ts
│   ├── frp.routes.ts
│   ├── frps-dashboard.service.ts
│   ├── frps-manager.ts
│   └── frp-probe.service.ts
├── ports/
│   ├── port-allocator.service.ts
│   └── port-allocator.service.test.ts
└── auto-mapping/
    ├── auto-mapping.service.ts
    ├── auto-mapping.service.test.ts
    └── providers/
        └── file-http.provider.ts
```

依赖关系：

```text
ws-handlers.ts
  ├── auto-mapping.service.ts
  │     ├── port-allocator.service.ts
  │     ├── frp.service.ts
  │     └── tasks.service.ts
  └── client.register / handleWsClose 触发自动映射事件

frp.routes.ts
  └── frp.service.ts
        └── port-allocator.service.ts
```

关键原则：

- 任何 remote port 分配都不得绕过 `PortAllocatorService`。
- `FrpService` 负责映射 CRUD，不再内聚复杂的端口判定逻辑。
- 自动映射采用 provider 模式，为未来新增类似服务保留扩展点。

## 4. PortAllocatorService 设计

### 4.1 职责

`PortAllocatorService` 负责：

1. 分配可用 remote port。
2. 校验用户指定端口是否可用。
3. 统一聚合 DB 与 FRPS Dashboard 的占用信息。
4. 对异常场景做降级与审计。
5. 提供后续 reconcile 能力的扩展入口。

### 4.2 接口

```ts
class PortAllocatorService {
  allocate(clientId: string, options?: { preferredPort?: number }): Promise<number>;
  release(port: number): void;
  isAvailable(port: number): Promise<boolean>;
  getUsage(): Promise<PortUsageReport>;
  reconcile(): Promise<ReconcileResult>;
}
```

### 4.3 分配逻辑

#### 4.3.1 用户指定端口

当调用方传入 `preferredPort` 时：

1. 校验端口是否在 `frp.portRange` 范围内。
2. 检查 DB 中是否已有 `port_mappings.remote_port = preferredPort`。
3. 检查 Dashboard 中是否已有运行中的 proxy 占用该端口。
4. 若任一检查失败，返回 `409 Conflict`，并附带冲突来源。
5. 若全部通过，则允许使用该端口。

错误示例：

```json
{
  "error": "Remote port already in use",
  "source": "dashboard",
  "port": 23005
}
```

#### 4.3.2 自动分配端口

当未指定 `preferredPort` 时：

1. 从 `FRP_PORT_RANGE_START` 到 `FRP_PORT_RANGE_END` 顺序扫描。
2. 对每个候选端口执行检查链：
   - DB 检查：若 `port_mappings` 中存在该端口，直接跳过。
   - Dashboard 检查：若 Dashboard 可达且端口已被 proxy 占用，则跳过。
   - 若 Dashboard 显示端口占用，但 DB 中无对应记录，则写入 `audit_logs`，标记为外部占用，再跳过。
3. 找到第一个满足条件的端口后返回。
4. 若范围耗尽，则抛出 `NoAvailablePortError`。

### 4.4 Dashboard 查询策略

`frps-dashboard.service.ts` 需要新增批量查询方法，用于读取所有 proxy 的端口占用情况。

建议新增：

```ts
interface FrpsProxySummary {
  name: string;
  proxyType: 'tcp' | 'http' | 'https';
  remotePort?: number;
}

async function listAllProxies(...): Promise<FrpsProxySummary[]>;
```

实现策略：

- 分别请求：
  - `GET /api/proxy/tcp`
  - `GET /api/proxy/http`
  - `GET /api/proxy/https`
- 解析出所有可用于端口冲突判断的 `remotePort`
- 合并为 `Set<number>` 返回给分配器

### 4.5 Dashboard 缓存

为避免单次分配过程中重复请求 Dashboard，可在 `PortAllocatorService` 内做短时缓存：

- 缓存内容：Dashboard 上当前已占用的端口集合
- TTL：30 秒
- 单次 `allocate()` 扫描期间只读取一次

### 4.6 降级策略

若 Dashboard 不可达、认证失败或返回异常状态：

1. 输出 `console.warn`
2. 写入 `audit_logs`
   - `action = "port_allocator.dashboard_unreachable"`
   - `detail = "<scheme>://<host>:<port> unreachable, fallback to DB-only"`
3. 本次分配回退为 DB-only 检查

该策略优先保证系统可用性，同时为后续排障提供证据。

### 4.7 外部占用审计

若 Dashboard 上某端口被占用，但 DB 中无对应记录：

1. 视为外部系统或人工创建的 proxy 占用。
2. 跳过该端口，不做复用。
3. 写入 `audit_logs`
   - `action = "port_allocator.external_occupy"`
   - `detail = "port 23005 occupied on dashboard but not in DB"`

### 4.8 并发安全

端口分配需要防止并发请求拿到同一端口。

要求：

- 端口扫描与端口确认必须串行化。
- `allocate()` 内部使用服务级锁，保证同一时刻只有一个分配流程运行。
- `FrpService.createMapping()` 中“拿端口 + INSERT port_mappings”视作原子流程，不允许中间暴露给其他请求复用。

## 5. FrpService 调整

### 5.1 职责收敛

`FrpService` 保留以下职责：

1. 创建 mapping 记录。
2. 查询 mapping。
3. 更新 mapping 状态。
4. 删除 mapping。
5. 转换 API 返回结构。

端口分配从 `FrpService` 中抽离，不再直接实现 `getNextAvailablePort()`。

### 5.2 createMapping 行为

`createMapping(params)` 的行为调整为：

1. 若传入 `remotePort`：调用 `portAllocator.allocate(clientId, { preferredPort: remotePort })` 校验并确认。
2. 若未传入 `remotePort`：调用 `portAllocator.allocate(clientId)` 自动分配。
3. 用确认后的端口插入 `port_mappings`。
4. 生成 `public_url` 并返回 mapping。

### 5.3 deleteMapping 行为

删除时：

1. 调用原有删除逻辑删除 `port_mappings` 记录。
2. 调用 `portAllocator.release(remotePort)` 清理内存态缓存或预留信息。

> 说明：数据库中的“真正释放”仍以删除 `port_mappings` 记录为准，`release()` 主要用于辅助状态清理。

## 6. AutoMappingService 设计

### 6.1 设计目标

自动映射不是单一功能点，而是一类“client 生命周期驱动的自动代理能力”。因此采用 provider 模式，便于未来扩展类似服务。

### 6.2 Provider 接口

```ts
interface AutoMappingProvider {
  name: string;
  onClientOnline(clientId: string): Promise<{
    mappingId: string;
    localPort: number;
    name: string;
    proxyType: 'tcp' | 'http' | 'https';
  }>;
  onClientOffline(clientId: string, mappingId: string): Promise<void>;
}
```

### 6.3 Service 接口

```ts
class AutoMappingService {
  registerProvider(provider: AutoMappingProvider): void;
  onClientOnline(clientId: string): Promise<void>;
  onClientOffline(clientId: string): Promise<void>;
}
```

### 6.4 文件 HTTP 自动映射 Provider

首个 provider 为 `file-http.provider.ts`，负责：

1. 在 client 上线后启动文件 HTTP 服务。
2. 为该本地服务创建 FRP HTTP 映射。
3. 在 client 下线时标记清理状态。
4. 在 client 重连时先清理旧资源，再重建新资源。

### 6.5 自动映射状态表

新增表：

```sql
CREATE TABLE IF NOT EXISTS auto_mappings (
  id TEXT PRIMARY KEY,
  client_id TEXT NOT NULL,
  provider_name TEXT NOT NULL,
  mapping_id TEXT NOT NULL,
  status TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
```

字段说明：

- `provider_name`：例如 `file-http`
- `mapping_id`：关联 `port_mappings.id`
- `status`：`active | cleanup_pending`

## 7. 自动文件 HTTP 映射生命周期

### 7.1 client 上线流程

触发点：`ws-handlers.ts` 中 `client.register` 成功后。

流程：

1. `clientsService.upsertClient(info)`
2. `connectionManager.register(clientId, ws)`
3. `autoMappingService.onClientOnline(clientId)`
4. 文件 HTTP provider 执行：
   - 查询是否存在 `cleanup_pending` 的旧自动映射，若有则先执行清理流程
   - 创建 `file_service_start` 任务并下发到 client
   - 等待 client 返回文件服务本地端口
   - 调用 `portAllocator.allocate(clientId)` 分配 remote port
   - 调用 `frpService.createMapping()` 创建 `proxyType = "http"` 的映射
   - 创建 `frp_create_proxy` 任务并下发到 client
   - 在 `auto_mappings` 中写入记录，状态为 `active`
5. 返回 `server.ack`

推荐自动映射命名：

- `name = "auto-file-http"`
- `proxyType = "http"`
- `localIp = "127.0.0.1"`

### 7.2 client 下线流程

触发点：`handleWsClose(clientId)`。

流程：

1. `connectionManager.remove(clientId)`
2. `clientsService.setOffline(clientId)`
3. `autoMappingService.onClientOffline(clientId)`
4. 对该 client 的全部自动映射：
   - 将 `auto_mappings.status` 标记为 `cleanup_pending`
   - 写入审计日志：`action = "auto_mapping.cleanup_pending"`
5. 不立即删除 `port_mappings`
6. `saveDb()`

### 7.3 为什么不能立即释放端口

若 websocket 已断开，server 无法再给 client 下发 `frp_remove_proxy`。此时若直接删除 `port_mappings`：

- DB 会显示端口已释放
- 但 client 机器上的 frpc 可能仍在运行
- FRPS 上该 remote port 实际仍被占用
- 后续分配器可能错误复用此端口

因此，下线时必须采用延迟清理模型，而不是立即释放。

### 7.4 client 重连流程

当 client 再次上线时：

1. 先查询该 client 的 `cleanup_pending` 自动映射
2. 针对每条待清理记录：
   - 下发 `frp_remove_proxy`
   - 如有需要，下发 `file_service_stop`
   - 删除旧 `port_mappings`
   - 删除对应 `auto_mappings` 记录
3. 完成旧资源清理后，再执行新的自动文件 HTTP 映射创建流程

这样可以保证：

- 端口不会被过早释放
- DB 与 FRPS 实际状态保持安全一致
- 自动映射能够随着 client 生命周期完成自修复

## 8. 关键数据流

### 8.1 手动创建映射

```text
POST /api/port-mappings
  ├── frp.routes.ts 校验 payload
  ├── frpService.createMapping(...)
  │     └── portAllocator.allocate(...)
  ├── INSERT port_mappings
  ├── 下发 task: frp_create_proxy
  └── 返回 mapping
```

### 8.2 指定 remotePort

```text
POST /api/port-mappings { remotePort: 23001 }
  ├── portAllocator.allocate({ preferredPort: 23001 })
  │     ├── DB 冲突 → 409
  │     ├── Dashboard 冲突 → 409
  │     └── 可用 → 通过
  └── 后续流程同普通创建
```

### 8.3 自动文件服务映射

```text
client.register
  ├── clientsService.upsertClient(...)
  ├── connectionManager.register(...)
  ├── autoMappingService.onClientOnline(clientId)
  │     ├── task: file_service_start
  │     ├── client 返回本地 port
  │     ├── allocate remotePort
  │     ├── createMapping(name="auto-file-http", proxyType="http")
  │     └── task: frp_create_proxy
  └── server.ack
```

### 8.4 Dashboard 不可达

```text
allocate()
  ├── fetchDashboardProxyPorts()
  │     └── 失败
  ├── console.warn(...)
  ├── audit_log("port_allocator.dashboard_unreachable")
  └── fallback to DB-only
```

### 8.5 外部占用

```text
Dashboard 显示 port=23005 被占用
  ├── DB 无记录
  ├── audit_log("port_allocator.external_occupy")
  └── 跳过 23005，继续扫描
```

## 9. 错误处理策略

### 9.1 Dashboard 不可达

- 不阻断创建流程
- 降级为 DB-only 分配
- 记录 `console.warn`
- 写入 `audit_logs`

### 9.2 用户指定端口冲突

- 返回 409
- 返回来源：`db | dashboard`
- 返回冲突端口，便于前端提示

### 9.3 范围耗尽

- 返回明确错误：`No available ports in FRP range`
- HTTP 层建议映射为 409 或 507

### 9.4 自动映射失败

可能场景：

- `file_service_start` 超时
- client 未返回有效本地端口
- `frp_create_proxy` 失败
- Dashboard 校验失败

处理原则：

1. 不影响 `client.register` 成功。
2. 只记录日志与审计。
3. client 仍保持在线。
4. 允许未来增加后台重试或手动重建接口。

自动文件服务属于增强能力，不是 client 上线的硬依赖。

## 10. 数据库变更

### 10.1 新增 `auto_mappings`

见第 6.5 节。

### 10.2 保持 `port_mappings` 现有结构

本次不强制修改 `port_mappings` 表结构。

若未来需要区分手动映射与自动映射来源，可考虑增加：

- `source_type`：`manual | auto`
- `source_provider`：例如 `file-http`

但不作为本次实现前置条件。

## 11. 测试策略

### 11.1 PortAllocatorService 单元测试

覆盖：

1. DB 空 + Dashboard 空 → 分配第一个端口
2. DB 已占用 → 跳过
3. Dashboard 已占用 → 跳过
4. Dashboard 占用但 DB 无记录 → 跳过并写审计
5. Dashboard 不可达 → 降级并写日志/审计
6. `preferredPort` 可用 → 成功
7. `preferredPort` 冲突 → 返回 409
8. 范围耗尽 → 抛错
9. 并发两个 `allocate()` → 不会拿到相同端口

### 11.2 AutoMappingService 单元测试

覆盖：

1. `onClientOnline()` 能启动文件服务、分配端口、创建映射、记录 `auto_mappings`
2. `onClientOffline()` 能将映射标记为 `cleanup_pending`
3. client 再次上线时能先清理旧自动映射再重建新映射

### 11.3 集成测试

覆盖：

1. `POST /api/port-mappings` 通过 allocator 分配端口
2. 指定冲突端口返回 409
3. `client.register` 触发自动文件 HTTP 映射流程
4. `handleWsClose` 后自动映射进入 `cleanup_pending`
5. client 重连后旧映射被清理，新映射被创建

### 11.4 E2E 验证

建议场景：

1. 启动 server
2. 启动 client
3. client 注册后自动获得文件 HTTP 公网映射
4. 通过映射访问 `/v1/health` 成功
5. 再手动创建一个 mapping，验证 remote port 不冲突
6. 模拟 Dashboard 不可达，验证系统降级可用
7. 断开 client，验证自动映射进入 `cleanup_pending`
8. 重连 client，验证旧映射被清理、新映射被重建

## 12. 验收标准

1. 所有 remote port 分配统一经过 `PortAllocatorService`
2. 正常情况下会交叉校验 FRPS Dashboard
3. Dashboard 故障时服务不中断，但会留下审计痕迹
4. 不会把 Dashboard 上已被外部 proxy 占用的端口再次分配出去
5. client 上线后自动具备文件 HTTP 公网映射
6. client 异常下线不会导致端口被过早释放
7. client 重连后能完成旧自动映射清理与新映射重建

## 13. 实施建议

建议后续实现顺序：

1. 扩展 `frps-dashboard.service.ts`，增加批量查询 proxy 能力
2. 实现 `PortAllocatorService` 与对应单元测试
3. 重构 `FrpService` 使用分配器
4. 增加 `auto_mappings` 表迁移
5. 实现 `AutoMappingService` 与 `file-http` provider
6. 在 `ws-handlers.ts` 中接入 client 上下线自动映射事件
7. 补足路由/集成/E2E 测试

该顺序可以先建立端口分配正确性，再叠加自动映射生命周期逻辑，风险更低。