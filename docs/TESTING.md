# E2E 测试指南

## 快速开始

```bash
# 一键运行（自动构建 + 启动服务 + 测试 + 清理）
pnpm test:e2e

# 测试后保持服务运行（方便手动调试）
pnpm test:e2e:keep

# 详细输出（显示每个 API 请求的响应）
pnpm test:e2e:verbose
```

**前提条件：** Node.js 22+、pnpm 10+

## 测试覆盖

| # | 测试项 | API | 验证点 |
|---|--------|-----|--------|
| 1 | 服务端健康 | `GET /api/health` | 200 + `{"status":"ok"}` |
| 2 | 鉴权拦截 | `GET /api/clients`（无 token） | 401 |
| 3 | 客户端列表 | `GET /api/clients` | 客户端在线、ID 匹配 |
| 4 | 心跳任务 | `POST /api/tasks` health_check | 任务创建 201 |
| 5 | 心跳完成 | `GET /api/tasks/:id` | status=success, exitCode=0 |
| 6 | 脚本执行 | `POST /api/tasks` exec_script | 任务创建 201 |
| 7 | 日志回传 | `GET /api/tasks/:id/logs` | stdout + stderr 内容正确 |
| 8 | 脚本状态 | `GET /api/tasks/:id` | status=success |
| 9 | 命令执行 | `POST /api/tasks` exec_command | 任务创建 201 |
| 10 | 命令输出 | `GET /api/tasks/:id/logs` | 输出包含预期字符串 |
| 11 | 文件上传 | `POST /api/files` | 201 + fileId |
| 12 | 文件推送 | `POST /api/tasks` push_file | 201 |
| 13 | 推送完成 | `GET /api/tasks/:id` | status=success, size>0 |
| 14 | Agent 脚本 | `POST /api/agent/run-script` | 201 |
| 15 | Agent 文件 | `POST /api/agent/run-script` | 201（跨目录读文件） |
| 16 | Agent 查询 | `GET /api/agent/tasks/:id` | 200 + logs 内联返回 |
| 17 | 任务历史 | `GET /api/tasks?limit=20` | 200 + 至少 5 条记录 |

## 工作原理

```
test:e2e
  │
  ├─ 1. 确保 dist/ 已构建（如无则自动 build:dist）
  ├─ 2. 写入测试用 .env 和 config.json
  ├─ 3. 清理旧 db.sqlite
  ├─ 4. 启动 server.bundle.cjs（后台进程）
  ├─ 5. 轮询 /api/health 直到就绪
  ├─ 6. 启动 client.bundle.cjs（后台进程）
  ├─ 7. 轮询 /api/clients 直到客户端注册
  ├─ 8. 顺序执行 17 个测试
  ├─ 9. 打印 pass/fail 统计
  └─ 10. SIGTERM → 清理进程
```

## FRP HTTP 客户端文件管理测试

默认 E2E 不强制运行 FRP 文件数据面测试，因为它依赖可用的 frps/frpc。启用方式：

```bash
RAG_E2E_FRP_FILE_TESTS=1 pnpm test:e2e
```

覆盖能力：

- 启动客户端文件服务
- 创建 FRP 映射
- 创建目录
- 写入文件
- 列目录
- 读取文件
- 移动文件
- 复制文件
- 删除文件

## 手动调试

```bash
# 1. 构建
pnpm build:dist

# 2. 启动服务端（终端 1）
cd dist && node server.bundle.cjs

# 3. 启动客户端（终端 2）
cd dist && node client.bundle.cjs

# 4. 手动测试（终端 3）
curl -s http://localhost:3000/api/health
curl -s -H "Authorization: Bearer test_agent_token" http://localhost:3000/api/clients

# 5. 执行脚本
curl -s -X POST http://localhost:3000/api/tasks \
  -H "Authorization: Bearer test_agent_token" \
  -H "Content-Type: application/json" \
  -d '{"clientId":"e2e-test-client","type":"exec_script","payload":{"runtime":"node","script":"console.log(1+1)","timeoutMs":10000}}'

# 6. 上传文件
echo '{"hello":"world"}' > /tmp/test.json
curl -s -X POST http://localhost:3000/api/files \
  -H "Authorization: Bearer test_agent_token" \
  -F "file=@/tmp/test.json"
```

## 添加新测试

编辑 `scripts/e2e-test.ts`，在 `// ── Run tests ──` 段落后添加：

```ts
await test('你的测试名称', async () => {
  const { status, body } = await apiJson('POST', `${BASE_URL}/api/tasks`, {
    clientId: CLIENT_ID,
    type: 'your_task_type',
    payload: { /* ... */ },
  });
  return status === 201;
});
```

`test()` 函数第二个参数返回 `true` 表示通过，`false` 或抛异常表示失败。

## 故障排查

| 症状 | 可能原因 | 解决 |
|------|----------|------|
| `Timeout waiting: server startup` | 端口 3000 被占用 | `npx kill-port 3000` |
| `Client failed to register` | config.json 中 token 与 .env 不匹配 | 检查 ADMIN_TOKEN、AGENT_API_TOKEN |
| `404 Client not found` | clientId 与注册时不一致 | 确认 `CLIENT_ID` 常量与 config.json 一致 |
| `401 Missing authorization` | Token 传递失败 | 检查 `api()` 函数的 headers 逻辑 |
| 文件上传失败 | multipart/form-data 格式问题 | 确保 FormData 正确设置 filename |
