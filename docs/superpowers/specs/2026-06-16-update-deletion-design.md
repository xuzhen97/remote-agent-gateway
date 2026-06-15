# 更新管理删除能力设计

- 日期：2026-06-16
- 项目：Remote Agent Gateway
- 状态：已完成头脑风暴，待用户 review

## 1. 背景

当前更新管理已支持：

- 版本发布（release）注册与 artifact 上传
- 更新编排（campaign）创建、启动、重试、查看状态

但缺少删除能力，导致：

- 错误发布的 release 不能清理
- 旧的或无效的 campaign 历史无法移除
- release 对应的 artifact 文件会持续堆积

本设计为更新管理增加删除能力，覆盖 Web 管理后台与 Server API，并明确删除规则、强制删除行为、级联删除边界以及数据/文件一致性策略。

## 2. 目标

### 2.1 功能目标

新增以下删除能力：

1. 删除 release：
   - 删除 release 数据记录
   - 删除该 release 对应的 artifact 文件目录
   - 向上清理空父目录，但不越过 `public/updates` 根目录
2. 删除 campaign：
   - 删除 campaign 数据记录
   - 级联删除关联 targets 与 attempts
3. 支持强制删除：
   - release 默认受引用关系保护
   - 用户确认后可强制删除，并级联删除引用它的非运行中 campaigns/targets/attempts
4. 对运行中 campaign 保持强保护：
   - 运行中的 campaign 永远不能删除
   - 即使是强制删除也不例外

### 2.2 一致性目标

删除应尽量满足“全成功，否则整体失败”：

- campaign 删除通过数据库事务实现
- release 删除通过“文件暂存 + 数据库事务 + 最终清理/回滚”实现近似事务化

## 3. 非目标

本次不包含：

- CLI 删除命令
- 删除审计、回收站、软删除
- 新的权限角色模型
- 异步后台删除任务系统
- 删除正在运行中的 campaign

## 4. 用户确认的关键决策

本设计基于以下已确认约束：

- 范围：仅做 **Web + Server API**
- 删除语义：**硬删除**
- release 强制删除：允许级联删除关联 campaign/targets/attempts
- 一致性策略：尽量 **全成功，否则整体失败**
- 运行中 campaign：**永远不能删**
- Web 交互：**列表页直接删除**，出现引用冲突时提供强制删除确认
- 鉴权：沿用现有后台更新管理入口，不引入新的细粒度角色模型
- 文件清理：删除 release 时删除版本目录，并清理空父目录，但不越过 updates 根目录

## 5. 当前系统上下文

当前相关模块：

- Server
  - `apps/server/src/modules/updates/release.routes.ts`
  - `apps/server/src/modules/updates/release.service.ts`
  - `apps/server/src/modules/updates/campaign.routes.ts`
  - `apps/server/src/modules/updates/campaign.service.ts`
  - `apps/server/src/modules/updates/update-repository.ts`
  - `apps/server/src/modules/updates/release-storage.ts`
- Web
  - `apps/web/src/api/updates.ts`
  - `apps/web/src/pages/UpdatesPage.tsx`

当前 release artifact 目录布局：

- release 根：`public/updates`
- artifact：`public/updates/artifacts/<version>/...`

数据库表：

- `update_releases`
- `update_campaigns`
- `update_targets`
- `update_attempts`

## 6. 可选方案与取舍

### 方案 A：在现有 service / route 上直接补删除逻辑

优点：改动少，交付快。

缺点：

- 删除校验、级联删除、文件系统协调、补偿逻辑会分散
- 难以维护“普通删除 / 强制删除 / 活动态拦截 / 一致性失败”这些规则

### 方案 B：新增专门删除协调层（选定）

优点：

- 删除规则集中
- 更适合处理 release 的跨 DB/文件系统一致性
- 更利于测试与后续维护

缺点：

- 比直接补代码多一层抽象

### 方案 C：异步删除任务化

优点：适合超大文件或长耗时删除。

缺点：对于当前需求明显过重，会把简单删除升级成一个任务编排系统。

### 选型结论

采用 **方案 B：新增专门删除协调层**。

## 7. 总体设计

### 7.1 新增服务

新增两个协调服务：

- `release-deletion.service.ts`
- `campaign-deletion.service.ts`

职责划分：

#### `campaign-deletion.service.ts`

负责：

- 查询 campaign 是否存在
- 判断 campaign 是否属于运行态
- 在事务内级联删除 attempts → targets → campaign
- 返回删除统计信息

#### `release-deletion.service.ts`

负责：

- 查询 release 是否存在
- 查询引用该 release 的 campaigns
- 判断是否存在运行中 campaign
- 区分普通删除与强制删除
- 处理文件目录暂存、回滚、最终清理
- 强制删除时级联清理关联 campaigns/targets/attempts
- 删除 release 数据记录并返回统计信息

### 7.2 运行态判断

删除规则中需要统一“运行中 campaign”定义。建议集中封装，不把判断散落在 routes / services 中。

运行中 campaign 至少包括：

- `server_updating`
- `client_updating`

以下状态可删除：

- `draft`
- `completed`
- `completed_with_errors`
- 以及其他终态（如未来新增）

建议提供统一辅助方法，例如：

- `isActiveCampaignStatus(status: string): boolean`

## 8. API 设计

### 8.1 删除 release

**Endpoint**

`DELETE /admin/updates/releases/:version?force=true|false`

**成功返回**

```json
{
  "ok": true,
  "data": {
    "version": "v1.4.0",
    "force": true,
    "deletedCampaignCount": 3,
    "deletedTargetCount": 15,
    "deletedAttemptCount": 42,
    "deletedArtifactDir": true
  }
}
```

**行为规则**

- release 不存在 → `404`
- 被运行中 campaign 引用 → `409`，且不可强制删除
- 被非运行中 campaign 引用：
  - 普通删除 → `409`
  - 强制删除 → 允许，并级联删除关联 campaign/targets/attempts
- 无引用 → 删除 release 数据与文件目录

### 8.2 删除 campaign

**Endpoint**

`DELETE /admin/updates/campaigns/:id?force=true|false`

**成功返回**

```json
{
  "ok": true,
  "data": {
    "campaignId": "camp_1",
    "force": false,
    "deletedTargetCount": 5,
    "deletedAttemptCount": 10
  }
}
```

**行为规则**

- campaign 不存在 → `404`
- campaign 运行中 → `409`
- campaign 非运行中 → 删除 campaign + targets + attempts
- `force=true` 仅用于接口风格统一，不突破“运行中不可删”规则

## 9. 错误码设计

为了让 Web 能区分“可强制删除”和“绝对不可删除”，后端应返回明确错误码。

建议至少包含：

- `RELEASE_NOT_FOUND`
- `RELEASE_IN_USE`
- `RELEASE_REFERENCED_BY_ACTIVE_CAMPAIGN`
- `CAMPAIGN_NOT_FOUND`
- `CAMPAIGN_ACTIVE_NOT_DELETABLE`
- `DELETE_CONSISTENCY_FAILED`

语义说明：

- `RELEASE_IN_USE`：存在非运行中引用，可提示用户强制删除
- `RELEASE_REFERENCED_BY_ACTIVE_CAMPAIGN`：存在运行中引用，不可继续
- `DELETE_CONSISTENCY_FAILED`：删除过程中的 DB / 文件系统协调失败，未达到预期一致性目标

## 10. 删除流程设计

### 10.1 campaign 删除流程

campaign 不涉及独立文件，可用纯数据库事务完成。

流程：

1. 查询 campaign
2. 若不存在，返回 `404`
3. 判断状态，若为运行中，返回 `409`
4. 查出该 campaign 的 targets
5. 查出 targets 对应的 attempts
6. 开启 DB 事务
7. 删除 attempts
8. 删除 targets
9. 删除 campaign
10. 提交事务
11. 返回删除统计

若事务中任何一步失败：

- 回滚事务
- 返回删除失败

### 10.2 release 删除流程

release 删除同时涉及 DB + 文件系统，采用协调式删除。

#### 阶段 A：预检查

1. 查询 release
2. 若不存在，返回 `404`
3. 查询引用该 release 的 campaigns
4. 判断是否存在运行中 campaign
5. 根据 `force` 参数决定：
   - 普通删除是否允许继续
   - 强制删除是否允许级联删除
6. 生成删除计划：
   - 要删除的 campaign IDs
   - 要删除的 target IDs
   - 要删除的 attempt IDs
   - 要处理的 artifact 目录路径

#### 阶段 B：文件暂存移走

将正式路径下的 artifact 目录从：

- `public/updates/artifacts/<version>`

原子 rename 到：

- `public/updates/.trash/<request-id>-<version>`

这样可确保：

- 资源先从正式访问路径移除
- 若后续 DB 删除失败，仍可 rename 回原位

若 artifact 目录不存在：

- 允许继续，不作为失败条件

#### 阶段 C：数据库事务删除

在文件已成功暂存后：

1. 开启 DB 事务
2. 若为强制删除，删除关联 attempts / targets / campaigns
3. 删除 release 记录
4. 提交事务

若事务失败：

- 将暂存目录 rename 回原目录
- 返回 `DELETE_CONSISTENCY_FAILED`

#### 阶段 D：文件最终清理

DB 提交成功后：

1. 物理删除 `.trash/<request-id>-<version>`
2. 向上清理空父目录
3. 停止于 `public/updates` 根目录，不越界删除

若最终清理失败：

- 接口返回失败
- 但正式路径已不可访问
- 临时 trash 路径保留，供人工或后续脚本清理

这是在跨 DB/文件系统条件下，对“全成功，否则失败”的最接近实现。

## 11. 文件清理规则

删除 release 时：

- 首要目标目录：`public/updates/artifacts/<version>`
- 完成删除后，向上清理空目录
- 但不删除 `public/updates` 根目录
- 不触碰无关目录

manifest 文件路径已由 `release-storage.ts` 预留；如果未来开始真正落盘 manifest 文件，删除流程应把 manifest 文件纳入同一 release 删除计划。

## 12. 数据层改动

需要为 `update-repository.ts` 增加删除与引用查询能力。

建议新增：

### release 相关

- `deleteRelease(version: string): number`

### campaign 查询相关

- `listCampaignsByTargetVersion(version: string): UpdateCampaignRecord[]`
- `deleteCampaign(id: string): number`
- `deleteCampaignsByIds(ids: string[]): number`

### target 相关

- `listTargetsByCampaignIds(campaignIds: string[]): UpdateTargetRecord[]`
- `deleteTargetsByCampaignIds(campaignIds: string[]): number`

### attempt 相关

- `deleteAttemptsByTargetIds(targetIds: string[]): number`

删除方法返回 count，便于：

- 前端成功提示
- 测试验证
- 后端日志诊断

## 13. 路由层改动

### `release.routes.ts`

新增：

- `DELETE /admin/updates/releases/:version`

需要支持：

- 读取 `force` query 参数
- 将删除请求转交 `releaseDeletionService`
- 将领域错误映射为 `404 / 409 / 500`

### `campaign.routes.ts`

新增：

- `DELETE /admin/updates/campaigns/:id`

需要支持：

- 读取 `force` query 参数
- 将删除请求转交 `campaignDeletionService`
- 将领域错误映射为 `404 / 409 / 500`

## 14. `main.ts` 组装改动

在 `main.ts` 中：

- 创建 `releaseDeletionService`
- 创建 `campaignDeletionService`
- 将其注入对应 routes

现有 release / campaign service 继续保留原有创建、查询、启动、重试职责，不把删除逻辑混入已有 service 的主路径。

## 15. Web 设计

### 15.1 API 层

在 `apps/web/src/api/updates.ts` 中新增：

- `deleteRelease(api, version, options?: { force?: boolean })`
- `deleteCampaign(api, id, options?: { force?: boolean })`

要求：

- 保留后端错误码和错误消息
- 让页面层能区分：
  - 普通失败
  - 可强制删除
  - 运行中不可删除

### 15.2 Release 列表交互

在 release 列表操作列新增“删除”按钮。

交互流程：

1. 用户点击删除
2. 弹出首轮确认（普通删除）
3. 调用普通删除接口
4. 若收到 `RELEASE_IN_USE`：
   - 弹出二次确认
   - 明确提示会级联删除关联 campaign/targets/attempts
   - 用户确认后发起 `force=true`
5. 删除成功后：
   - 刷新 release 列表
   - 若当前详情弹窗打开且对应被删 release，则关闭详情

### 15.3 Campaign 列表交互

在 campaign 列表操作列新增“删除”按钮。

交互流程：

1. 用户点击删除
2. 弹出确认框
3. 调用删除接口
4. 若收到 `CAMPAIGN_ACTIVE_NOT_DELETABLE`：
   - 提示不可删除
   - 不提供强制继续
5. 删除成功后：
   - 刷新 campaign 列表
   - 若当前 `selectedCampaign` 就是被删对象，则清空 `selectedCampaign / targets / attempts`

### 15.4 前端状态原则

无需引入新的全局状态管理。继续使用当前页面的：

- `useState`
- `load()` / `reload()`

只需保证：

- 删 release 后刷新 releases
- 删 campaign 后刷新 campaigns
- 删除当前选中对象时同步清空详情区

## 16. 测试设计

### 16.1 Server 测试

新增或补充测试：

- `release.routes.test.ts`
- `campaign.routes.test.ts`
- `release-deletion.service.test.ts`
- `campaign-deletion.service.test.ts`

重点覆盖：

1. release 普通删除成功
2. release 被非运行中 campaign 引用时返回 `RELEASE_IN_USE`
3. release 被运行中 campaign 引用时返回 `RELEASE_REFERENCED_BY_ACTIVE_CAMPAIGN`
4. release 强制删除成功并返回级联计数
5. release 文件暂存后，若 DB 事务失败，目录能恢复
6. campaign 删除成功
7. campaign 运行中时删除被拒绝
8. 删除不存在对象时返回 `404`

### 16.2 Web 测试

至少补充：

- `apps/web/src/api/__tests__/updates.test.ts`

建议覆盖：

- deleteRelease / deleteCampaign API 调用与 query 参数
- 错误码透传

如果页面测试基础设施成本可接受，可进一步补：

- release 删除 → 命中 `RELEASE_IN_USE` → 二次确认强制删除
- campaign 删除成功后清空当前详情区

## 17. 风险与约束

### 风险 1：DB 与文件系统无法做天然跨资源事务

缓解：

- 对 release 采用“rename 到 trash → DB 事务 → 最终清理/回滚”策略

### 风险 2：运行态定义未来扩展

缓解：

- 将运行态判断封装到统一辅助方法，避免散落条件分支

### 风险 3：最终清理阶段失败导致 trash 残留

缓解：

- 对外返回失败
- 但正式路径已移除，不会继续暴露旧 release
- 保留可诊断信息，后续可人工清理

## 18. 实施切分建议

建议按以下顺序实现：

1. 扩展 `update-repository.ts` 删除与引用查询能力
2. 实现 `campaign-deletion.service.ts` 与测试
3. 实现 `release-deletion.service.ts` 与测试
4. 扩展 `release.routes.ts` / `campaign.routes.ts`
5. 在 `main.ts` 中组装删除服务
6. 在 `apps/web/src/api/updates.ts` 增加删除 API
7. 在 `UpdatesPage.tsx` 的 release / campaign 列表上增加删除交互
8. 运行类型检查与测试验证

## 19. 验收标准

实现完成后应满足：

1. Web 可直接从 release 列表删除未被引用的 release
2. Web 在 release 被非运行中 campaign 引用时，可进行二次确认后强制删除
3. release 被运行中 campaign 引用时，普通删除和强制删除都失败
4. Web 可删除非运行中 campaign
5. 运行中的 campaign 无法删除
6. 删除 campaign 后，其 targets 与 attempts 一并删除
7. 删除 release 后，其 artifact 目录删除，并清理空父目录
8. 删除流程在关键失败点有明确错误码和可测试行为

## 20. 结论

本次设计选择“专门删除协调层”作为实现路径，以较小结构增量换取更清晰的规则管理与更可靠的一致性策略。

其核心原则是：

- 运行中 campaign 强保护，不可删除
- release 删除默认安全，强制删除显式确认
- campaign 删除用 DB 事务保证一致性
- release 删除用“文件暂存 + DB 事务 + 最终清理/回滚”实现近似事务化
- Web 保持简单直接的列表页删除体验

该设计已完成头脑风暴与用户确认，可进入 implementation plan 编写阶段，但尚未开始任何实现代码变更。
