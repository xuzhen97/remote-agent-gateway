# 客户端列表页版本列 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在 Web 控制台“客户端”列表页新增独立“版本”列，展示每个客户端的当前版本号，并在缺失时降级显示 `-`。

**Architecture:** 该改动只涉及 `apps/web` 展示层，不变更服务端 API 或客户端上报链路。实现采用 TDD：先新增 `ClientsPage` 渲染测试覆盖“有版本 / 无版本”两种场景，再最小化修改 `ClientsPage.tsx` 的表格列定义使测试通过，最后做 web 包级别与全仓验证。

**Tech Stack:** React 19、Ant Design 5、Vitest、Testing Library、TypeScript

---

### Task 1: 为客户端列表页补充版本列渲染测试

**Files:**
- Create: `apps/web/src/pages/ClientsPage.test.tsx`
- Modify: `apps/web/src/pages/ClientsPage.tsx`
- Test: `apps/web/src/pages/ClientsPage.test.tsx`

- [ ] **Step 1: Write the failing test**

在 `apps/web/src/pages/ClientsPage.test.tsx` 创建下面的测试文件：

```tsx
import { describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import { App } from 'antd';
import { ClientsPage } from './ClientsPage.js';

describe('ClientsPage', () => {
  const noop = vi.fn();

  it('renders a dedicated version column when the client version is available', async () => {
    const api = {
      get: vi.fn().mockResolvedValue([
        {
          id: 'client-1',
          name: 'Client 1',
          version: '0.1.0',
          online: true,
          status: 'online',
          httpReady: true,
          clientHttpBaseUrl: 'http://127.0.0.1:20004',
          capabilities: { jobs: true },
        },
      ]),
    } as any;

    render(
      <App>
        <ClientsPage
          api={api}
          onViewDetail={noop}
          onOpenFiles={noop}
          onOpenMappings={noop}
          onOpenTasks={noop}
        />
      </App>,
    );

    expect(await screen.findByText('版本')).toBeInTheDocument();
    expect(await screen.findByText('v0.1.0')).toBeInTheDocument();
  });

  it('renders a dash when the client version is missing', async () => {
    const api = {
      get: vi.fn().mockResolvedValue([
        {
          id: 'client-2',
          name: 'Client 2',
          online: true,
          status: 'online',
          httpReady: true,
          clientHttpBaseUrl: 'http://127.0.0.1:20005',
          capabilities: { files: true },
        },
      ]),
    } as any;

    render(
      <App>
        <ClientsPage
          api={api}
          onViewDetail={noop}
          onOpenFiles={noop}
          onOpenMappings={noop}
          onOpenTasks={noop}
        />
      </App>,
    );

    const nameCell = await screen.findByText('Client 2');
    const row = nameCell.closest('tr');
    expect(row).not.toBeNull();
    expect(within(row as HTMLElement).getByText('-')).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @rag/web exec vitest run src/pages/ClientsPage.test.tsx`

Expected: FAIL，第一条测试会因为页面中还没有“版本”列表头或 `v0.1.0` 文本而失败。

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/pages/ClientsPage.test.tsx
git commit -m "test: cover client version column on clients page"
```

### Task 2: 在客户端列表页增加版本列并使测试通过

**Files:**
- Modify: `apps/web/src/pages/ClientsPage.tsx`
- Test: `apps/web/src/pages/ClientsPage.test.tsx`

- [ ] **Step 1: Write minimal implementation**

在 `apps/web/src/pages/ClientsPage.tsx` 的 `columns` 数组中，于“名称”后插入下面这列：

```tsx
{ title: '版本', dataIndex: 'version', key: 'version', width: 100, render: (v?: string) => v ? <Text code>v{v}</Text> : '-' },
```

插入后，表格列顺序应为：

```tsx
columns={[
  { title: 'ID', dataIndex: 'id', key: 'id', width: 150, render: (v: string) => <Text code>{v}</Text> },
  { title: '名称', dataIndex: 'name', key: 'name' },
  { title: '版本', dataIndex: 'version', key: 'version', width: 100, render: (v?: string) => v ? <Text code>v{v}</Text> : '-' },
  { title: '在线', dataIndex: 'online', key: 'online', width: 90, render: (v: boolean) => <StatusTag status={v ? 'online' : 'offline'} /> },
  { title: 'HTTP 就绪', dataIndex: 'httpReady', key: 'httpReady', width: 110, render: (v: boolean) => <StatusTag status={v ? 'active' : 'inactive'} /> },
  {
    title: 'HTTP 地址', dataIndex: 'clientHttpBaseUrl', key: 'http', width: 220,
    render: (v?: string) => v ? <Text code copyable>{v}</Text> : '-',
  },
  {
    title: '能力', dataIndex: 'capabilities', key: 'cap', width: 200,
    render: (cap?: Record<string, boolean>) =>
      cap ? <Space size={4}>{Object.entries(cap).filter(([, v]) => v).map(([k]) => <Tag key={k} style={{ fontSize: 10 }}>{k}</Tag>)}</Space> : '-',
  },
  {
    title: '操作', key: 'actions', width: 250,
    render: (_: unknown, record: ClientSummary) => (
      <Space size={4}>
        <Button size="small" icon={<EyeOutlined />} onClick={() => onViewDetail(record.id)}>详情</Button>
        <Button size="small" onClick={() => onOpenFiles(record.id)}>文件</Button>
        <Button size="small" onClick={() => onOpenMappings(record.id)}>映射</Button>
        <Button size="small" onClick={() => onOpenTasks?.(record.id, record.name)}>任务</Button>
      </Space>
    ),
  },
]}
```

- [ ] **Step 2: Run test to verify it passes**

Run: `pnpm --filter @rag/web exec vitest run src/pages/ClientsPage.test.tsx`

Expected: PASS，两个测试都通过。

- [ ] **Step 3: Run package typecheck**

Run: `pnpm --filter @rag/web typecheck`

Expected: PASS，无 TypeScript 错误。

- [ ] **Step 4: Run package test suite**

Run: `pnpm --filter @rag/web test`

Expected: PASS，`@rag/web` 包所有测试通过。

- [ ] **Step 5: Run repository-wide verification**

Run: `pnpm typecheck && pnpm test`

Expected: PASS，全仓类型检查与测试通过，满足项目收尾要求。

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/pages/ClientsPage.tsx apps/web/src/pages/ClientsPage.test.tsx
git commit -m "feat: show client versions on clients page"
```
