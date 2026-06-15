# Remote Agent Gateway — 自动更新 SOP

> 本 SOP 记录了完整的自更新流程操作步骤、已知问题及修复方案。
> 最后验证日期：2026-06-15 | 验证版本：v1.0.7

---

## 目录

1. [架构概览](#1-架构概览)
2. [前置条件](#2-前置条件)
3. [标准操作流程](#3-标准操作流程)
4. [已知问题与修复](#4-已知问题与修复)
5. [验证清单](#5-验证清单)
6. [故障排查](#6-故障排查)
7. [回滚方案](#7-回滚方案)

---

## 1. 架构概览

### 1.1 组件关系

```
┌─────────────────┐      WebSocket       ┌──────────────────┐
│   Server        │◄────────────────────►│   Client Agent   │
│   (管理端)       │      控制面           │   (被控端)        │
│                 │                       │                  │
│  Fastify HTTP   │      HTTP API        │  HTTP 控制服务    │
│  WebSocket      │◄────────────────────►│  FRP 隧道         │
│  SQLite         │      数据面           │  任务执行器       │
│  Launcher       │                       │  Launcher        │
└───────┬─────────┘                       └──────────────────┘
        │
        │ PM2 / 进程管理
        ▼
┌─────────────────┐
│   server-launcher.cjs
│   └─ 管理版本切换
│   └─ 监听 exit code 20
└─────────────────┘
```

### 1.2 自更新流程

```
┌─────────────────────────────────────────────────────────────┐
│                    自更新完整流程                              │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  ① 准备阶段                                                  │
│     ├─ Bump 版本号 → build → package                         │
│     └─ 上传 artifact → 发布 Release                          │
│                                                             │
│  ② 创建编排 (Campaign)                                       │
│     ├─ 目标版本: vX.Y.Z                                      │
│     └─ 包含 Server: ✅ (关键)                                 │
│                                                             │
│  ③ 启动编排                                                  │
│     ├─ 状态: draft → server_updating                         │
│     ├─ saveDb()                                              │
│     └─ ServerUpdater.run() 开始                               │
│                                                             │
│  ④ Server 自更新                                             │
│     ├─ 下载 artifact (从自身 HTTP 下载)                       │
│     ├─ 验证 SHA256 + Size                                    │
│     ├─ 解压到 versions/server/ 目录                           │
│     ├─ 写入 pending 版本状态                                   │
│     ├─ saveDb()                                              │
│     └─ 进程退出 (exit code 20)                                │
│                                                             │
│  ⑤ Launcher 接管                                             │
│     ├─ 捕获 exit code 20                                     │
│     ├─ promotePendingServerVersion() 提升版本                 │
│     └─ 启动新版本 bundle                                      │
│                                                             │
│  ⑥ 新版本启动                                                │
│     ├─ 读取 pending 上下文                                     │
│     ├─ Server target → succeeded                             │
│     ├─ 调用 dispatchClients({ waitForOnline: true })         │
│     │  └─ 等待客户端重连 (最长 15 秒)                          │
│     └─ 分发客户端更新指令                                      │
│                                                             │
│  ⑦ 客户端更新                                                │
│     ├─ 接收 server.update.run 指令                            │
│     ├─ 下载 artifact + 验证                                   │
│     ├─ 解压 + 确认新版本就绪                                   │
│     └─ Client target → succeeded                             │
│                                                             │
│  ⑧ 完成                                                     │
│     └─ Campaign → completed / completed_with_errors          │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

---

## 2. 前置条件

### 2.1 服务器要求

| 条件 | 说明 | 检查方式 |
|------|------|---------|
| 通过 Launcher 启动 | 必须使用 `server-launcher.cjs` 启动 | `ps aux \| grep server-launcher` |
| RAG_DEPLOY_ROOT 已设置 | Launcher 自动设置该环境变量 | PM2 配置或 ps 查看环境变量 |
| PM2 / 进程守护 | 推荐 PM2 管理 launcher 进程 | `pm2 list` |
| 服务器可访问自身 artifact URL | Server 需能从自身 HTTP 下载更新包 | `curl http://localhost:9000/api/health` |
| 公网/内网可达 | 客户端能连接 Server WebSocket | 客户端日志显示"已连接" |

### 2.2 客户端要求

| 条件 | 说明 |
|------|------|
| 通过 client-launcher.cjs 启动 | Launcher 负责版本切换 |
| WebSocket 连接正常 | 状态显示 `online` |
| HTTP 就绪 | 状态显示 `active` |
| 磁盘空间充足 | 至少 2 倍 artifact 大小的空闲空间 |

### 2.3 版本发布要求

| 条件 | 说明 |
|------|------|
| 所有平台 artifact 已上传 | Server Windows/Linux + Client Windows/Linux |
| SHA256 与 manifest 一致 | 上传后通过 API 重新注册 manifest |
| Release 状态为"已启用" | 在 Web 管理后台确认 |

---

## 3. 标准操作流程

### 3.1 发布新版本

```bash
# 1. Bump 版本号
pnpm version:patch    # 或 minor / major

# 2. 构建
pnpm build

# 3. 打包所有平台
pnpm package --all

# 4. 上传 artifact 并注册 Release
# 方式 A：通过 Web 管理后台
#   - 打开 http://<server>:9000/
#   - 进入"更新管理" → "版本发布" → "发布新版本"
#   - 填写版本号，上传 4 个 artifact 文件
#   - 确认发布

# 方式 B：通过 API（推荐用于 CI/CD）
node scripts/redeploy-v1.0.7.js
```

### 3.2 创建并启动编排

1. **登录 Web 管理后台**
   - 访问 `http://<server>:9000/`
   - 输入管理员 Token

2. **进入"更新管理" → "更新编排"**
   - 点击"新建编排"
   - 选择目标版本（已发布的版本）
   - **勾选"更新 Server"**（测试 Server 自更新时必须）
   - 设置批次大小和并发数（默认 10/5 即可）
   - 点击"创建"

3. **启动编排**
   - 在编排详情页点击"启动编排"
   - 确认弹窗"确定启动此编排?"
   - 系统将自动：
     - Server: draft → server_updating → 重启 → succeeded
     - Client: queued → dispatched → downloading → ... → succeeded

### 3.3 重试失败/离线的客户端

如果某些客户端因离线被跳过（标记为 `offline_skipped`）：

1. 等待客户端重新上线
2. 在编排详情页点击 **"重试离线"**
3. 确认弹窗 — 系统自动：
   - 重置 target 状态为 `queued`
   - 等待客户端重连（最长 15 秒）
   - 分发更新指令

### 3.4 监控更新过程

- **自动轮询**：当编排状态为 `server_updating` 或 `client_updating` 时，页面每 3 秒自动刷新
- **target 阶段变化**：
  ```
  server:  queued → server_updating → (重启) → succeeded
  client:  queued → dispatched → downloading → downloaded
           → installing → restarting → verifying → succeeded
  ```
- **完成标志**：
  - 全部成功：`completed`
  - 部分失败：`completed_with_errors`
  - 仍在进行：`client_updating`

---

## 4. 已知问题与修复

### 4.1 Bug #1：Server 重启后客户端分发时序

**现象**：编排状态 `completed_with_errors`，Server target 为 `succeeded`，所有 Client target 为 `offline_skipped`。

**时间线**：
```
23:39:49  Server 自更新完成 (exit code 20)
23:39:49  Launcher 启动新版本
23:39:49  新 Server 启动，读取 pending 上下文
23:39:49  调用 dispatchClients()        ← 问题！
23:39:49  客户端还在重连中，getOnlineClientIds() 返回空
23:39:49  所有 Client → offline_skipped
23:39:49  +551ms 客户端重连完成
```

**根因**：`dispatchClients()` 在 Server 重启后**立即执行**，客户端 WebSocket 尚未重连完成。

**修复方案**：在 `campaign-executor.ts` 中添加 `waitForOnlineClients()` 方法：

```typescript
async function waitForOnlineClients(expectedClientIds: string[], timeoutMs = 15_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const online = connections.getOnlineClientIds();
    const matched = expectedClientIds.filter((id) => online.includes(id));
    if (matched.length > 0) return;  // 至少一个客户端上线
    await new Promise((r) => setTimeout(r, 500));
  }
  // 超时后继续（不阻塞）
}
```

**修改文件**：
- `apps/server/src/modules/updates/campaign-executor.ts`
- `apps/server/src/main.ts`

**验证方式**：重新启动含 Server 的编排，观察 Client 能否从 `queued` 正常推进到 `dispatched`。

### 4.2 Bug #2：重试按钮不触发实际分发

**现象**：点击"重试离线"后，target 状态重置为 `queued`，但不会自动分发更新指令。campaign status 保持 `completed_with_errors`，"启动编排"按钮不显示。

**根因**：
- `retryTargets()` 只更新 target 的 phase，不更新 campaign 的 status
- `campaign.routes.ts` 的 retry 路由不调用 `dispatchClients()`

**修复方案**：

1. `campaign.service.ts` — 重试后更新 campaign status：
   ```typescript
   if (toRetry.length > 0) {
     const campaign = deps.repo.getCampaign(campaignId);
     if (campaign && (campaign.status === 'completed' || campaign.status === 'completed_with_errors')) {
       deps.repo.saveCampaign({ ...campaign, status: 'client_updating', updatedAt: deps.now() });
     }
   }
   ```

2. `campaign.routes.ts` — 重试后自动触发分发：
   ```typescript
   if (result.length > 0 && executor) {
     setImmediate(async () => {
       await executor.dispatchClients(request.params.id, { waitForOnline: true });
     });
   }
   ```

**修改文件**：
- `apps/server/src/modules/updates/campaign.service.ts`
- `apps/server/src/modules/updates/campaign.routes.ts`

**验证方式**：在 `completed_with_errors` 编排上点击"重试离线"，观察 target 能否自动推进到 `dispatched` 并最终 `succeeded`。

---

## 5. 验证清单

### 5.1 发布验证

- [ ] `pnpm version:patch` 成功，git tag 已创建
- [ ] `pnpm typecheck` 全仓类型检查通过
- [ ] `pnpm test` 所有测试通过
- [ ] `pnpm build` 构建成功
- [ ] `pnpm package --all` 生成所有平台 artifact
- [ ] 4 个 artifact 文件存在（server/client × win/linux）
- [ ] Release 在 Web 后台显示"已启用"

### 5.2 功能验证

- [ ] Server target → `succeeded`
- [ ] Client target → `dispatched`（已收到指令）
- [ ] Client target → `downloading`（正在下载）
- [ ] Client target → `succeeded`（更新完成）
- [ ] API `GET /api/health` 返回 `serverVersion: "v1.0.7"`
- [ ] 客户端仪表盘版本显示 v1.0.7

### 5.3 重试验证

- [ ] "重试离线"按钮可用
- [ ] 重试后 target 自动变为 `queued`
- [ ] 重试后自动触发 `dispatchClients`
- [ ] 客户端最终变为 `succeeded`

---

## 6. 故障排查

### 6.1 Server 自更新失败

**现象**：编排卡在 `server_updating`，Server target 未变为 `succeeded`。

**排查步骤**：

```bash
# 1. 检查 Server 是否在运行
pm2 list

# 2. 检查 Server 日志
pm2 logs rag-server --lines 100

# 3. 检查是否通过 launcher 启动
ps aux | grep server-launcher

# 4. 检查 artifact 是否存在
curl -I http://localhost:9000/updates/artifacts/v1.0.7/rag-server-v1.0.7-linux-x64.tar.gz

# 5. 检查 release manifest
curl -H "Authorization: Bearer **xuzhen123" \
  http://localhost:9000/admin/updates/releases/v1.0.7
```

**常见原因**：
- Launcher 未启动（直接运行了 bundle）
- artifact URL 不可访问
- SHA256 不匹配
- RAG_DEPLOY_ROOT 未设置
- 磁盘空间不足

### 6.2 客户端 offline_skipped

**现象**：Client target 卡在 `offline_skipped`。

**排查步骤**：

```bash
# 1. 检查客户端是否在线
node ./run.cjs clients list

# 2. 查看客户端日志
node ./run.cjs files read --client <id> --root root-0 --path /opt/rag-client/logs/client-out.log

# 3. 检查 WebSocket 连接状态
# 日志中应有 "已连接服务端" 字样
```

**根本原因**：
- Server 重启期间 WebSocket 断开（已在 4.1 中修复）
- 客户端实际离线（网络问题）
- 客户端防火墙阻止连接

**解决**：
- 确认客户端在线后点击"重试离线"
- 确保 Server 运行的是 >= v1.0.7 版本（包含时序修复）

### 6.3 Manifest SHA256 不匹配

**现象**：客户端下载更新包后验证失败，显示 `HASH_MISMATCH` 或 `sha256 mismatch`。

**原因**：artifact 文件被更新但 manifest 中的 SHA256 未同步更新。

**解决**：
1. 重新上传所有 artifact
2. 重新注册 release manifest

```bash
# 通过 API 重新注册
curl -X POST http://<server>:9000/admin/updates/releases \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer **xuzhen123" \
  -d '{"manifest": "{\"version\":\"v1.0.7\",...}"}'
```

---

## 7. 回滚方案

### 7.1 Server 回滚

如果在自更新后 Server 出现问题：

```bash
# 通过 PM2 手动回滚
pm2 stop rag-server

# 查看 versions 目录
ls /opt/rag-server/versions/server/

# 修改 state/current-version.json 指向上一个版本
# 然后重启
pm2 start rag-server
```

### 7.2 客户端回滚

在编排详情页点击"重试失败"（如果之前已配置旧版本 release 仍在），或手动部署旧版本到客户端。

---

## 附录 A：关键配置参考

### ecosystem.config.cjs

```javascript
// 关键配置：RAG_DEPLOY_ROOT 和 launcher
{
  name: 'rag-server',
  script: 'server-launcher.cjs',  // ← 必须使用 launcher
  env: {
    RAG_DEPLOY_ROOT: '/opt/rag-server',  // ← 自更新依赖
  },
}
```

### 自更新允许条件

在 `main.ts` 中：
```typescript
allowServerSelfUpdate: Boolean(process.env.RAG_DEPLOY_ROOT),
// 只有通过 launcher 启动（设置了 RAG_DEPLOY_ROOT）才允许自更新
```

## 附录 B：本文档修改记录

| 日期 | 版本 | 修改内容 | 作者 |
|------|------|---------|------|
| 2026-06-15 | v1.0 | 初始版本，记录完整 SOP | pi |
