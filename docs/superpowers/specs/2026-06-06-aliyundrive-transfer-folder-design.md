# 阿里云盘中转目录与 Skill/CLI 对齐设计

## 背景

当前系统已经支持通过 CLI `files upload --transfer auto` 走阿里云盘中转上传，并已实测打通 CLI → Aliyun → Client 写盘链路。

但还存在两个不一致问题：

1. Web 配置中的 `transferFolder` 字段虽然存在，但 server 实际创建阿里云盘上传任务时仍写死使用云盘根目录。
2. `rag-agent` skill 文档没有同步反映当前真实 CLI 行为与阿里云盘中转语义。

## 目标

1. `transferFolder` 必须在真实上传链路中生效。
2. 阿里云盘中转文件必须进入单独目录，而不是直接落在云盘根目录。
3. skill 文档必须与当前 CLI / server 的真实行为一致。

## 非目标

1. 本次不改变 CLI 参数设计。
2. 本次不改变传输状态机。
3. 本次不实现阿里云盘目录清理策略重构。

## 方案

### 1. server 真实使用 transferFolder

`TransferService.createUpload()` 不再写死 `parentFileId: 'root'`。

改为：

1. 读取 `AliyunDriveConfigRecord.transferFolder`
2. 在阿里云盘中确保该目录存在
3. 取到该目录的 `parentFileId`
4. 中转文件上传到该目录下

中转文件名继续保持 `transferId-filename`，避免并发冲突。

### 2. OpenAPI client 增加目录辅助能力

为了避免把目录解析逻辑堆在 `TransferService` 中，给 `AliyunDriveOpenApiClient` 增加最小目录辅助方法：

- 按名称列出某个 parent 下的目录/文件
- 创建文件夹
- 基于路径段逐级确保目录存在

仅实现当前 `transferFolder` 所需最小能力，不扩展成通用文件管理层。

### 3. skill 文档同步

`rag-agent` skill 更新为反映真实行为：

- `files upload --transfer auto` 会优先使用 server 端已配置且已授权的阿里云盘中转
- 中转文件会写入 server 配置的单独目录，而非云盘根目录
- 失败时可能回退到 direct/frps chunked，或在阿里云链路中报出明确错误

## 测试策略

1. `AliyunDriveOpenApiClient`：补目录辅助方法测试
2. `TransferService`：验证 `transferFolder` 被真实解析为 parentFileId
3. 如有必要，补一轮 CLI 真实上传回归验证

## 风险与权衡

1. 阿里云盘目录 API 返回字段可能存在大小写差异，需要兼容 `file_id/fileId` 等字段。
2. `transferFolder` 为路径而非单层名称时，需要逐级 ensure，而不是只创建一级目录。
3. skill 文档同步不会自动约束未来实现，后续仍需保持代码与文档一同演进。