# Web 客户端文件上传模式与阿里云中转进度设计

日期：2026-06-06

## 背景

当前 Web 控制台的“客户端文件管理”上传弹窗只支持现有直传分块上传：浏览器直接向 client HTTP 上传文件分片。系统虽然已经具备 server 协调的阿里云盘中转链路，但这条链路目前只在 CLI/skill 侧打通，Web 页面不能在上传时选择 `auto / aliyundrive / direct` 模式，也不能在阿里云中转场景下展示端到端传输进度。

这会带来两个问题：

1. Web 上传体验与 CLI 能力不一致。
2. 即使后端已经支持 transfer job 状态机，Web 用户也无法在上传弹窗里理解“浏览器上传完成”和“客户端最终落盘完成”之间的差异。

## 目标

1. 在“客户端文件管理 -> 上传文件”弹窗里新增上传模式选择：`自动（推荐）`、`阿里云中转`、`直传`。
2. Web 上传行为与 CLI 真实语义保持一致：
   - `auto`：优先尝试阿里云中转；若创建 transfer 阶段无法走阿里云，则自动回退直传。
   - `aliyundrive`：强制阿里云中转；若未配置/未授权或中途失败，直接报错。
   - `direct`：强制沿用现有浏览器 -> client HTTP 分块直传。
3. 当命中阿里云中转时，在上传弹窗中展示“总进度 + 分阶段明细”。
4. 进度展示要覆盖完整链路，而不只是浏览器本地上传分片：
   - 创建 transfer
   - 上传到阿里云
   - 客户端从阿里云下载
   - 客户端写入最终路径
5. 上传完成后自动刷新当前目录列表。
6. 错误提示必须能说明当前模式、失败阶段以及是否允许用户改用直传重试。

## 非目标

1. 本次不修改 CLI 参数或 CLI 输出格式。
2. 本次不重新设计 transfer 状态机或数据库结构。
3. 本次不实现“阿里云上传中途失败后自动切直传继续传”的复杂恢复逻辑。
4. 本次不新增独立的上传历史页；仅增强现有客户端文件管理上传弹窗。

## 用户交互设计

上传弹窗保留单一入口，不拆分为两个独立上传流程。弹窗包含以下区域：

1. 文件选择按钮
2. 上传模式选择器
   - 自动（推荐）
   - 阿里云中转
   - 直传
3. 上传进行中状态区
   - 顶部：一条总进度条 + 当前总状态文案
   - 下方：阶段列表，显示每个阶段的状态、百分比和说明
4. 上传完成或失败后的结果提示

### 总进度展示

用户选择 `aliyundrive` 或 `auto` 且实际命中阿里云时，弹窗需要同时展示：

- **总进度**：0% ~ 100%
- **总状态文案**：例如“正在创建传输任务”“正在上传到阿里云盘”“正在等待客户端下载”“客户端正在写入目标目录”“上传完成”

用户选择 `direct` 或 `auto` 实际回退到直传时，也统一使用同一弹窗，但阶段说明改为直传语义。

### 分阶段展示

阿里云中转模式下，阶段固定为：

1. 创建 transfer
2. 上传到阿里云
3. 客户端下载
4. 客户端写入完成

每个阶段有四种状态：

- 等待中
- 进行中
- 已完成
- 失败

其中：

- 上传到阿里云阶段显示已上传字节、总字节、速度、ETA、分片序号。
- 客户端下载阶段显示 `downloadedBytes / totalBytes`。
- 客户端写入阶段显示 `writtenBytes / totalBytes`；若暂时只有完成信号而没有连续写入进度，也要显示“正在写入”或“已完成”。

直传模式下的阶段渲染保持统一容器，但只展示与直传相关的有效阶段：

1. 准备上传
2. 直传到客户端
3. 写入完成

不会伪造阿里云下载阶段。

## 模式语义

### direct

继续使用现有 `uploadClientFile()` 前端分块上传 helper：

```text
browser -> client HTTP chunk upload -> client final file
```

页面使用现有分片进度信息更新总进度和阶段状态。

### aliyundrive

新增 Web 版阿里云中转上传 helper，流程与 CLI 对齐：

```text
browser
  -> POST /api/transfers/uploads
  -> PUT uploadParts[*].uploadUrl 到阿里云
  -> POST /api/transfers/:id/cli-progress
  -> POST /api/transfers/:id/cli-upload-complete
server
  -> 通知 client 下载
client
  -> 从阿里云下载并写入目标路径
web
  -> 轮询 GET /api/transfers/:id 获取进度直到 completed / failed
```

虽然接口名仍是 `cli-progress` / `cli-upload-complete`，但本次不重命名服务端协议，只在 Web 侧复用现有 transfer API。事件来源是否仍记录为 `cli` 不影响本次功能目标。

### auto

`auto` 模式按 server 返回结果决定实际路径：

- 如果 `POST /api/transfers/uploads` 返回 `mode: 'frps_chunked'`，则自动回退到现有直传 helper。
- 如果返回 `mode: 'aliyundrive'`，则进入阿里云中转流程。

**回退规则：**

- 仅当 **创建 transfer 阶段** 因 server 判断不可用而未进入阿里云链路时，允许自动回退直传。
- 一旦已经拿到阿里云上传计划并开始上传到阿里云，若中途失败，则直接报错，不再自动切直传。

页面需要在自动回退发生时展示明确文案，例如：

> 阿里云中转不可用，已自动回退为直传。

## 前端状态模型

为避免把多种上传模式的条件判断散落在 `ClientFilesPage.tsx` 中，本次新增统一的上传 UI 状态模型，例如：

- `requestedMode`: `auto | aliyundrive | direct`
- `resolvedMode`: `aliyundrive | direct | null`
- `transferId?: string`
- `overallPercent: number`
- `overallStatusText: string`
- `stages: UploadStageState[]`
- `fallbackMessage?: string`
- `errorMessage?: string`

`UploadStageState` 至少包含：

- `key`
- `label`
- `status`
- `percent?`
- `detailText?`

页面只负责渲染状态，不直接理解每种传输细节；具体进度映射由上传 helper 或页面内的状态转换函数统一生成。

## 总进度计算规则

### direct 模式

总进度直接跟随现有直传上传进度：

- 0%：开始前
- 1% ~ 99%：上传分片进行中
- 100%：client 完成写入并返回成功

### aliyundrive 模式

为了避免“浏览器上传到阿里云已经 100%，但客户端尚未落盘”导致误导，总进度采用阶段权重法：

- 创建 transfer：5%
- 上传到阿里云：55%
- 客户端下载：25%
- 客户端写入完成：15%

映射规则：

- 创建 transfer 完成后，总进度到 5%
- 阿里云上传阶段按 `uploadedBytes / totalBytes` 在 5% ~ 60% 区间内推进
- 客户端下载阶段按 `downloadedBytes / totalBytes` 在 60% ~ 85% 区间内推进
- 客户端写入阶段按 `writtenBytes / totalBytes` 在 85% ~ 100% 区间内推进
- 如果服务端当前仅能明确给出 `completed`，但未提供连续 `writtenBytes` 终值，则最终在 `completed` 时强制落到 100%

该权重不是精确吞吐占比，而是为了提供更符合用户感知的阶段性反馈。

## 错误处理

### auto 模式

- 创建 transfer 返回直传回退：不是错误，属于正常路径，要显示提示。
- 阿里云上传过程中失败：弹窗显示失败阶段和错误原因，并提示用户重新选择“直传”重试。
- client 下载或写入失败：显示 transfer 的 `errorMessage`。

### aliyundrive 模式

- 服务端未配置/未授权：立即失败。
- `POST /api/transfers/uploads` 创建成功后，阿里云上传中任何分片失败且重试耗尽：立即失败。
- `cli-upload-complete` 失败、client 下载失败、写入失败：都视为本次上传失败，并在弹窗中说明失败阶段。

### direct 模式

保持现有错误语义，继续显示分块上传失败信息。

## 代码结构设计

### 现有文件继续承担的职责

- `apps/web/src/pages/ClientFilesPage.tsx`
  - 负责上传弹窗 UI、模式选择、阶段展示、最终刷新目录
- `apps/web/src/pages/client-file-upload.ts`
  - 继续负责现有直传分块上传 helper

### 新增或扩展的职责

建议新增一个独立的 Web 阿里云中转上传 helper，而不是把 relay 流程堆进页面组件，例如：

- `apps/web/src/pages/client-file-relay-upload.ts`
  - 负责 `POST /api/transfers/uploads`
  - 负责浏览器向阿里云 PUT 分片
  - 负责上报 transfer 进度
  - 负责轮询 transfer 状态
  - 负责把底层状态转换为页面可用的阶段进度回调

也可以将其中的 transfer 轮询与进度映射再拆成小函数，但本次不强制抽离更多层次，只要求避免把整条 relay 流程写进 `ClientFilesPage.tsx`。

## 服务端复用边界

本次尽量复用现有 server transfer API，不新增新的核心后端协议：

- `POST /api/transfers/uploads`
- `GET /api/transfers/:transferId`
- `POST /api/transfers/:transferId/cli-progress`
- `POST /api/transfers/:transferId/cli-upload-complete`
- 如遇上传 URL 过期，可复用 `POST /api/transfers/:transferId/refresh-upload-url`

若测试发现 `refresh-upload-url` 在 Web relay 场景下仍返回空数组，则该接口需要在后续计划中补齐真实实现；但本次设计不额外扩展接口形态。

## 测试策略

必须采用 TDD，至少覆盖以下行为：

### Web 页面测试

1. 上传弹窗出现模式选择器，默认值为 `auto`。
2. 选择 `direct` 时，调用现有 `uploadClientFile()` helper。
3. 选择 `aliyundrive` 时，调用新的 relay upload helper。
4. 选择 `auto` 且 server 返回 `frps_chunked` 时，回退到直传 helper，并显示回退提示。
5. 选择 `auto` 且 server 返回 `aliyundrive` 时，进入 relay helper。
6. relay helper 回调的阶段状态能正确渲染到弹窗。
7. 上传成功后关闭弹窗并刷新目录。
8. relay 失败后在弹窗中显示错误信息，不自动切到直传。

### Relay helper 测试

1. 能正确调用 `POST /api/transfers/uploads`。
2. 收到阿里云上传计划后，按分片 PUT 到 `uploadUrl`。
3. 每次分片成功后，上报进度到 server。
4. 上传完成后调用 `cli-upload-complete`。
5. 轮询 transfer 状态直到 `completed`。
6. `auto` 命中 `frps_chunked` 时返回“回退直传”结果而不是误走 relay。
7. 中途失败时返回明确错误和失败阶段。

## 风险与权衡

1. 现有 server 进度接口命名带 `cli`，Web 复用时语义不完美，但为保持兼容，本次不改协议名。
2. 浏览器直接 PUT 到阿里云需要正确处理大文件分片与潜在 401/403 URL 过期；若现有 `refresh-upload-url` 未真正实现，则大文件长时间上传可能暴露问题，需要在实现阶段以测试验证。
3. transfer 的 `writtenBytes` 可能不是持续精确更新，因此最终 100% 以 `completed` 状态为准。
4. 页面上传弹窗既承载直传又承载 relay，会增加状态复杂度，因此必须通过统一状态模型收敛逻辑，避免组件内分支膨胀。

## 验收标准

1. Web 客户端文件管理上传弹窗可选择 `auto / aliyundrive / direct`。
2. `direct` 继续正常上传且显示进度。
3. `aliyundrive` 能走 server 协调的阿里云中转链路，并显示总进度 + 分阶段进度。
4. `auto` 在创建阶段可自动回退直传，并向用户展示回退原因。
5. 阿里云链路一旦开始上传，中途失败时不会无提示地偷偷改走直传。
6. 上传完成后客户端目录列表自动刷新。
7. 相关 Web 测试通过，且不破坏现有 transfer / client files 测试。
