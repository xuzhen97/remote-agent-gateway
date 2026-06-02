# 任务管理删除与批量删除设计

日期：2026-06-02  
状态：已确认设计，待实现计划  
范围：服务端任务删除 API、任务服务删除能力、Web 任务页单条删除与复选批量删除

## 1. 背景

当前项目的任务管理已经支持：

- 创建任务：`POST /api/tasks`
- 查询任务列表：`GET /api/tasks`
- 查询单个任务：`GET /api/tasks/:taskId`
- 查询任务日志：`GET /api/tasks/:taskId/logs`

任务页前端位于 `apps/server/src/web/index.html`，当前仅提供：

- 新建任务
- 刷新任务列表
- 查看任务日志

现有系统尚不支持：

- 单条删除任务
- 复选任务并批量删除
- 删除任务时级联删除对应日志

同时，任务结果与错误信息存储在 `tasks` 表记录中，任务日志存储在 `task_logs` 表中。因此“删除任务”不仅需要删除 `tasks` 记录，还必须同步删除 `task_logs`，否则会留下孤立日志数据。

## 2. 设计目标

### 2.1 功能目标

1. 在任务页支持单条删除任务。
2. 在任务页支持复选多个任务并批量删除。
3. 删除任务时同时删除：
   - `tasks` 表中的任务记录
   - `task_logs` 表中的对应日志记录
4. 批量删除后返回明确的删除统计结果。
5. 删除完成后任务页自动刷新，并清理前端选中状态。

### 2.2 已确认规则

1. 删除只影响平台中的任务记录、日志、结果、错误信息。
2. 删除不会向客户端发送取消指令。
3. 若任务已下发或正在客户端执行，删除行为仍然允许，但仅删除平台侧记录。
4. 任务被删除后，客户端后续若继续上报该任务的日志或结果，服务端应宽容处理，不因查不到任务而产生致命错误。

### 2.3 非目标

1. 本次不实现“取消任务”协议。
2. 本次不区分“软删除”和“硬删除”，统一为物理删除。
3. 本次不增加按状态筛选后批量删除、按时间清理历史任务等高级能力。
4. 本次不修改客户端任务执行器逻辑。

## 3. 总体方案

采用“后端单删接口 + 后端批量删除接口 + 前端复选框交互”的方案。

具体包含三层改动：

1. `tasks.service.ts`：新增单条删除和批量删除能力。
2. `tasks.routes.ts`：新增单条删除接口和批量删除接口。
3. `web/index.html`：任务表增加复选框、全选、单条删除、批量删除按钮及确认交互。

这样做的原因是：

- 单条删除和批量删除语义清晰，便于前端直接调用。
- 删除逻辑集中在服务层，便于测试和后续扩展。
- 前端只负责状态维护和交互，不内嵌数据库或删除规则。

## 4. 后端 API 设计

### 4.1 单条删除接口

新增：

```http
DELETE /api/tasks/:taskId
```

行为：

1. 先检查任务是否存在。
2. 若不存在，返回 `404`。
3. 若存在，删除该任务对应的所有 `task_logs`。
4. 再删除该任务记录。
5. 返回删除结果摘要。
6. 写入审计日志。

建议返回：

```json
{
  "taskId": "task_123",
  "deletedTask": true,
  "deletedLogs": 4
}
```

错误返回：

```json
{
  "error": "Task not found"
}
```

### 4.2 批量删除接口

新增：

```http
POST /api/tasks/bulk-delete
Content-Type: application/json
```

请求体：

```json
{
  "taskIds": ["task_1", "task_2", "task_3"]
}
```

行为：

1. 校验 `taskIds` 为非空数组。
2. 服务端去重，避免重复删除同一任务。
3. 删除这些任务对应的所有日志。
4. 删除这些任务记录。
5. 返回请求数量、实际删除任务数量、实际删除日志数量。
6. 写入审计日志。

建议返回：

```json
{
  "requested": 3,
  "deletedTasks": 3,
  "deletedLogs": 8
}
```

批量删除规则：

- 不因部分任务不存在而整体失败。
- 不存在的任务只是不计入 `deletedTasks`。
- 若 `taskIds` 为空或格式非法，返回 `400`。

### 4.3 审计日志

删除操作应写入 `audit_logs`，便于追踪后台人工管理行为。

建议：

- 单条删除：
  - `action = "task.delete"`
  - `targetType = "task"`
  - `targetId = <taskId>`
- 批量删除：
  - `action = "task.bulk_delete"`
  - `targetType = "task"`
  - `targetId = "bulk"`
  - `detail` 中写入任务数量和任务 ID 摘要

## 5. 服务层设计

文件：`apps/server/src/modules/tasks/tasks.service.ts`

### 5.1 新增能力

建议新增两个方法：

```ts
deleteTaskById(taskId: string): { deletedTask: boolean; deletedLogs: number };
deleteTasksByIds(taskIds: string[]): { deletedTasks: number; deletedLogs: number };
```

### 5.2 单条删除逻辑

`deleteTaskById(taskId)` 的行为：

1. 查询该任务是否存在。
2. 若不存在，返回 `deletedTask: false`、`deletedLogs: 0`，由路由层决定是否转成 `404`。
3. 删除该任务的日志：
   ```sql
   DELETE FROM task_logs WHERE task_id = ?
   ```
4. 记录日志删除条数。
5. 删除任务：
   ```sql
   DELETE FROM tasks WHERE id = ?
   ```
6. 返回统计结果。

### 5.3 批量删除逻辑

`deleteTasksByIds(taskIds)` 的行为：

1. 对 `taskIds` 去重并过滤空值。
2. 如果结果为空，直接返回零统计。
3. 用动态占位符删除日志，例如：
   ```sql
   DELETE FROM task_logs WHERE task_id IN (?, ?, ?)
   ```
4. 记录日志删除条数。
5. 删除任务：
   ```sql
   DELETE FROM tasks WHERE id IN (?, ?, ?)
   ```
6. 返回统计结果。

### 5.4 一致性原则

删除顺序固定为：

1. 先删 `task_logs`
2. 再删 `tasks`

这样做的目的是避免留下无主日志数据，并与现有 `deleteTasksByClientId()` 的清理方式保持一致。

## 6. 路由层设计

文件：`apps/server/src/modules/tasks/tasks.routes.ts`

### 6.1 单条删除路由

新增：

```ts
app.delete<{ Params: { taskId: string } }>('/api/tasks/:taskId', async (request, reply) => {
  ...
});
```

职责：

1. 读取 `taskId`
2. 调用 `tasksService.deleteTaskById(taskId)`
3. 若 `deletedTask === false`，返回 `404`
4. 写审计日志
5. 返回删除摘要

### 6.2 批量删除路由

新增：

```ts
app.post('/api/tasks/bulk-delete', async (request, reply) => {
  ...
});
```

职责：

1. 校验请求体为 `{ taskIds: string[] }`
2. 过滤空值并去重
3. 若去重后为空，返回 `400`
4. 调用 `tasksService.deleteTasksByIds(taskIds)`
5. 写审计日志
6. 返回删除摘要

### 6.3 宽容处理已删除任务的后续回传

当前 WebSocket 处理位于 `apps/server/src/ws/ws-handlers.ts`，任务日志与任务结果上报最终都会落到 `tasksService.addLog()` 和 `tasksService.updateTaskStatus()`。

本次不新增取消协议，因此要接受这样一种情况：

1. 平台已删除某任务。
2. 客户端仍继续执行。
3. 客户端回传同一 `taskId` 的日志或结果。

系统应避免因此报致命错误。若现有逻辑已经可容忍无记录更新，则保持现状；若日志写入会继续插入孤立记录，则实现阶段需要补充保护逻辑，例如：

- `addLog()` 前先确认任务存在，任务不存在则忽略日志；或
- 在 `ws-handlers.ts` 收到回传后，先检查 `getTask(taskId)`，不存在则直接忽略并记录低级别日志

这里的目标不是新增复杂状态，而是确保“删除运行中任务”不会破坏服务端稳定性。

## 7. 前端页面设计

文件：`apps/server/src/web/index.html`

### 7.1 任务表结构调整

任务表新增一列“选择”，并在操作列中新增“删除”按钮。

新表头建议为：

- 选择
- ID
- 客户端
- 类型
- 状态
- 结果
- 操作

表头第一列放“全选”复选框。

### 7.2 顶部操作区

在现有按钮区基础上新增：

- `删除选中` 按钮
- 文案包含当前选中数量，例如：
  - `🗑 删除选中 (0)`
  - `🗑 删除选中 (3)`

完整交互大致为：

- `+ 新建任务`
- `🔄 刷新`
- `🗑 删除选中 (N)`

### 7.3 前端状态管理

建议使用全局状态：

```js
window._selectedTaskIds = window._selectedTaskIds || []
```

或集合形式：

```js
window._selectedTaskIds = window._selectedTaskIds || new Set()
```

考虑到现有页面是纯内嵌脚本、非框架实现，推荐使用简单数组并通过辅助函数做去重和增删，避免 `Set` 在字符串模板和序列化中带来额外转换心智负担。

需要提供以下前端能力：

1. 切换单行选中状态
2. 全选当前列表
3. 取消全选当前列表
4. 计算当前选中数量
5. 列表刷新后清理不再存在的任务 ID

### 7.4 单条删除交互

每行新增“删除”按钮。

点击流程：

1. 弹出确认提示，例如：
   - `确定删除任务 task_xxx 吗？该操作会同时删除日志和结果。`
2. 确认后调用：
   - `DELETE /api/tasks/:taskId`
3. 成功后：
   - toast 提示成功
   - 从选中状态中移除该任务 ID
   - 刷新任务列表
4. 失败后：
   - toast 提示错误原因

### 7.5 批量删除交互

点击“删除选中”按钮流程：

1. 若未选中任何任务，toast：`请先选择任务`
2. 若已选中任务，弹出确认提示，例如：
   - `确定删除选中的 3 个任务吗？该操作会同时删除日志和结果。`
3. 确认后调用：
   - `POST /api/tasks/bulk-delete`
4. 成功后：
   - toast 提示实际删除数量
   - 清空选中状态
   - 刷新任务列表
5. 失败后：
   - toast 提示错误原因

### 7.6 空列表与部分删除场景

需要保证：

- 当任务列表为空时，不显示异常复选状态。
- 若前端选中了多个任务，但其中部分已被其他操作删除，批量删除仍可成功，且以服务端返回统计为准。
- 刷新列表后，前端要自动移除已不存在的选中 ID，避免按钮数量与列表不一致。

## 8. 错误处理

### 8.1 后端错误处理

1. 单删任务不存在：返回 `404`
2. 批量删除请求体非法：返回 `400`
3. DB 执行失败：返回 `500`
4. 批量删除中存在不存在任务：不作为错误，仅反映在统计结果中

### 8.2 前端错误处理

1. 网络失败：toast `删除失败，请稍后重试`
2. 400：toast `请求参数错误`
3. 404：toast `任务不存在或已删除`
4. 500：toast `服务端删除失败`

## 9. 测试策略

### 9.1 服务层测试

新增或补充 `tasks.service` 相关测试，覆盖：

1. 删除单个任务时，同时删除其日志
2. 删除单个任务时，不影响其他任务与日志
3. 批量删除多个任务时，同时删除对应日志
4. 批量删除时，忽略不存在任务 ID
5. 批量删除时，输入重复 ID 也不会重复计数

### 9.2 路由测试

新增或补充 `tasks.routes` 相关测试，覆盖：

1. `DELETE /api/tasks/:taskId` 成功返回 200
2. `DELETE /api/tasks/:taskId` 删除不存在任务返回 404
3. `POST /api/tasks/bulk-delete` 成功返回统计结果
4. `POST /api/tasks/bulk-delete` 空数组或非法 body 返回 400
5. 删除成功后写入审计日志

### 9.3 页面手工验证

实现完成后至少验证：

1. 任务页出现行复选框与表头全选
2. 单条删除可用
3. 批量删除可用
4. 批量删除按钮数量显示正确
5. 删除后列表刷新正常
6. 删除后日志按钮对应任务消失
7. 未选中任务时批量删除会提示
8. 删除运行中任务后，系统不会因为后续日志/结果回传而异常

## 10. 影响文件

预计修改：

- `apps/server/src/modules/tasks/tasks.service.ts`
- `apps/server/src/modules/tasks/tasks.routes.ts`
- `apps/server/src/web/index.html`
- `apps/server/src/ws/ws-handlers.ts`（仅当需要补“已删除任务回传忽略”保护时）

预计新增或修改测试：

- `apps/server/src/modules/tasks/tasks.service.test.ts`
- `apps/server/src/modules/tasks/tasks.routes.test.ts`
- 或按现有测试组织方式挂到已有服务端测试文件中

## 11. 实施建议

按 TDD 顺序推进：

1. 先补服务层删除测试
2. 实现服务层删除逻辑
3. 补路由测试
4. 实现路由
5. 最后改任务页前端交互
6. 做手工验证与回归验证

这样可以先把核心数据删除规则稳定下来，再做 UI，避免前端功能建立在不稳的接口之上。
