# 阿里云盘中转上传设计

日期：2026-06-06

## 背景

当前 `rag files upload` 通过 server 发现 client HTTP 地址后，经由 `frps -> frpc -> client HTTP` 做分段上传。这个方案可以断点和重试，但文件主体数据仍经过 frps 所在机器。当 frps 机器带宽较低时，大文件上传会很慢，甚至超时。

本设计引入阿里云盘作为文件中转层。配置并授权阿里云盘后，文件主体数据改为：

```text
CLI / skill -> Aliyun Drive -> target client
```

server 只负责认证管理、transfer job 编排、状态聚合和清理协调，不承载文件主体数据。不配置或未授权阿里云盘时，继续使用现有 frps 分段上传路径。

参考实现：`D:\VCPHub\VCPBcakUpDEV` 中的阿里云盘 OpenAPI / PKCE / 上传下载脚本。

## 目标

1. 保持现有 CLI 调用体验：`rag files upload --client ... --root ... --path ... --file ...`。
2. server 已配置并授权阿里云盘时，默认使用阿里云盘中转上传。
3. server 未配置或未授权阿里云盘时，自动回退现有 frps chunked upload。
4. 支持单文件大于 5GB：阿里云盘多分片上传、URL 刷新、重试、complete 合并、client 流式下载写盘。
5. CLI、skill 和 Web 页面都能看到清晰的端到端进度，而不仅是 CLI 本地上传进度。
6. Web 管理台新增阿里云盘页面，用于填写 OpenAPI 应用配置、生成授权二维码/链接、粘贴授权 code、查看授权状态和 transfer 进度。
7. server 统一长期保存阿里云盘认证。CLI 和 client 可以临时获取执行传输所需的 token 或会话信息，但不能持久化到本地或写入日志。
8. client 下载完成后，阿里云盘中转文件保留一段时间再清理，默认 24 小时。

## 非目标

1. 不恢复旧的通用 WebSocket task 下发体系。
2. 不把 server 或 frps 变成文件主体数据代理。
3. 初版不抽象完整多云 provider 框架；只实现阿里云盘，但 transfer 状态机与阿里云盘模块保持边界，便于后续扩展。
4. 初版不要求 CLI 进程退出后自动恢复同一个上传；但状态机要记录足够信息，便于后续做 resume。

## 总体架构

默认阿里云盘路径：

```text
CLI / skill
  │
  │ 1. POST /api/transfers/uploads 创建 transfer job
  ▼
server
  │
  │ 2. 返回阿里云盘上传计划和临时执行信息
  ▼
CLI / skill
  │
  │ 3. 直连阿里云盘多分片上传
  ▼
Aliyun Drive
  ▲
  │ 4. CLI 上报上传进度 / 上传完成
  │
server
  │
  │ 5. 通过 WebSocket 下发 transfer.download.start
  ▼
target client
  │
  │ 6. 向 server 获取下载详情
  │
  │ 7. 直连阿里云盘流式下载
  ▼
target local file
  ▲
  │ 8. client 上报下载和写盘进度
  │
server
  │
  │ 9. CLI / Web / skill 查询同一个 transfer 状态
  ▼
CLI / Web / skill
```

回退路径：

```text
CLI -> frps/frpc -> client HTTP chunked upload
```

关键边界：

- server 是唯一长期保存阿里云盘配置和 OAuth token 的组件。
- CLI 和 client 只在内存中使用 server 下发的临时执行信息，不写入配置文件、缓存文件或日志。
- WebSocket 只新增窄范围 transfer 控制消息，用于阿里云盘中转下载触发和进度回报。
- client HTTP 保留调试/兜底入口，但默认上传链路不依赖它触发下载。

## Server 模块设计

新增模块：

```text
apps/server/src/modules/aliyundrive/
  aliyundrive-auth.service.ts
  aliyundrive-openapi.client.ts
  aliyundrive-upload-planner.ts

apps/server/src/modules/transfers/
  transfer.routes.ts
  transfer.service.ts
  transfer-state.ts
  transfer-cleanup.service.ts
```

### 阿里云盘配置与授权

Web 页面填写并保存 OpenAPI 应用配置。server 提供 OOB/PKCE 授权流程，不要求公开回调地址。

授权流程：

1. Web 调用 `POST /api/aliyundrive/oauth/start`。
2. server 生成 PKCE verifier 和授权 URL，并临时保存 verifier。
3. Web 展示授权 URL 和二维码。
4. 用户扫码或打开链接完成授权。
5. 用户把阿里云盘返回的 code 粘贴回 Web 页面。
6. Web 调用 `POST /api/aliyundrive/oauth/complete`。
7. server 使用 code + verifier 换取 token，保存授权信息。
8. server 调用 drive 信息接口验证授权并保存 drive id。

配置 API：

```http
GET  /api/aliyundrive/status
PUT  /api/aliyundrive/config
POST /api/aliyundrive/oauth/start
POST /api/aliyundrive/oauth/complete
POST /api/aliyundrive/oauth/revoke
POST /api/aliyundrive/test
```

默认配置值：

- `scope`: `user:base,file:all:read,file:all:write`
- `openapi_base`: `https://openapi.alipan.com`
- `redirect_uri`: `oob`
- `transfer_folder`: `RemoteAgentGatewayTransfers`
- `cleanup_ttl_hours`: `24`

### Transfer 状态机

主状态：

```text
created
  -> waiting_cli_upload
  -> cli_uploading
  -> aliyun_uploaded
  -> waiting_client_download
  -> client_downloading
  -> completed
```

失败和取消状态：

```text
failed
cancelled
```

清理状态由 `cleanup_status` 单独记录，transfer 主状态保持 `completed` 或 `failed`：

```text
cleanup_pending
cleanup_done
cleanup_failed
```

状态含义：

- `waiting_cli_upload`: server 已创建 job，等待 CLI 开始上传到阿里云盘。
- `cli_uploading`: CLI 正在上传分片。
- `aliyun_uploaded`: 阿里云盘 `openFile/complete` 已完成。
- `waiting_client_download`: server 正准备通知目标 client 下载。
- `client_downloading`: client 正在从阿里云盘下载并写入临时文件。
- `completed`: 目标 client 本地文件已成功写入最终路径。
- `cleanup_pending`: 中转文件已设置到期清理时间，transfer 主状态不因此改变。
- `cleanup_done`: 中转文件已从阿里云盘删除。
- `cleanup_failed`: 到期清理失败，可在 Web 中查看并重试。

### DB 表设计

`aliyundrive_config`：

```text
id TEXT PRIMARY KEY
client_id TEXT NOT NULL
client_secret TEXT
scope TEXT NOT NULL
openapi_base TEXT NOT NULL
redirect_uri TEXT NOT NULL
transfer_folder TEXT NOT NULL
cleanup_ttl_ms INTEGER NOT NULL
created_at INTEGER NOT NULL
updated_at INTEGER NOT NULL
```

`aliyundrive_auth`：

```text
id TEXT PRIMARY KEY
access_token TEXT NOT NULL
refresh_token TEXT
token_type TEXT
expires_at INTEGER NOT NULL
drive_id TEXT
authorized_account_name TEXT
updated_at INTEGER NOT NULL
```

如果 OOB/PKCE 未返回 refresh token，页面明确展示 token 到期时间并提示需要重新授权。若配置了 `client_secret` 且接口返回 refresh token，server 可在实现中支持刷新。

`transfer_jobs`：

```text
id TEXT PRIMARY KEY
client_id TEXT NOT NULL
root_id TEXT NOT NULL
target_dir TEXT NOT NULL
filename TEXT NOT NULL
size INTEGER NOT NULL
sha256 TEXT
mode TEXT NOT NULL
status TEXT NOT NULL
phase TEXT NOT NULL
error_code TEXT
error_message TEXT
aliyun_drive_id TEXT
aliyun_file_id TEXT
aliyun_upload_id TEXT
aliyun_parent_file_id TEXT
aliyun_file_name TEXT
uploaded_bytes INTEGER NOT NULL DEFAULT 0
downloaded_bytes INTEGER NOT NULL DEFAULT 0
written_bytes INTEGER NOT NULL DEFAULT 0
total_bytes INTEGER NOT NULL
part_count INTEGER
current_part INTEGER
created_at INTEGER NOT NULL
updated_at INTEGER NOT NULL
completed_at INTEGER
cleanup_after_at INTEGER
cleanup_status TEXT
```

`transfer_events`：

```text
id INTEGER PRIMARY KEY AUTOINCREMENT
transfer_id TEXT NOT NULL
source TEXT NOT NULL
type TEXT NOT NULL
message TEXT NOT NULL
payload TEXT
created_at INTEGER NOT NULL
```

`payload` 必须脱敏，不能包含 access token、refresh token、upload_url、download_url 或 Authorization header。

### Transfer API

```http
POST /api/transfers/uploads
GET  /api/transfers/:id
GET  /api/transfers/:id/events
POST /api/transfers/:id/cli-progress
POST /api/transfers/:id/cli-upload-complete
POST /api/transfers/:id/client-progress
POST /api/transfers/:id/client-complete
POST /api/transfers/:id/fail
POST /api/transfers/:id/cancel
POST /api/transfers/:id/refresh-upload-url
POST /api/transfers/:id/refresh-download-url
```

`POST /api/transfers/uploads` 根据 server 状态返回：

- `mode=aliyundrive`: 返回 transfer id、分片计划、上传执行信息。
- `mode=frps_chunked`: 表示 CLI 应回退到现有 direct chunked upload。

如果 CLI 显式指定强制阿里云盘模式，但 server 未配置或授权已过期，API 返回错误而不是回退。

## CLI 设计

现有命令保持：

```bash
rag files upload --client <clientId> --root <rootId> --path <targetDir> --file <localFile> [--filename <name>]
```

新增可选参数：

```bash
--transfer auto          # 默认
--transfer aliyundrive   # 强制阿里云盘，未配置或授权失败则报错
--transfer direct        # 强制现有 frps chunked 上传
```

`auto` 行为：

1. CLI 调 server 创建 transfer。
2. 返回 `frps_chunked` 时复用现有 `uploadFileWithProgress`。
3. 返回 `aliyundrive` 时执行阿里云盘多分片上传。
4. 上传过程中向 server 上报 `cli-progress`。
5. 上传完成后通知 server complete。
6. CLI 等待 transfer 最终进入 `completed` 或 `failed`。
7. CLI 在 stderr 输出阶段进度，在 stdout 输出 JSON 结果。

stderr 示例：

```text
[1/5] 创建传输任务 transfer_abc123
[2/5] 上传到阿里云盘 42.3% | 128.4 MB/s | part 18/120 | ETA 00:03:12
[3/5] 阿里云盘合并完成 file_id=***masked***
[4/5] 等待 client 下载...
[4/5] Client 下载 63.1% | 86.2 MB/s | ETA 00:01:44
[5/5] 写入完成 root=workspace path=deploy/app.zip size=123456789
```

JSON 结果示例：

```json
{
  "ok": true,
  "data": {
    "transferId": "transfer_abc123",
    "mode": "aliyundrive",
    "clientId": "client-1",
    "rootId": "workspace",
    "path": "deploy",
    "filename": "app.zip",
    "size": 123456789,
    "status": "completed"
  }
}
```

## Client 设计

client 新增窄范围下载执行器：

```text
apps/client/src/runtime/transfers/
  aliyundrive-download-executor.ts
  transfer-ws-handler.ts
```

默认触发：

```text
server WebSocket -> transfer.download.start -> client
```

client 执行步骤：

1. 校验 transfer id 和 client id。
2. 向 server 获取 transfer 下载详情。
3. 使用现有 `allowedRoots` / `resolveRootPath` 校验目标路径。
4. 创建临时文件 `.rag-transfer-<transferId>.part`。
5. 使用 server 提供的 access token 调阿里云盘 `getDownloadUrl`，或直接使用 server 提供的 download URL。
6. 流式下载并写入临时文件。
7. 周期性上报 downloaded bytes、written bytes、速率和阶段。
8. 下载完成后原子 rename 到最终文件。
9. 上报 `client-complete`。

client 不在本地保存阿里云盘 token，不把 token、download URL 写入日志或 transfer event。

调试/兜底 HTTP 入口：

```http
POST /files/aliyundrive-download
```

该入口用于测试、开发调试或 WebSocket 异常时的手动触发，不是默认业务路径。

## Web 页面设计

新增侧边栏入口：`阿里云盘`。

页面分四块。

### 应用配置

字段：

- `client_id`
- `client_secret`，可选，密码输入
- `scope`
- `openapi_base`
- `redirect_uri`
- `transfer_folder`
- `cleanup_ttl_hours`

### 授权状态

展示：

- 是否已授权
- token 过期时间
- drive id
- 授权账户名，如果接口可获得
- 最近测试时间
- 重新授权按钮
- 撤销授权按钮

### 授权流程

1. 点击“生成授权二维码”。
2. server 返回授权 URL。
3. 页面展示二维码和复制链接。
4. 用户扫码或打开链接完成授权。
5. 用户粘贴 code。
6. 页面提交 `oauth/complete`。
7. server 保存 token。
8. 页面刷新授权状态。

### Transfer 监控

展示最近 transfer：

- transfer id
- client
- filename
- size
- mode
- phase/status
- 上传进度
- 下载进度
- 错误
- cleanup 状态

初版放在阿里云盘页面底部，后续如果 transfer 数量增多再拆成独立页面。

## 阿里云盘 OpenAPI 实现

服务层参考 Python 脚本中的流程：

- PKCE verifier / challenge 生成。
- 授权 URL 生成。
- code 换 token。
- drive id 获取。
- 目录查找或创建。
- `openFile/create` 创建文件上传。
- `getUploadUrl` 刷新上传 URL。
- `listUploadedParts` 校验已上传分片。
- `openFile/complete` 完成上传。
- `getDownloadUrl` 获取下载地址。
- 删除中转文件用于 TTL 清理。

分片策略：

- 默认 part size：64MB。
- 最小 part size：8MB。
- 大文件可自动提升到 128MB 或 256MB，避免 part 数过多。
- part 数不得超过阿里云盘接口限制。
- CLI 每次流式读取一个 part，不把整个文件载入内存。
- 上传 `upload_url` 时避免自动添加不匹配的 `Content-Type`，必要时设置为空，避免签名不一致。

## 错误处理

### CLI 上传错误

- 网络错误：重试当前 part。
- `upload_url` 过期或返回 403：请求 server 刷新该 part 的 upload URL 后重试。
- 单 part 多次失败：transfer 标记 `failed`。
- CLI 中断：server 保留 transfer 状态，后续可显示为未完成或失败。

### server 错误

- 未配置阿里云盘：`auto` 模式回退 `frps_chunked`。
- 强制 `aliyundrive` 模式但未配置：返回错误。
- token 过期：返回需要重新授权，避免用户误以为走了加速。
- client 不在线：等待短超时后标记 failed。
- WebSocket 下发失败：尝试 client HTTP 兜底一次，失败则标记 failed。

### client 下载错误

- download URL 过期：向 server 请求刷新。
- 网络中断：优先使用 Range 断点续传；不可用时从头重试。
- 写盘失败：上报 failed，错误信息脱敏。
- allowed root 校验失败：拒绝执行并上报 failed。

## 清理策略

- 默认完成后保留 24 小时。
- `completed` 后设置 `cleanup_after_at` 和 `cleanup_pending`。
- server 启动时和定时任务扫描待清理 transfer。
- 到期后调用阿里云盘删除接口。
- 删除成功标记 `cleanup_done`。
- 删除失败标记 `cleanup_failed`，Web 页面显示并允许后续重试。
- 对失败 transfer，如果云盘文件已创建，也按 TTL 清理，避免影响排障。

## 安全与脱敏

- Web 不展示 access token 或 refresh token 明文。
- CLI 和 client 不持久化阿里云盘 token。
- server API、日志、transfer event 不记录 token、Authorization header、upload URL、download URL。
- DB 中 token 初版可明文保存；后续可增加加密存储。若生产环境要求更高安全级别，应在部署配置中加入密钥并加密 `aliyundrive_auth`。
- 所有新增 server API 继续使用现有 Bearer token 鉴权。

## 测试策略

采用 TDD，先补测试再实现。

Server tests：

- 阿里云盘配置保存、读取和脱敏。
- OAuth start 生成 verifier 和授权 URL。
- OAuth complete 使用 code 换 token。
- 未配置时 transfer 自动选择 `frps_chunked`。
- 已授权时 transfer 选择 `aliyundrive`。
- transfer 状态机合法流转。
- progress API 更新 uploaded/downloaded/written bytes。
- token、upload URL、download URL 不出现在 event payload。
- cleanup TTL 计算和状态更新。

CLI tests：

- `files upload` 未配置时走现有 chunked upload。
- 已配置时创建 transfer 并走 aliyundrive。
- 上传进度输出包含阶段。
- part 失败后重试。
- 403 后刷新 upload URL。
- JSON 输出包含 transferId、mode 和 status。

Client tests：

- WebSocket `transfer.download.start` 触发下载执行器。
- allowed root 校验。
- 临时文件写入和 rename。
- 下载进度上报。
- download URL 过期刷新。
- 写盘失败上报 failed。

Web tests：

- 新增导航项。
- 配置表单保存。
- 授权二维码/链接展示。
- 粘贴 code 完成授权。
- 授权状态展示。
- transfer 列表展示阶段进度。

## 验收标准

1. 不配置阿里云盘时，现有上传不受影响。
2. 配置并授权阿里云盘后，`rag files upload` 默认走阿里云盘中转。
3. 单文件 >5GB 使用多分片上传和流式下载路径，不把完整文件载入内存。
4. frps 不承载文件主体数据。
5. CLI / skill 能看到完整端到端进度。
6. Web 页面能配置授权并查看 transfer 过程。
7. token 不在 CLI/client 本地持久化，不出现在日志和事件明文中。
8. 中转文件完成后按 TTL 清理。
