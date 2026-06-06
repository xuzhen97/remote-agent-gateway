import type { Api } from '../api/http';

export interface UploadStageState {
  key: string;
  label: string;
  status: 'waiting' | 'running' | 'completed' | 'failed';
  percent?: number;
  detailText?: string;
}

export interface RelayUploadUiState {
  requestedMode: 'auto' | 'aliyundrive' | 'direct';
  resolvedMode: 'aliyundrive' | 'direct' | null;
  transferId?: string;
  overallPercent: number;
  overallStatusText: string;
  stages: UploadStageState[];
}

interface RelayAliyunPlan {
  mode: 'aliyundrive';
  transferId: string;
  partSize: number;
  partCount: number;
  uploadParts: Array<{ partNumber: number; uploadUrl: string; size: number }>;
}

interface TransferJobLike {
  id: string;
  status: string;
  uploadedBytes?: number;
  downloadedBytes?: number;
  writtenBytes?: number;
  totalBytes: number;
  errorMessage?: string | null;
}

export async function uploadClientFileViaRelay(options: {
  api: Api;
  clientId: string;
  rootId: string;
  path: string;
  file: File;
  requestedMode: 'auto' | 'aliyundrive' | 'direct';
  onStateChange?: (state: RelayUploadUiState) => void;
  fetchImpl?: typeof fetch;
  pollIntervalMs?: number;
}): Promise<
  | { kind: 'fallback_to_direct'; reason: 'server_returned_frps_chunked' }
  | { kind: 'completed'; transferId: string; resolvedMode: 'aliyundrive' }
> {
  const createResult = await options.api.post('/api/transfers/uploads', {
    clientId: options.clientId,
    rootId: options.rootId,
    path: options.path,
    filename: options.file.name,
    size: options.file.size,
    transfer: options.requestedMode,
  });

  if ((createResult as { mode?: string }).mode === 'frps_chunked') {
    options.onStateChange?.({
      requestedMode: options.requestedMode,
      resolvedMode: 'direct',
      overallPercent: 5,
      overallStatusText: '阿里云中转不可用，已自动回退为直传',
      stages: [
        { key: 'prepare', label: '准备上传', status: 'completed', percent: 100, detailText: '已切换到直传' },
      ],
    });
    return { kind: 'fallback_to_direct', reason: 'server_returned_frps_chunked' };
  }

  const plan = createResult as RelayAliyunPlan;
  const fetchImpl = options.fetchImpl ?? fetch;
  const pollIntervalMs = options.pollIntervalMs ?? 1000;
  let uploadedBytes = 0;

  options.onStateChange?.(buildRelayUiState({
    requestedMode: options.requestedMode,
    transferId: plan.transferId,
    phase: 'creating',
    uploadedBytes: 0,
    totalBytes: options.file.size,
  }));

  for (const part of plan.uploadParts) {
    const offset = (part.partNumber - 1) * plan.partSize;
    const chunk = options.file.slice(offset, offset + part.size);
    let uploadUrl = part.uploadUrl;
    for (let attempt = 1; attempt <= 5; attempt += 1) {
      const res = await fetchImpl(uploadUrl, { method: 'PUT', headers: { 'Content-Type': '' }, body: chunk });
      if (res.ok) break;
      if ((res.status === 401 || res.status === 403) && attempt < 5) {
        const refreshed = await options.api.post(`/api/transfers/${encodeURIComponent(plan.transferId)}/refresh-upload-url`, {
          partNumbers: [part.partNumber],
        }) as { uploadParts?: Array<{ partNumber: number; uploadUrl: string; size: number }> };
        uploadUrl = refreshed.uploadParts?.find((item) => item.partNumber === part.partNumber)?.uploadUrl ?? uploadUrl;
        await sleep(250 * attempt);
        continue;
      }
      throw new Error(`Upload part ${part.partNumber} failed: HTTP ${res.status}`);
    }

    uploadedBytes += part.size;
    await options.api.post(`/api/transfers/${encodeURIComponent(plan.transferId)}/cli-progress`, {
      uploadedBytes,
      totalBytes: options.file.size,
      currentPart: part.partNumber,
    });
    options.onStateChange?.(buildRelayUiState({
      requestedMode: options.requestedMode,
      transferId: plan.transferId,
      phase: 'aliyun_uploading',
      uploadedBytes,
      totalBytes: options.file.size,
      partNumber: part.partNumber,
      partCount: plan.partCount,
    }));
  }

  await options.api.post(`/api/transfers/${encodeURIComponent(plan.transferId)}/cli-upload-complete`, {});
  options.onStateChange?.(buildRelayUiState({
    requestedMode: options.requestedMode,
    transferId: plan.transferId,
    phase: 'waiting_client_download',
    uploadedBytes: options.file.size,
    totalBytes: options.file.size,
  }));

  for (let i = 0; i < 300; i += 1) {
    const job = await options.api.get(`/api/transfers/${encodeURIComponent(plan.transferId)}`) as TransferJobLike;
    options.onStateChange?.(mapTransferJobToRelayUiState(job, options.requestedMode));
    if (job.status === 'completed') return { kind: 'completed', transferId: plan.transferId, resolvedMode: 'aliyundrive' };
    if (job.status === 'failed') throw new Error(job.errorMessage ?? 'Transfer failed');
    await sleep(pollIntervalMs);
  }

  throw new Error('Transfer timed out');
}

export function mapTransferJobToRelayUiState(job: TransferJobLike, requestedMode: 'auto' | 'aliyundrive' | 'direct'): RelayUploadUiState {
  const totalBytes = Math.max(job.totalBytes, 1);
  const uploadedBytes = job.uploadedBytes ?? totalBytes;
  const downloadedBytes = job.downloadedBytes ?? 0;
  const writtenBytes = job.writtenBytes ?? 0;

  if (job.status === 'completed') {
    return {
      requestedMode,
      resolvedMode: 'aliyundrive',
      transferId: job.id,
      overallPercent: 100,
      overallStatusText: '上传完成',
      stages: [
        { key: 'create', label: '创建 transfer', status: 'completed', percent: 100, detailText: job.id },
        { key: 'aliyun', label: '上传到阿里云', status: 'completed', percent: 100, detailText: `${uploadedBytes}/${job.totalBytes}` },
        { key: 'download', label: '客户端下载', status: 'completed', percent: 100, detailText: `${downloadedBytes}/${job.totalBytes}` },
        { key: 'write', label: '客户端写入完成', status: 'completed', percent: 100, detailText: `${writtenBytes || job.totalBytes}/${job.totalBytes}` },
      ],
    };
  }

  if (job.status === 'client_downloading') {
    const downloadPercent = Math.min(100, (downloadedBytes / totalBytes) * 100);
    const writePercent = Math.min(100, (writtenBytes / totalBytes) * 100);
    return {
      requestedMode,
      resolvedMode: 'aliyundrive',
      transferId: job.id,
      overallPercent: 60 + (downloadPercent * 0.25) + (writePercent * 0.15),
      overallStatusText: writtenBytes > 0 ? '客户端正在写入目标目录' : '客户端正在下载',
      stages: [
        { key: 'create', label: '创建 transfer', status: 'completed', percent: 100, detailText: job.id },
        { key: 'aliyun', label: '上传到阿里云', status: 'completed', percent: 100, detailText: `${uploadedBytes}/${job.totalBytes}` },
        { key: 'download', label: '客户端下载', status: 'running', percent: downloadPercent, detailText: `${downloadedBytes}/${job.totalBytes}` },
        { key: 'write', label: '客户端写入完成', status: writtenBytes > 0 ? 'running' : 'waiting', percent: writePercent, detailText: writtenBytes > 0 ? `${writtenBytes}/${job.totalBytes}` : '等待中' },
      ],
    };
  }

  if (job.status === 'waiting_client_download' || job.status === 'aliyun_uploaded') {
    return buildRelayUiState({
      requestedMode,
      transferId: job.id,
      phase: 'waiting_client_download',
      uploadedBytes,
      totalBytes: job.totalBytes,
    });
  }

  if (job.status === 'failed') {
    return {
      requestedMode,
      resolvedMode: 'aliyundrive',
      transferId: job.id,
      overallPercent: 0,
      overallStatusText: job.errorMessage ?? '传输失败',
      stages: [
        { key: 'create', label: '创建 transfer', status: 'completed', percent: 100, detailText: job.id },
        { key: 'aliyun', label: '上传到阿里云', status: 'failed', percent: uploadedBytes > 0 ? (uploadedBytes / totalBytes) * 100 : 0, detailText: job.errorMessage ?? '失败' },
        { key: 'download', label: '客户端下载', status: 'waiting', percent: 0, detailText: '未开始' },
        { key: 'write', label: '客户端写入完成', status: 'waiting', percent: 0, detailText: '未开始' },
      ],
    };
  }

  return buildRelayUiState({
    requestedMode,
    transferId: job.id,
    phase: 'aliyun_uploading',
    uploadedBytes,
    totalBytes: job.totalBytes,
  });
}

function buildRelayUiState(input: {
  requestedMode: 'auto' | 'aliyundrive' | 'direct';
  transferId: string;
  phase: 'creating' | 'aliyun_uploading' | 'waiting_client_download';
  uploadedBytes: number;
  totalBytes: number;
  partNumber?: number;
  partCount?: number;
}): RelayUploadUiState {
  const uploadPercent = input.totalBytes > 0 ? Math.min(100, (input.uploadedBytes / input.totalBytes) * 100) : 0;
  if (input.phase === 'creating') {
    return {
      requestedMode: input.requestedMode,
      resolvedMode: 'aliyundrive',
      transferId: input.transferId,
      overallPercent: 5,
      overallStatusText: '正在创建传输任务',
      stages: [
        { key: 'create', label: '创建 transfer', status: 'running', percent: 50, detailText: input.transferId },
        { key: 'aliyun', label: '上传到阿里云', status: 'waiting', percent: 0, detailText: '等待中' },
        { key: 'download', label: '客户端下载', status: 'waiting', percent: 0, detailText: '等待中' },
        { key: 'write', label: '客户端写入完成', status: 'waiting', percent: 0, detailText: '等待中' },
      ],
    };
  }

  if (input.phase === 'waiting_client_download') {
    return {
      requestedMode: input.requestedMode,
      resolvedMode: 'aliyundrive',
      transferId: input.transferId,
      overallPercent: 60,
      overallStatusText: '正在等待客户端下载',
      stages: [
        { key: 'create', label: '创建 transfer', status: 'completed', percent: 100, detailText: input.transferId },
        { key: 'aliyun', label: '上传到阿里云', status: 'completed', percent: 100, detailText: `${input.uploadedBytes}/${input.totalBytes}` },
        { key: 'download', label: '客户端下载', status: 'running', percent: 0, detailText: '等待 client 开始下载' },
        { key: 'write', label: '客户端写入完成', status: 'waiting', percent: 0, detailText: '等待中' },
      ],
    };
  }

  return {
    requestedMode: input.requestedMode,
    resolvedMode: 'aliyundrive',
    transferId: input.transferId,
    overallPercent: 5 + (uploadPercent * 0.55),
    overallStatusText: '正在上传到阿里云盘',
    stages: [
      { key: 'create', label: '创建 transfer', status: 'completed', percent: 100, detailText: input.transferId },
      { key: 'aliyun', label: '上传到阿里云', status: 'running', percent: uploadPercent, detailText: `${input.uploadedBytes}/${input.totalBytes} | part ${input.partNumber ?? 0}/${input.partCount ?? 0}` },
      { key: 'download', label: '客户端下载', status: 'waiting', percent: 0, detailText: '等待中' },
      { key: 'write', label: '客户端写入完成', status: 'waiting', percent: 0, detailText: '等待中' },
    ],
  };
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
