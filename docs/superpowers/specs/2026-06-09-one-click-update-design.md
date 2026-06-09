# 一键更新机制设计

日期：2026-06-09

## 背景

当前项目已经具备 server / client 的远程控制、任务执行、文件分发和状态上报能力，但缺少一套可恢复、可观测、可批量推进的发布更新机制。现有能力可以执行远程命令，但“远程执行几条升级脚本”并不能稳定解决以下问题：

- server 需要先更新自己，再继续编排 client 更新。
- client 运行环境包含 Linux server、Windows client、Linux client 的混合平台。
- 更新失败时不能因为一台机器失败而拖垮整体任务。
- Windows 上运行中的 client 不适合直接原地覆盖自身文件。
- 更新过程需要版本管理、完整性校验、状态记录、失败重试和审计能力。

因此，本设计把“一键更新”定义为一套 **server 编排的版本收敛系统**，而不是几条临时脚本。

## 目标

1. 支持从 **server 侧** 一键发起更新。
2. 更新顺序固定为：**先更新 server，再更新 clients**。
3. 发布形态为 **预构建包**，由 server 自己托管更新包。
4. 支持 **Windows client + Linux client** 混合平台更新。
5. client 更新失败时，**其余 client 继续推进**；失败项单独记录并支持重试。
6. 每台机器的更新过程具备清晰的阶段状态、错误分类和审计记录。
7. server 和 client 都采用 **本机 updater / launcher** 执行安全切换，而不是主进程直接覆盖自己。
8. 首版提供一个稳定、跨平台、可恢复、可观测的一键更新闭环。

## 非目标

1. 首版不做 Web 管理后台。
2. 首版不做自动灰度渠道、复杂分组、优先级 DAG 编排。
3. 首版不做离线 client 自动补偿；离线项先由人工重试。
4. 首版不做差分更新。
5. 首版不做全局强一致回滚；回滚以单机本地回滚为主。
6. 首版不做双人审批、复杂 RBAC 或完整离线签名体系。

## 术语

- **Release**：一个逻辑版本，例如 `v1.4.0`。
- **Artifact**：某个 release 下针对特定目标和平台的构建产物。
- **Manifest**：描述 release 与 artifact 元数据的版本清单。
- **Campaign**：一次整体更新任务，描述“把哪些机器更新到哪个版本”。
- **Target**：campaign 中的单个更新对象，例如 server 本机或某个 client。
- **Attempt**：某个 target 的一次具体更新尝试。
- **Updater**：执行本机下载、校验、切换、回滚的组件。
- **Launcher**：负责依据 current version 拉起主进程的组件或运行载体。

## 总体架构

系统包含四个核心角色：

1. **Update Orchestrator（server 编排器）**
   - 接收“一键更新到某版本”的请求。
   - 执行 precheck。
   - 先协调 server 自更新，再批量更新 clients。
   - 跟踪 campaign / target / attempt 状态。
   - 聚合结果、记录失败、支持重试。

2. **Artifact Repository（server 版本仓库）**
   - 保存 release manifest。
   - 保存 server Linux 包、client Windows 包、client Linux 包。
   - 提供受控下载接口。

3. **Local Updater / Launcher（本机更新器 / 启动器）**
   - 每台 server / client 本机的稳定执行单元。
   - 负责下载、校验、解压、切换版本、拉起新进程、必要时回滚。

4. **Main Server / Main Client（主业务进程）**
   - server 继续负责编排与控制面。
   - client 继续负责业务能力和心跳连接。
   - 主进程不直接承担复杂的自我替换逻辑。

## 关键设计原则

1. **编排与执行分离**：server 决策，updater 执行。
2. **版本不可变**：一个 release 发布后不覆盖修改，只新增新版本。
3. **切换优于覆盖**：新版本先准备好，再切换 current version。
4. **失败继续推进**：单机失败不阻塞其余 client。
5. **先 server，后 clients**：server 更新是整个 campaign 的中间阶段，而不是独立脚本。
6. **成功以回连验证为准**：不以“进程启动了”作为最终成功标准，而以“新版本重新连接并上报正确版本”为准。

## Release / Manifest / Artifact 模型

### Release 形态

每个逻辑版本对应多个平台产物，例如：

- `server-linux-x64`
- `client-windows-x64`
- `client-linux-x64`

未来如需 `arm64`，新增对应 artifact 即可。

### Manifest 建议字段

顶层字段：

- `version`
- `releaseTime`
- `notes`
- `minUpdaterVersion`
- `channel`
- `compatibleFrom`
- `artifacts[]`

每个 artifact 至少包含：

- `targetType`: `server` / `client`
- `platform`: `linux` / `windows`
- `arch`
- `fileName`
- `downloadPath`
- `sha256`
- `size`
- `entrypoint`
- `installerType`: `archive` / `binary`
- `mandatory`
- `enabled`

### Server 版本仓库布局

建议目录结构：

```text
/opt/rag/releases/
  manifests/
    v1.4.0.json
    v1.4.1.json
  artifacts/
    v1.4.0/
      server-linux-x64.tar.gz
      client-windows-x64.zip
      client-linux-x64.tar.gz
    v1.4.1/
      ...
```

版本仓库与运行目录分离。`releases/` 只保存产物和 manifest，不直接作为当前运行目录。

## 本机目录布局与切换模型

### Linux client

```text
/opt/rag-client/
  updater/
  versions/
    v1.3.0/
    v1.4.0/
  current -> versions/v1.4.0
  state/
    updater-state.json
    last-update.json
  downloads/
```

### Windows client

```text
C:\ProgramData\RagClient\
  updater\
  versions\
    v1.3.0\
    v1.4.0\
  state\
    current-version.json
    updater-state.json
    last-update.json
  downloads\
```

Windows 不强依赖符号链接。逻辑上保留 `current` 概念，具体实现可通过 `current-version.json` 指示 launcher 启动哪个版本目录。

### 切换流程

不在旧版本目录直接覆盖文件。标准流程为：

1. 下载新包到 `downloads/`
2. 校验 hash / size
3. 解压到 `versions/<targetVersion>/`
4. 执行安装后自检
5. 停止旧进程
6. 更新 `current` 指向或 current-version 状态
7. 启动新版本
8. 验证新版本已正确上线

## 回滚模型

首版不做全局强一致回滚，但每台机器必须具备 **本机局部回滚** 能力。

建议至少保留：

- 当前版本
- 上一个稳定版本

失败分两类：

1. **切换前失败**：下载、校验、解压失败
   - 不切换 current
   - 旧版本继续运行

2. **切换后失败**：新版本启动失败、健康检查失败、版本不匹配
   - 尝试切回上一稳定版本
   - 重新拉起旧版本
   - 上报 `rolled_back`

Target 最终状态应能区分：

- `succeeded`
- `failed_before_switch`
- `failed_after_switch`
- `rolled_back`

## Campaign / Target / Attempt 数据模型

### Campaign

表示一次整体升级任务，建议字段包括：

- `id`
- `targetVersion`
- `scope`（全部 client 或 client 集合）
- `includeServer`
- `batchSize`
- `maxConcurrency`
- `createdBy`
- `createdAt`
- `status`
- `summary`

### Target

表示 campaign 中的单个对象，建议字段包括：

- `id`
- `campaignId`
- `targetType`: `server` / `client`
- `clientId`（client 时）
- `platform`
- `currentVersion`
- `targetVersion`
- `phase`
- `attemptCount`
- `lastErrorCode`
- `lastErrorMessage`
- `startedAt`
- `finishedAt`

### Attempt

表示 target 的一次更新尝试，建议字段包括：

- `id`
- `targetId`
- `attemptNo`
- `phaseTimeline`
- `result`
- `errorCode`
- `errorMessage`
- `startedAt`
- `finishedAt`

Attempt 历史必须保留，不能被重试覆盖。

## 状态机设计

### Campaign 状态

- `draft`
- `prechecking`
- `server_updating`
- `client_updating`
- `completed`
- `completed_with_errors`
- `cancelled`

判定规则：

- 全部可执行目标成功且无离线跳过：`completed`
- 存在失败或离线跳过：`completed_with_errors`

### Target Phase

- `queued`
- `dispatched`
- `downloading`
- `downloaded`
- `installing`
- `installed`
- `restarting`
- `verifying`
- `succeeded`
- `failed`
- `rolled_back`
- `offline_skipped`
- `cancelled`

### 失败分类

建议结构化错误码至少包括：

- `DISPATCH_FAILED`
- `DOWNLOAD_FAILED`
- `HASH_MISMATCH`
- `INSTALL_FAILED`
- `STOP_FAILED`
- `START_FAILED`
- `VERIFY_TIMEOUT`
- `ROLLBACK_FAILED`

## 一键更新主流程

### 阶段 0：创建 Campaign

在 server 上发起：

- 目标版本
- 更新范围
- 批次大小
- 并发数

server 生成 campaign 和 target 清单。

### 阶段 1：Precheck

校验：

- release manifest 是否存在且完整
- server / windows client / linux client artifact 是否齐全
- hash / size 是否可用
- client 列表和平台信息是否可解析
- server 是否允许进入更新状态

precheck 失败则 campaign 终止，不进入实际更新。

### 阶段 2：Server Update

server 进入可恢复状态：

- 持久化 `campaignId`
- 持久化 `targetVersion`
- 标记 `server_updating`
- 保存上一稳定版本信息

随后把本机更新动作交给 **server-updater**：

- 下载 / 读取目标包
- 校验
- 解压
- 停旧 server
- 切换 current
- 启动新 server

### 阶段 3：Campaign 恢复

新 server 启动后：

- 读取未完成 campaign
- 校验自身运行版本是否等于目标版本
- 若成功，则推进 campaign 到 `client_updating`
- 若失败，则标记 server target failed / rolled_back

### 阶段 4：Client Rollout

server 对在线 client 按 **分批 + 批内并发** 推进：

- 按 client 平台选择正确 artifact
- 下发升级命令给各 client updater
- 收集阶段上报和最终结果
- 单机失败不阻塞其余机器

### 阶段 5：完成与重试

campaign 结束后：

- failed client 保留失败原因
- offline client 标记为 `offline_skipped`
- 支持手动重试 failed / offline_skipped

## 离线 Client 处理

离线 client 不记为失败，而记为 `offline_skipped`。原因是离线意味着“当前不可执行”，而不是“更新逻辑失败”。

首版策略：

- 在线 client：正常推进
- 离线 client：记录为 `offline_skipped`
- campaign 结束后由管理员手动重试

首版不做 client 上线自动补偿，以保持行为可控和实现边界清晰。

## Updater / Launcher 职责边界

### Orchestrator

负责：

- 决定更新哪些对象
- 决定批次、并发、重试
- 聚合状态与结果

不负责：

- 本机文件切换
- 本机进程替换细节

### Updater

负责：

- 下载或读取目标包
- 完整性校验
- 解压新版本目录
- 切换 current
- 启动新进程
- 本机回滚
- 更新本地状态文件

不负责：

- 选择 rollout 策略
- 决定是否继续推进其他机器

### Launcher / Service Manager

负责：

- 根据 current version 拉起真正的 server / client
- 维持进程运行环境

Linux 上可由 systemd 承载，Windows 上可由 service 或常驻守护进程承载，但设计抽象中把它们视为 launcher 运行载体，而不是更新逻辑本体。

## 控制面 API 与触发方式

首版由 **server 侧发起**，建议先提供：

1. **本地 CLI / 管理命令**
2. **server 内部 admin API**

### Release 管理 API

- `POST /admin/updates/releases`
- `GET /admin/updates/releases`
- `GET /admin/updates/releases/:version`

### Campaign API

- `POST /admin/updates/campaigns`
- `GET /admin/updates/campaigns`
- `GET /admin/updates/campaigns/:id`
- `POST /admin/updates/campaigns/:id/cancel`
- `POST /admin/updates/campaigns/:id/retry`

### Target / Attempt 查询 API

- `GET /admin/updates/campaigns/:id/targets`
- `GET /admin/updates/targets/:targetId`
- `GET /admin/updates/targets/:targetId/attempts`

### 受控下载接口

- `GET /updates/artifacts/:version/:artifactName`

该接口必须：

- 基于 client 身份鉴权
- 校验平台匹配
- 记录下载审计
- 不允许 client 下载不适用的包

## 权限与安全

### 管理权限

只有管理员才能：

- 上传 release
- 启用 / 禁用 release
- 发起 campaign
- 取消 / 重试 campaign

### Client 权限

client 只能：

- 查询自己可用的目标版本
- 下载自己的更新包
- 上报自己的更新状态

client 不能：

- 创建 campaign
- 修改 release
- 访问其他 client 的更新结果

### 完整性与真实性

首版必须：

- 使用 `sha256`
- 使用 `size`
- 下载后由 updater 强制校验

推荐后续增强：

- 对 release manifest 或 artifact 增加签名校验

## 审计设计

至少记录四类审计：

1. **Release 审计**
   - 谁上传/启用/禁用了哪个版本
2. **Campaign 审计**
   - 谁发起了哪次更新、目标版本、范围、批次参数
3. **Target / Attempt 审计**
   - 单台机器每次尝试的阶段变化、错误码、重试历史
4. **Artifact 下载审计**
   - 哪个 client 在何时下载了哪个包

## 成功判定

Target 只有在以下条件全部满足时才视为 `succeeded`：

1. updater 完成切换
2. 新进程已启动
3. 新 server / client 重新连接控制面
4. 上报版本号等于目标版本

否则应根据实际情况进入 `failed` 或 `rolled_back`。

## 测试策略

### 第 1 层：单元测试

覆盖：

- manifest 解析与平台匹配
- campaign / target / attempt 状态推进
- 重试规则
- 汇总统计
- 兼容性校验

### 第 2 层：updater 集成测试

覆盖：

- 下载后 hash 校验
- 解压到版本目录
- current version 切换
- 启动失败回滚
- 状态文件恢复

### 第 3 层：server 编排集成测试

覆盖：

- campaign 创建
- precheck
- server self-update 恢复
- client 分批调度
- failed / offline_skipped / succeeded 聚合
- retry 行为

### 第 4 层：端到端验证

至少验证：

1. server 成功更新，client 全部成功
2. server 成功更新，部分 Windows client 失败，其余继续
3. Linux client 成功，Windows client 失败后回滚
4. 部分 client 离线并被标记为 `offline_skipped`
5. 对 failed / offline_skipped 执行重试
6. 新 server 启动后恢复未完成 campaign

## 首版范围

### 首版必须有

- server 本地 release 仓库
- manifest 与 artifact 管理
- 受控下载接口
- sha256 校验
- client-updater 与 server-updater
- versions/current 切换模型
- campaign / target / attempt 持久化
- precheck → server update → client rollout 固定流程
- 分批 + 并发
- failed / offline_skipped 手动重试
- 基本审计与状态查询

### 首版不做

- Web 管理后台
- 自动灰度渠道
- 离线自动补偿
- 差分更新
- 全局自动回滚
- 双人审批
- 复杂分组与优先级编排

## 分阶段落地计划

### Phase 1：Release 基础设施

- 版本仓库目录
- manifest 解析与注册
- artifact 下载接口
- 完整性校验

### Phase 2：Client Updater 闭环

- Windows / Linux client-updater
- 版本目录切换
- 本机回滚
- 回连验证

### Phase 3：Server Self-Update 闭环

- server-updater
- server 启动恢复 campaign
- server 版本验证与回滚

### Phase 4：Campaign 编排

- campaign / target / attempt 模型
- 分批并发 rollout
- failed / offline_skipped 聚合
- retry 流程

### Phase 5：运维体验补强

- 查询命令
- 结果聚合视图
- 审计查看
- 未来 Web UI 对接同一套 API

## 风险与开放问题

1. **Server 自更新恢复点**：server 更新后必须可靠恢复未完成 campaign，否则整个编排链断裂。
2. **Windows 启动/停止细节**：Windows client 的 launcher / service 承载方式需要在实现阶段进一步细化。
3. **Updater 升级兼容性**：manifest 中的 `minUpdaterVersion` 需要在实现中严格校验，避免旧 updater 无法处理新 release。
4. **大规模分发压力**：server 自托管 artifact 时，后续可能需要限流、缓存或 CDN 作为增强项。
5. **签名体系**：首版只要求 hash / size，后续应评估 manifest 签名，以增强来源可信性。

## 最终建议

本项目的一键更新机制应正式定义为：

**Server-Orchestrated Release Campaign with Local Updater**

即：

- server 托管更新包
- server 发起一键更新
- 固定顺序为先 server、后 clients
- Windows / Linux client 统一通过本机 updater 完成版本切换
- 单机失败不阻塞整体推进
- 每台机器支持本机回滚
- 整个更新过程具备 campaign 级持久化、状态机、重试与审计能力

首版目标不是做成完整发布平台，而是做出一个：

**稳定、跨平台、可恢复、可观测、可批量推进的一键更新闭环。**
