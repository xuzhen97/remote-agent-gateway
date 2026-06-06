# Web Client Upload Mode Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在 Web 客户端文件管理上传弹窗中支持 `auto / aliyundrive / direct` 三种上传模式，并在阿里云中转场景下展示“总进度 + 分阶段进度”。

**Architecture:** 保持现有直传 helper `client-file-upload.ts` 不变，新增独立的 Web 阿里云中转 helper 负责 transfer 创建、阿里云 PUT 分片、进度上报和 transfer 轮询。`ClientFilesPage.tsx` 仅负责模式选择、状态渲染和目录刷新，通过统一 UI 状态模型承载 direct / relay 两种路径。

**Tech Stack:** React, Ant Design, Vitest, Fastify, existing transfer APIs, browser fetch

---

### Task 1: 补齐 server `refresh-upload-url` 的真实实现

**Files:**
- Modify: `apps/server/src/modules/transfers/transfer.service.ts`
- Modify: `apps/server/src/modules/transfers/transfer.routes.ts`
- Modify: `apps/server/src/modules/transfers/transfer.routes.test.ts`
- Test: `apps/server/src/modules/transfers/transfer.routes.test.ts`

- [ ] **Step 1: 写失败测试，要求 `refresh-upload-url` 返回真实 uploadParts**

```ts
it('returns refreshed aliyun upload urls', async () => {
  const app = Fastify();
  await app.register(transferRoutes);
  const res = await app.inject({
    method: 'POST',
    url: '/api/transfers/tr_1/refresh-upload-url',
    headers: { authorization: 'Bearer token' },
    payload: { partNumbers: [1, 2] },
  });
  expect(res.statusCode).toBe(200);
  expect(res.json()).toEqual({
    uploadParts: [
      { partNumber: 1, uploadUrl: 'https://upload.example/1', size: 8 },
      { partNumber: 2, uploadUrl: 'https://upload.example/2', size: 2 },
    ],
  });
});
```

- [ ] **Step 2: 运行测试并确认失败**

Run: `pnpm --filter @rag/server test -- src/modules/transfers/transfer.routes.test.ts`
Expected: FAIL，因为当前路由返回 `{ uploadParts: [] }`。

- [ ] **Step 3: 在 service 中新增真实 `refreshUploadUrl()`，并在 route 中调用**

```ts
async refreshUploadUrl(transferId: string, partNumbers?: number[]) {
  const stmt = getDb().prepare(
    'SELECT aliyun_drive_id, aliyun_file_id, aliyun_upload_id, total_bytes FROM transfer_jobs WHERE id = ?',
  );
  stmt.bind([transferId]);
  try {
    if (!stmt.step()) throw new Error('Transfer not found');
    const row = stmt.getAsObject() as Record<string, unknown>;
    const driveId = String(row.aliyun_drive_id ?? '');
    const fileId = String(row.aliyun_file_id ?? '');
    const uploadId = String(row.aliyun_upload_id ?? '');
    if (!driveId || !fileId || !uploadId) throw new Error('Aliyun transfer metadata is missing');
    const config = aliyunDriveAuthService.getConfig();
    const auth = aliyunDriveAuthService.getAuth();
    if (!config || !auth?.accessToken) throw new Error('Aliyun Drive auth is missing');
    const client = new AliyunDriveOpenApiClient({ openapiBase: config.openapiBase, accessToken: auth.accessToken });
    const result = await client.getUploadUrl({ driveId, fileId, uploadId, partNumbers: partNumbers?.length ? partNumbers : [1] });
    const remoteParts = (result.part_info_list ?? []) as Array<Record<string, unknown>>;
    return {
      uploadParts: remoteParts.map((part) => ({
        partNumber: Number(part.part_number),
        uploadUrl: String(part.upload_url),
        size: Number(part.size ?? 0),
      })),
    };
  } finally {
    stmt.free();
  }
}
```

```ts
app.post<{ Params: { transferId: string } }>('/api/transfers/:transferId/refresh-upload-url', async (request, reply) => {
  const parsed = RefreshUrlSchema.safeParse(request.body ?? {});
  if (!parsed.success) return reply.code(400).send({ error: parsed.error.message });
  try {
    return reply.send(await transferService.refreshUploadUrl(request.params.transferId, parsed.data.partNumbers));
  } catch (error) {
    return reply.code(400).send({ error: error instanceof Error ? error.message : String(error) });
  }
});
```

- [ ] **Step 4: 更新 route mock 让测试变绿**

```ts
refreshUploadUrl: vi.fn(async () => ({
  uploadParts: [
    { partNumber: 1, uploadUrl: 'https://upload.example/1', size: 8 },
    { partNumber: 2, uploadUrl: 'https://upload.example/2', size: 2 },
  ],
})),
```

- [ ] **Step 5: 运行测试确认通过**

Run: `pnpm --filter @rag/server test -- src/modules/transfers/transfer.routes.test.ts`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add apps/server/src/modules/transfers/transfer.service.ts apps/server/src/modules/transfers/transfer.routes.ts apps/server/src/modules/transfers/transfer.routes.test.ts
git commit -m "feat(server): refresh aliyundrive upload urls for web relay"
```

### Task 2: 新增 Web relay upload helper 及其单测

**Files:**
- Create: `apps/web/src/pages/client-file-relay-upload.ts`
- Create: `apps/web/src/pages/client-file-relay-upload.test.ts`
- Test: `apps/web/src/pages/client-file-relay-upload.test.ts`

- [ ] **Step 1: 先写 relay helper 的失败测试，覆盖 auto 命中 aliyundrive / frps_chunked 两条路径**

```ts
it('falls back to direct when auto resolves to frps_chunked', async () => {
  const api = { post: vi.fn(async () => ({ mode: 'frps_chunked' })), get: vi.fn(), put: vi.fn(), delete: vi.fn() } as any;
  const file = new File(['hello'], 'demo.bin');
  const result = await uploadClientFileViaRelay({
    api,
    clientId: 'client-1',
    rootId: 'root-0',
    path: '.',
    file,
    requestedMode: 'auto',
    onStateChange: vi.fn(),
  });
  expect(result).toEqual({ kind: 'fallback_to_direct', reason: 'server_returned_frps_chunked' });
});

it('uploads parts to aliyun and polls transfer until completed', async () => {
  const fetchMock = vi.fn()
    .mockResolvedValueOnce(new Response('', { status: 200 }))
    .mockResolvedValueOnce(new Response('', { status: 200 }));
  const api = {
    post: vi.fn(async (path: string, body?: unknown) => {
      if (path === '/api/transfers/uploads') {
        return {
          mode: 'aliyundrive',
          transferId: 'tr_1',
          accessToken: 'token',
          openapiBase: 'https://openapi.alipan.com',
          driveId: 'drive-1',
          fileId: 'file-1',
          uploadId: 'upload-1',
          partSize: 3,
          partCount: 2,
          uploadParts: [
            { partNumber: 1, uploadUrl: 'https://upload.example/1', size: 3 },
            { partNumber: 2, uploadUrl: 'https://upload.example/2', size: 2 },
          ],
        };
      }
      if (path === '/api/transfers/tr_1/cli-progress') return { ok: true };
      if (path === '/api/transfers/tr_1/cli-upload-complete') return { ok: true };
      throw new Error(`unexpected post ${path}`);
    }),
    get: vi.fn(async () => ({ id: 'tr_1', status: 'completed', downloadedBytes: 5, writtenBytes: 5, totalBytes: 5 })),
    put: vi.fn(),
    delete: vi.fn(),
  } as any;
  const onStateChange = vi.fn();
  const file = new File(['hello'], 'demo.bin');
  const result = await uploadClientFileViaRelay({ api, clientId: 'client-1', rootId: 'root-0', path: '.', file, requestedMode: 'aliyundrive', onStateChange, fetchImpl: fetchMock });
  expect(result).toEqual({ kind: 'completed', transferId: 'tr_1', resolvedMode: 'aliyundrive' });
  expect(onStateChange).toHaveBeenCalled();
  expect(fetchMock).toHaveBeenCalledTimes(2);
});
```

- [ ] **Step 2: 运行测试并确认失败**

Run: `pnpm --filter @rag/web test -- src/pages/client-file-relay-upload.test.ts`
Expected: FAIL，因为 helper 文件尚不存在。

- [ ] **Step 3: 实现 relay helper，包含 PUT 分片、progress 上报、polling、URL 刷新**

```ts
export async function uploadClientFileViaRelay(options: {
  api: Api;
  clientId: string;
  rootId: string;
  path: string;
  file: File;
  requestedMode: 'auto' | 'aliyundrive' | 'direct';
  onStateChange?: (state: RelayUploadUiState) => void;
  fetchImpl?: typeof fetch;
}) {
  const createResult = await options.api.post('/api/transfers/uploads', {
    clientId: options.clientId,
    rootId: options.rootId,
    path: options.path,
    filename: options.file.name,
    size: options.file.size,
    transfer: options.requestedMode,
  });

  if ((createResult as any).mode === 'frps_chunked') {
    return { kind: 'fallback_to_direct', reason: 'server_returned_frps_chunked' } as const;
  }

  const plan = createResult as RelayAliyunPlan;
  const fetchImpl = options.fetchImpl ?? fetch;
  let uploadedBytes = 0;
  for (const part of plan.uploadParts) {
    const offset = (part.partNumber - 1) * plan.partSize;
    const chunk = options.file.slice(offset, offset + part.size);
    let uploadUrl = part.uploadUrl;
    for (let attempt = 1; attempt <= 5; attempt += 1) {
      const res = await fetchImpl(uploadUrl, { method: 'PUT', headers: { 'Content-Type': '' }, body: chunk });
      if (res.ok) break;
      if ((res.status === 401 || res.status === 403) && attempt < 5) {
        const refreshed = await options.api.post(`/api/transfers/${encodeURIComponent(plan.transferId)}/refresh-upload-url`, { partNumbers: [part.partNumber] }) as { uploadParts: Array<{ partNumber: number; uploadUrl: string; size: number }> };
        uploadUrl = refreshed.uploadParts[0]?.uploadUrl ?? uploadUrl;
        continue;
      }
      throw new Error(`Upload part ${part.partNumber} failed: HTTP ${res.status}`);
    }
    uploadedBytes += part.size;
    await options.api.post(`/api/transfers/${encodeURIComponent(plan.transferId)}/cli-progress`, { uploadedBytes, totalBytes: options.file.size, currentPart: part.partNumber });
    options.onStateChange?.(buildRelayUiState({ requestedMode: options.requestedMode, resolvedMode: 'aliyundrive', transferId: plan.transferId, phase: 'aliyun_uploading', uploadedBytes, totalBytes: options.file.size }));
  }

  await options.api.post(`/api/transfers/${encodeURIComponent(plan.transferId)}/cli-upload-complete`, {});

  for (let i = 0; i < 300; i += 1) {
    const job = await options.api.get(`/api/transfers/${encodeURIComponent(plan.transferId)}`) as TransferListItem;
    options.onStateChange?.(mapTransferJobToRelayUiState(job, options.requestedMode));
    if (job.status === 'completed') return { kind: 'completed', transferId: plan.transferId, resolvedMode: 'aliyundrive' } as const;
    if (job.status === 'failed') throw new Error(job.errorMessage ?? 'Transfer failed');
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }

  throw new Error('Transfer timed out');
}
```

- [ ] **Step 4: 运行测试确认通过**

Run: `pnpm --filter @rag/web test -- src/pages/client-file-relay-upload.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/pages/client-file-relay-upload.ts apps/web/src/pages/client-file-relay-upload.test.ts
git commit -m "feat(web): add relay upload helper for client files"
```

### Task 3: 先写页面测试，覆盖模式选择、回退提示和阶段进度渲染

**Files:**
- Modify: `apps/web/src/pages/ClientFilesPage.test.tsx`
- Test: `apps/web/src/pages/ClientFilesPage.test.tsx`

- [ ] **Step 1: 扩展页面测试，先让它失败**

```ts
const uploadClientFileViaRelayMock = vi.fn();

vi.mock('./client-file-relay-upload.js', () => ({
  uploadClientFileViaRelay: (...args: unknown[]) => uploadClientFileViaRelayMock(...args),
}));

it('shows mode select and uses direct upload helper', async () => {
  uploadClientFileMock.mockResolvedValue({ uploadId: 'upl_1', rootId: 'root-0', path: 'demo.jar', size: 12 });
  render(<ClientFilesPage api={{} as any} clientId="client-1" clientName="Client 1" onBack={vi.fn()} />);
  expect(await screen.findByText('文件管理 — Client 1')).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: /上传文件/ }));
  expect(screen.getByText('自动（推荐）')).toBeInTheDocument();
  fireEvent.mouseDown(screen.getByLabelText('上传模式'));
  fireEvent.click(await screen.findByText('直传'));
  const input = document.querySelector('input[type="file"]') as HTMLInputElement;
  const file = new File(['hello world'], 'demo.jar');
  fireEvent.change(input, { target: { files: [file] } });
  await waitFor(() => expect(uploadClientFileMock).toHaveBeenCalled());
  expect(uploadClientFileViaRelayMock).not.toHaveBeenCalled();
});

it('uses relay helper and renders fallback message from auto mode', async () => {
  uploadClientFileViaRelayMock.mockImplementation(async ({ onStateChange }: any) => {
    onStateChange({ overallPercent: 5, overallStatusText: '阿里云中转不可用，已自动回退为直传', stages: [] });
    return { kind: 'fallback_to_direct', reason: 'server_returned_frps_chunked' };
  });
  render(<ClientFilesPage api={{} as any} clientId="client-1" clientName="Client 1" onBack={vi.fn()} />);
  fireEvent.click(await screen.findByRole('button', { name: /上传文件/ }));
  const input = document.querySelector('input[type="file"]') as HTMLInputElement;
  fireEvent.change(input, { target: { files: [new File(['hello'], 'demo.bin')] } });
  expect(await screen.findByText(/已自动回退为直传/)).toBeInTheDocument();
});

it('renders relay stage details', async () => {
  uploadClientFileViaRelayMock.mockImplementation(async ({ onStateChange }: any) => {
    onStateChange({
      overallPercent: 72,
      overallStatusText: '客户端正在下载',
      stages: [
        { key: 'create', label: '创建 transfer', status: 'completed', percent: 100, detailText: 'tr_1' },
        { key: 'aliyun', label: '上传到阿里云', status: 'completed', percent: 100, detailText: '5/5' },
        { key: 'download', label: '客户端下载', status: 'running', percent: 48, detailText: '48/100' },
        { key: 'write', label: '客户端写入完成', status: 'waiting', percent: 0, detailText: '等待中' },
      ],
    });
    return { kind: 'completed', transferId: 'tr_1', resolvedMode: 'aliyundrive' };
  });
  render(<ClientFilesPage api={{} as any} clientId="client-1" clientName="Client 1" onBack={vi.fn()} />);
  fireEvent.click(await screen.findByRole('button', { name: /上传文件/ }));
  const input = document.querySelector('input[type="file"]') as HTMLInputElement;
  fireEvent.change(input, { target: { files: [new File(['hello'], 'demo.bin')] } });
  expect(await screen.findByText(/客户端正在下载/)).toBeInTheDocument();
  expect(await screen.findByText('创建 transfer')).toBeInTheDocument();
  expect(await screen.findByText('上传到阿里云')).toBeInTheDocument();
  expect(await screen.findByText('客户端下载')).toBeInTheDocument();
  expect(await screen.findByText('客户端写入完成')).toBeInTheDocument();
});
```

- [ ] **Step 2: 运行测试并确认失败**

Run: `pnpm --filter @rag/web test -- src/pages/ClientFilesPage.test.tsx`
Expected: FAIL，因为页面尚无模式选择器和 relay UI。

- [ ] **Step 3: 实现最小页面状态结构，直到测试变绿**

```ts
const [uploadMode, setUploadMode] = useState<'auto' | 'aliyundrive' | 'direct'>('auto');
const [uploadProgress, setUploadProgress] = useState<UploadDialogState | null>(null);
```

```tsx
<Select
  aria-label="上传模式"
  value={uploadMode}
  style={{ width: '100%', marginBottom: 12 }}
  options={[
    { value: 'auto', label: '自动（推荐）' },
    { value: 'aliyundrive', label: '阿里云中转' },
    { value: 'direct', label: '直传' },
  ]}
  onChange={(value) => setUploadMode(value)}
/>
```

```tsx
{uploadProgress && (
  <Alert
    type="info"
    showIcon
    style={{ marginBottom: 12 }}
    message={`上传进度 ${uploadProgress.overallPercent.toFixed(1)}%`}
    description={uploadProgress.overallStatusText}
  />
)}
```

```tsx
<Table
  pagination={false}
  size="small"
  rowKey="key"
  dataSource={uploadProgress?.stages ?? []}
  columns={[
    { title: '阶段', dataIndex: 'label', key: 'label' },
    { title: '状态', dataIndex: 'status', key: 'status' },
    { title: '进度', key: 'percent', render: (_: unknown, row: UploadStageState) => `${row.percent ?? 0}%` },
    { title: '说明', dataIndex: 'detailText', key: 'detailText' },
  ]}
/>
```

- [ ] **Step 4: 运行测试确认通过**

Run: `pnpm --filter @rag/web test -- src/pages/ClientFilesPage.test.tsx`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/pages/ClientFilesPage.test.tsx apps/web/src/pages/ClientFilesPage.tsx
git commit -m "test(web): cover upload mode selection and relay progress ui"
```

### Task 4: 完成页面上传逻辑接线与最终验证

**Files:**
- Modify: `apps/web/src/pages/ClientFilesPage.tsx`
- Modify: `apps/web/src/pages/client-file-upload.ts` (仅在需要导出 shared type/helper 时改动)
- Modify: `apps/web/src/pages/client-file-relay-upload.ts`
- Test: `apps/web/src/pages/ClientFilesPage.test.tsx`
- Test: `apps/web/src/pages/client-file-relay-upload.test.ts`

- [ ] **Step 1: 先让 direct / relay / auto 三种路径都走通同一上传入口**

```ts
async function handleUpload(file: File) {
  if (uploadMode === 'direct') {
    await uploadClientFile({
      baseUrl,
      token,
      rootId,
      path: currentPath,
      file,
      onProgress: (progress) => setUploadProgress(mapDirectProgressToDialogState(progress)),
    });
    return;
  }

  const relayResult = await uploadClientFileViaRelay({
    api,
    clientId,
    rootId,
    path: currentPath,
    file,
    requestedMode: uploadMode,
    onStateChange: setUploadProgress,
  });

  if (relayResult.kind === 'fallback_to_direct') {
    await uploadClientFile({
      baseUrl,
      token,
      rootId,
      path: currentPath,
      file,
      onProgress: (progress) => setUploadProgress(mapDirectProgressToDialogState(progress, '阿里云中转不可用，已自动回退为直传')),
    });
  }
}
```

- [ ] **Step 2: 在页面里补充 direct 进度到统一 UI 模型的映射函数**

```ts
function mapDirectProgressToDialogState(progress: UploadClientFileProgress, fallbackMessage?: string): UploadDialogState {
  const percent = progress.totalBytes > 0 ? (progress.uploadedBytes / progress.totalBytes) * 100 : 0;
  const kbPerSecond = (progress.rateBytesPerSecond / 1024).toFixed(1);
  const remainingBytes = progress.totalBytes - progress.uploadedBytes;
  const etaSeconds = progress.rateBytesPerSecond <= 0 ? 0 : Math.ceil(remainingBytes / progress.rateBytesPerSecond);
  return {
    requestedMode: fallbackMessage ? 'auto' : 'direct',
    resolvedMode: 'direct',
    overallPercent: percent,
    overallStatusText: fallbackMessage ?? `正在直传到客户端 ${percent.toFixed(1)}%`,
    stages: [
      { key: 'prepare', label: '准备上传', status: 'completed', percent: 100, detailText: progress.filename },
      { key: 'direct', label: '直传到客户端', status: progress.uploadedBytes === progress.totalBytes ? 'completed' : 'running', percent, detailText: `${progress.uploadedBytes}/${progress.totalBytes} | ${kbPerSecond} KB/s | ETA ${etaSeconds}s | chunk ${progress.partNumber + 1}/${progress.partCount}` },
      { key: 'write', label: '写入完成', status: progress.uploadedBytes === progress.totalBytes ? 'completed' : 'waiting', percent: progress.uploadedBytes === progress.totalBytes ? 100 : 0, detailText: progress.uploadedBytes === progress.totalBytes ? '等待服务端确认完成' : '等待中' },
    ],
  };
}
```

- [ ] **Step 3: 完成弹窗成功/失败收尾逻辑**

```ts
try {
  await handleUpload(file as File);
  message.success('Uploaded');
  setUploadOpen(false);
  setUploadProgress(null);
  setReloadKey((k) => k + 1);
  (onSuccess as any)?.();
} catch (err: any) {
  const next = uploadProgress ? { ...uploadProgress, overallStatusText: err.message } : null;
  if (next) setUploadProgress(next);
  message.error(err.message);
  (onError as any)?.(err);
}
```

- [ ] **Step 4: 运行 web 相关测试**

Run: `pnpm --filter @rag/web test -- src/pages/client-file-relay-upload.test.ts src/pages/ClientFilesPage.test.tsx`
Expected: PASS

- [ ] **Step 5: 运行全量验证**

Run: `pnpm test && pnpm typecheck`
Expected: all green, including existing apps/web, apps/server, apps/client, apps/cli suites

- [ ] **Step 6: 浏览器手工验证**

Run dev server: `pnpm dev`
Manual checks:
1. 打开 `http://localhost:5174`
2. 进入“客户端 -> 文件管理 -> 上传文件”
3. 确认模式选择器默认是“自动（推荐）”
4. 选“直传”上传一个小文件，确认显示直传阶段进度并最终刷新列表
5. 选“阿里云中转”上传一个小文件，确认显示“创建 transfer / 上传到阿里云 / 客户端下载 / 客户端写入完成”四段进度
6. 若 `auto` 命中回退，确认页面显示“已自动回退为直传”

- [ ] **Step 7: Commit**

```bash
git add apps/web/src/pages/ClientFilesPage.tsx apps/web/src/pages/client-file-upload.ts apps/web/src/pages/client-file-relay-upload.ts apps/web/src/pages/ClientFilesPage.test.tsx apps/web/src/pages/client-file-relay-upload.test.ts apps/server/src/modules/transfers/transfer.service.ts apps/server/src/modules/transfers/transfer.routes.ts apps/server/src/modules/transfers/transfer.routes.test.ts
git commit -m "feat(web): support upload mode selection and relay progress"
```
