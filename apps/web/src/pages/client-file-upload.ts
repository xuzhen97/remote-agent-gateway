export interface UploadClientFileProgress {
  filename: string;
  uploadedBytes: number;
  totalBytes: number;
  partNumber: number;
  partCount: number;
  attempt: number;
  rateBytesPerSecond: number;
  elapsedMs: number;
}

interface UploadInitResponse {
  uploadId: string;
  rootId: string;
  path: string;
  filename: string;
  size: number;
  chunkSize: number;
  partCount: number;
  uploadedParts: number[];
  uploadedBytes: number;
  resumed: boolean;
}

interface UploadCompleteResponse {
  uploadId: string;
  rootId: string;
  path: string;
  size: number;
}

export async function uploadClientFile(options: {
  baseUrl: string;
  token: string;
  rootId: string;
  path: string;
  file: File;
  chunkSize?: number;
  retries?: number;
  onProgress?: (progress: UploadClientFileProgress) => void;
  retryDelayMs?: (attempt: number) => number;
}): Promise<UploadCompleteResponse> {
  const chunkSize = options.chunkSize ?? 8 * 1024 * 1024;
  const retries = options.retries ?? 5;
  const fingerprint = await createFingerprint(options.file);
  const startedAt = Date.now();

  const init = await requestJson<UploadInitResponse>(options.baseUrl, options.token, '/files/uploads/init', {
    method: 'POST',
    body: {
      rootId: options.rootId,
      path: options.path,
      filename: options.file.name,
      size: options.file.size,
      chunkSize,
      lastModifiedMs: options.file.lastModified,
      fingerprint,
    },
  });

  let uploadedBytes = init.uploadedBytes;
  const uploadedParts = new Set(init.uploadedParts);

  for (let partNumber = 0; partNumber < init.partCount; partNumber += 1) {
    if (uploadedParts.has(partNumber)) continue;
    const offset = partNumber * init.chunkSize;
    const size = resolvePartSize(init, partNumber);
    const chunk = await blobToUint8Array(options.file.slice(offset, offset + size));
    await uploadPartWithRetry(options.baseUrl, options.token, init.uploadId, partNumber, chunk, { offset, size }, retries, options.retryDelayMs);
    uploadedBytes += size;
    options.onProgress?.({
      filename: options.file.name,
      uploadedBytes,
      totalBytes: options.file.size,
      partNumber,
      partCount: init.partCount,
      attempt: 1,
      rateBytesPerSecond: uploadedBytes / Math.max((Date.now() - startedAt) / 1000, 1),
      elapsedMs: Date.now() - startedAt,
    });
  }

  return requestJson<UploadCompleteResponse>(options.baseUrl, options.token, `/files/uploads/${encodeURIComponent(init.uploadId)}/complete`, {
    method: 'POST',
    body: {},
  });
}

function resolvePartSize(init: UploadInitResponse, partNumber: number): number {
  if (partNumber === init.partCount - 1) return init.size - (init.chunkSize * (init.partCount - 1));
  return init.chunkSize;
}

async function createFingerprint(file: File): Promise<string> {
  const head = await blobToUint8Array(file.slice(0, Math.min(file.size, 64 * 1024)));
  const tailStart = Math.max(0, file.size - 64 * 1024);
  const tail = await blobToUint8Array(file.slice(tailStart));
  const input = `${file.size}:${file.lastModified}:${Array.from(head.slice(0, 32)).join(',')}:${Array.from(tail.slice(0, 32)).join(',')}`;
  const data = new TextEncoder().encode(input);
  const digest = await crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(digest)).map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

async function uploadPartWithRetry(
  baseUrl: string,
  token: string,
  uploadId: string,
  partNumber: number,
  chunk: Uint8Array,
  meta: { offset: number; size: number },
  retries: number,
  retryDelayMs?: (attempt: number) => number,
): Promise<void> {
  for (let attempt = 1; attempt <= retries; attempt += 1) {
    try {
      const search = new URLSearchParams({ offset: String(meta.offset), size: String(meta.size) });
      const res = await fetch(`${baseUrl}/files/uploads/${encodeURIComponent(uploadId)}/parts/${partNumber}?${search.toString()}`, {
        method: 'PUT',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/octet-stream',
        },
        body: chunk as BodyInit,
      });
      await readJsonResponse(res);
      return;
    } catch (error) {
      if (!isRetryable(error) || attempt === retries) throw error;
      const waitMs = retryDelayMs ? retryDelayMs(attempt) : resolveBackoffMs(attempt);
      await sleep(waitMs);
    }
  }
}

async function requestJson<T>(baseUrl: string, token: string, path: string, options: { method: string; body?: unknown }): Promise<T> {
  const res = await fetch(`${baseUrl}${path}`, {
    method: options.method,
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
  });
  return readJsonResponse<T>(res);
}

async function readJsonResponse<T>(res: Response): Promise<T> {
  const text = await res.text();
  const payload = text ? JSON.parse(text) : null;
  if (!res.ok) {
    const message = payload?.error?.message ?? payload?.error ?? `HTTP ${res.status}`;
    throw new Error(String(message));
  }
  return (payload?.data ?? payload) as T;
}

async function blobToUint8Array(blob: Blob): Promise<Uint8Array> {
  const buffer = await new Response(blob).arrayBuffer();
  return new Uint8Array(buffer);
}

function isRetryable(error: unknown): boolean {
  const message = error instanceof Error ? error.message.toLowerCase() : String(error).toLowerCase();
  return message.includes('gateway timeout') || message.includes('fetch failed') || message.includes('econnreset') || message.includes('etimedout') || message.includes('socket hang up') || message.includes('http 502') || message.includes('http 503') || message.includes('http 504');
}

function resolveBackoffMs(attempt: number): number {
  return [0, 2000, 5000, 10000, 10000, 10000][attempt] ?? 10000;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
