# Agent API 统一封装 + Skill 设计

> 日期: 2026-06-02
> 状态: 设计中

## 背景

Remote Agent Gateway 是面向 AI Agent 的远程机器控制平台。当前 API 分散在 `/api/agent/*` 和 `/api/clients/*` 两套路由下，AI Agent 需要知道两套路径风格才能完成完整操作流程。此外，文件管理的直连能力（upload-url / write-url）没有 Agent 层封装。

## 目标

1. **统一 Agent API**：AI Agent 只需关心 `/api/agent/*` 一个前缀
2. **Skill 文档**：提供一份 SKILL.md，让任何 AI Agent 能快速理解平台的完整能力和操作流程
3. **直连优先**：文件操作返回直连 URL，避免文件数据经过 server 中转

## 设计

### 1. 新增 Agent API 端点

所有新端点在 `/api/agent/*` 下，使用 `AGENT_API_TOKEN` 鉴权（与现有 Agent 端点一致）。

#### `GET /api/agent/clients` — 列出客户端

列出在线和离线客户端，方便 Agent 选择目标机器。

```
Response 200:
[
  {
    "id": "client-1",
    "name": "dev-box",
    "hostname": "ubuntu-server",
    "os": "linux",
    "arch": "x64",
    "version": "1.0.0",
    "tags": ["prod"],
    "status": "online",
    "online": true,
    "lastSeenAt": 1748800000000
  }
]
```

与现有 `GET /api/clients` 响应格式一致，只是路径不同。

#### `GET /api/agent/clients/:clientId` — 获取单个客户端

获取指定客户端详情，含在线状态。

#### `POST /api/agent/file-session` — 创建/复用文件会话

请求体：
```json
{
  "clientId": "client-1"
}
```

响应：
```json
{
  "clientId": "client-1",
  "publicUrl": "http://frps.example.com:23001",
  "token": "file_xxx...",
  "localPort": 45123,
  "mappingId": "pm_file",
  "startedAt": 1748800000000,
  "expiresAt": 1748801800000,
  "roots": [
    { "id": "root-0", "label": "workspace", "path": "/home/user/workspace" }
  ]
}
```

与 `POST /api/clients/:clientId/file-session/start` 相比，额外返回 `roots`（自动请求 `publicUrl/v1/roots`），减少 Agent 的请求次数。

#### `DELETE /api/agent/file-session` — 停止文件会话

请求体：
```json
{
  "clientId": "client-1"
}
```

响应：
```json
{
  "success": true
}
```

### 2. Skill 设计

Skill 存放在项目 `.claude/skills/rag-agent/SKILL.md`，让 Claude Code 等支持 skill 的 Agent 自动加载。

SKILL.md 内容概要：

- **名称**: `rag-agent` (Remote Agent Gateway)
- **触发条件**: 用户需要远程控制机器、执行脚本、管理文件、端口映射等
- **核心流程**:
  1. 列出客户端 → 选择目标
  2. 根据任务类型选择对应 API
  3. 文件操作优先使用直连方式
- **API 参考**: 完整的端点列表、请求/响应格式
- **常见工作流**: 执行脚本、上传文件、下载文件、暴露端口

### 3. 现有端点（不变）

以下端点保持不变，满足已有需求：

| 方法 | 路径 | 说明 |
|------|------|------|
| POST | `/api/agent/run-script` | 执行脚本 |
| POST | `/api/agent/push-file` | 推送 server 文件到 client |
| POST | `/api/agent/open-port` | 创建端口映射 |
| POST | `/api/agent/close-port` | 关闭端口映射 |
| GET | `/api/agent/tasks/:taskId` | 查询任务状态 |

### 4. 文件操作推荐流程

```
1. POST /api/agent/file-session  →  拿到 { publicUrl, token, roots }
2. 直接用 publicUrl + token 操作文件:
   GET  {publicUrl}/v1/list?rootId=root-0&path=.
   GET  {publicUrl}/v1/read?rootId=root-0&path=some/file.txt
   PUT  {publicUrl}/v1/write?rootId=root-0&path=some/file.txt   (body = 文件内容)
   POST {publicUrl}/v1/upload?rootId=root-0&path=.&filename=file.txt  (body = 文件内容)
   GET  {publicUrl}/v1/download?rootId=root-0&path=some/file.txt
3. 文件数据不经过 server ✓
```

如果 Agent 无法直连 FRP 公网地址，可以用代理端点：
```
GET  /api/clients/:clientId/files/list?rootId=root-0&path=.
GET  /api/clients/:clientId/files/read?rootId=root-0&path=file.txt
POST /api/clients/:clientId/files/upload?rootId=root-0&path=.&filename=file.txt
...
```

### 5. 不做的事项（YAGNI）

- ❌ 不做 MCP Server（可后续扩展，当前不是重点）
- ❌ 不在 `/api/agent/*` 下重复代理文件操作端点（直连已足够）
- ❌ 不修改前端 HTML（已有直连方式）
- ❌ 不修改现有 Agent API 的请求/响应格式

## 实现步骤

1. 在 `apps/server/src/modules/agent/agent.routes.ts` 新增 3 个端点
2. 在 `packages/shared/src/schemas.ts` 新增 `AgentFileSessionPayloadSchema`
3. 写测试覆盖新端点
4. 创建 `.claude/skills/rag-agent/SKILL.md`

## 文件变更清单

| 变更 | 文件 |
|------|------|
| 修改 | `apps/server/src/modules/agent/agent.routes.ts` — 新增 3 个端点 |
| 修改 | `packages/shared/src/schemas.ts` — 新增 AgentFileSessionPayloadSchema |
| 新建 | `apps/server/src/modules/agent/agent.routes.test.ts` — 新端点测试 |
| 新建 | `.claude/skills/rag-agent/SKILL.md` — Agent Skill 定义 |