# 阿里云盘授权状态与页面滚动设计

## 背景

当前阿里云盘页面只能展示基于本地 token 过期时间推导出的 `authorized` 布尔值，无法明确区分：

1. 用户是否“曾经授权成功并且本地仍保存授权记录”
2. 当前授权是否已经被阿里云远程判定为失效

同时，控制台页面当前存在整页滚动问题，导致左侧菜单也跟随页面滚动，不符合后台控制台交互预期。

## 目标

1. 进入阿里云盘页面时，若本地已有未过期授权记录，应明确展示“已授权”。
2. 页面应支持真实校验授权是否仍然有效。
3. 若本地状态显示已授权，页面加载后自动发起一次远程校验。
4. 页面保留手动“测试授权”按钮，便于重试。
5. 左侧菜单固定不动，仅右侧内容区滚动。

## 非目标

1. 本次不实现 refresh token 自动刷新。
2. 本次不改动 CLI / client 传输流程。
3. 本次不增加新的持久化表结构。

## 方案

### 1. 本地授权状态与远程校验状态分离

服务端 `GET /api/aliyundrive/status` 保留现有 `authorized` 布尔值供传输默认策略使用，同时新增：

- `authorizationState: 'unauthorized' | 'authorized' | 'expired'`

语义：

- `unauthorized`：没有本地授权记录
- `authorized`：本地存在 token，且 `expiresAt > now`
- `expired`：本地存在 token，但已过期

其中现有 `authorized` 字段仍按“可用于传输”的更严格语义保留，即需要大于 5 分钟缓冲时间。

### 2. 新增真实授权测试接口

`POST /api/aliyundrive/test` 改为真实调用阿里云盘 OpenAPI，而不是仅返回本地状态。

返回：

- `state: 'unauthorized' | 'expired' | 'valid' | 'invalid' | 'network_error'`
- `message: string`
- `driveId?: string`
- `authorizedAccountName?: string`
- `checkedAt: number`

判定规则：

- 无本地授权记录：`unauthorized`
- 本地 token 已过期：`expired`
- 远程调用成功：`valid`
- 远程返回鉴权错误（如 401 / 403 / token 无效）：`invalid`
- 其他异常：`network_error`

远程成功时，服务端顺手更新本地 `driveId` 与 `authorizedAccountName`。

### 3. 页面展示

阿里云盘状态区拆分为两个维度：

- 配置状态
- 授权记录状态（本地）
- 远程校验状态
- 账户名
- Drive ID
- 过期时间

页面加载流程：

1. 拉取 `/status`
2. 若 `authorizationState === 'authorized'`，自动调用 `/test`
3. 将远程结果显示为：未检测 / 检测中 / 有效 / 已失效 / 网络异常

页面仍保留“测试授权”按钮，可重复触发。

### 4. 布局滚动修复

`AppLayout` 调整为：

- 顶层布局固定 `height: 100vh` 且 `overflow: hidden`
- 左侧 `Sider` 占满视口高度，不参与页面滚动
- 右侧内容容器固定高度
- 真正滚动发生在 `Content` 区域内部

## 测试策略

### 服务端

1. `AliyunDriveAuthService`：
   - 已授权时远程校验成功并更新 drive/account 信息
   - 本地已过期时直接返回 `expired`，不发远程请求
2. `aliyundrive.routes.test.ts`：
   - `/api/aliyundrive/test` 返回真实测试结果对象

### Web

1. `AliyunDrivePage.test.tsx`：
   - 本地已授权时自动触发测试接口
   - 页面展示本地授权状态与远程校验结果
2. `AppLayout.test.tsx`：
   - 布局使用固定视口 + 内容区滚动样式

## 风险与权衡

1. 远程校验会增加一次页面加载后的额外请求，但仅在本地状态为已授权时触发，可接受。
2. `authorized` 与 `authorizationState` 并存会有一定心智成本，但能兼容现有传输逻辑与更准确的 UI 展示。
3. `network_error` 不能等同于“已失效”，因此 UI 必须明确区分。