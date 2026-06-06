import { randomUUID } from 'node:crypto';
import * as fs from 'node:fs';
import * as path from 'node:path';
import type {
  ClientFileUploadAbortResult,
  ClientFileUploadCompleteResult,
  ClientFileUploadInitResult,
  ClientFileUploadStatusResult,
} from '@rag/shared';

interface UploadSessionMeta {
  uploadId: string;
  rootId: string;
  targetPath: string;
  filename: string;
  size: number;
  chunkSize: number;
  partCount: number;
  fingerprint: string;
  resolvedTargetDir: string;
  createdAt: number;
  updatedAt: number;
}

interface UploadSessionState {
  uploadedParts: number[];
  uploadedBytes: number;
}

interface InitInput {
  rootId: string;
  targetPath: string;
  filename: string;
  size: number;
  chunkSize: number;
  fingerprint: string;
  resolvedTargetDir?: string;
}

interface WritePartOptions {
  expectedSize: number;
  expectedOffset: number;
}

export function createUploadSessionManager(options: { workspaceDir: string; ttlMs: number }) {
  const sessionsRoot = path.join(options.workspaceDir, '.rag-upload-sessions');

  function ensureDir(dir: string): void {
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  }

  function sessionDir(uploadId: string): string {
    return path.join(sessionsRoot, uploadId);
  }

  function metaPath(uploadId: string): string {
    return path.join(sessionDir(uploadId), 'meta.json');
  }

  function statePath(uploadId: string): string {
    return path.join(sessionDir(uploadId), 'state.json');
  }

  function partPath(uploadId: string, partNumber: number): string {
    return path.join(sessionDir(uploadId), `part-${String(partNumber).padStart(6, '0')}`);
  }

  function readMeta(uploadId: string): UploadSessionMeta {
    return JSON.parse(fs.readFileSync(metaPath(uploadId), 'utf8')) as UploadSessionMeta;
  }

  function readState(uploadId: string): UploadSessionState {
    return JSON.parse(fs.readFileSync(statePath(uploadId), 'utf8')) as UploadSessionState;
  }

  function writeState(uploadId: string, state: UploadSessionState): void {
    fs.writeFileSync(statePath(uploadId), JSON.stringify(state, null, 2));
  }

  function toInitResult(meta: UploadSessionMeta, state: UploadSessionState, resumed: boolean): ClientFileUploadInitResult {
    return {
      uploadId: meta.uploadId,
      rootId: meta.rootId,
      path: meta.targetPath,
      filename: meta.filename,
      size: meta.size,
      chunkSize: meta.chunkSize,
      partCount: meta.partCount,
      uploadedParts: [...state.uploadedParts].sort((a, b) => a - b),
      uploadedBytes: state.uploadedBytes,
      resumed,
    };
  }

  function toStatusResult(meta: UploadSessionMeta, state: UploadSessionState): ClientFileUploadStatusResult {
    return {
      ...toInitResult(meta, state, true),
      expiresAt: meta.updatedAt + options.ttlMs,
    };
  }

  function listUploadIds(): string[] {
    if (!fs.existsSync(sessionsRoot)) return [];
    return fs.readdirSync(sessionsRoot).filter((entry) => fs.existsSync(metaPath(entry)));
  }

  function findReusableSession(input: InitInput): UploadSessionMeta | null {
    for (const uploadId of listUploadIds()) {
      const meta = readMeta(uploadId);
      if (
        meta.rootId === input.rootId &&
        meta.targetPath === input.targetPath &&
        meta.filename === input.filename &&
        meta.size === input.size &&
        meta.fingerprint === input.fingerprint
      ) {
        return meta;
      }
    }
    return null;
  }

  async function streamToFile(body: AsyncIterable<Buffer>, destination: string): Promise<number> {
    const output = fs.createWriteStream(destination);
    let written = 0;
    try {
      for await (const chunk of body) {
        written += chunk.length;
        if (!output.write(chunk)) await new Promise((resolve) => output.once('drain', resolve));
      }
      await new Promise<void>((resolve, reject) => {
        output.once('error', reject);
        output.end(() => resolve());
      });
      return written;
    } catch (error) {
      output.destroy();
      throw error;
    }
  }

  function cleanupExpired(): void {
    ensureDir(sessionsRoot);
    const now = Date.now();
    for (const uploadId of listUploadIds()) {
      const meta = readMeta(uploadId);
      if (now - meta.updatedAt > options.ttlMs) fs.rmSync(sessionDir(uploadId), { recursive: true, force: true });
    }
  }

  return {
    async init(input: InitInput): Promise<ClientFileUploadInitResult> {
      cleanupExpired();
      ensureDir(sessionsRoot);
      const existing = findReusableSession(input);
      if (existing) {
        existing.updatedAt = Date.now();
        fs.writeFileSync(metaPath(existing.uploadId), JSON.stringify(existing, null, 2));
        return toInitResult(existing, readState(existing.uploadId), true);
      }

      const uploadId = `upl_${randomUUID().slice(0, 12)}`;
      const partCount = Math.ceil(input.size / input.chunkSize);
      const meta: UploadSessionMeta = {
        uploadId,
        rootId: input.rootId,
        targetPath: input.targetPath,
        filename: input.filename,
        size: input.size,
        chunkSize: input.chunkSize,
        partCount,
        fingerprint: input.fingerprint,
        resolvedTargetDir: input.resolvedTargetDir ?? '',
        createdAt: Date.now(),
        updatedAt: Date.now(),
      };
      ensureDir(sessionDir(uploadId));
      fs.writeFileSync(metaPath(uploadId), JSON.stringify(meta, null, 2));
      writeState(uploadId, { uploadedParts: [], uploadedBytes: 0 });
      return toInitResult(meta, { uploadedParts: [], uploadedBytes: 0 }, false);
    },

    getStatus(uploadId: string): ClientFileUploadStatusResult {
      return toStatusResult(readMeta(uploadId), readState(uploadId));
    },

    async writePart(uploadId: string, partNumber: number, body: AsyncIterable<Buffer>, options: WritePartOptions) {
      const meta = readMeta(uploadId);
      if (partNumber < 0 || partNumber >= meta.partCount) throw new Error(`Invalid partNumber ${partNumber}`);
      const expectedBytes = partNumber === meta.partCount - 1
        ? meta.size - (meta.chunkSize * (meta.partCount - 1))
        : meta.chunkSize;
      if (options.expectedSize !== expectedBytes) throw new Error(`Chunk size mismatch for part ${partNumber}`);
      if (options.expectedOffset !== partNumber * meta.chunkSize) throw new Error(`Chunk offset mismatch for part ${partNumber}`);

      const bytes = await streamToFile(body, partPath(uploadId, partNumber));
      if (bytes !== expectedBytes) throw new Error(`Chunk body length mismatch for part ${partNumber}`);

      const state = readState(uploadId);
      if (!state.uploadedParts.includes(partNumber)) {
        state.uploadedParts.push(partNumber);
        state.uploadedBytes += bytes;
      }
      meta.updatedAt = Date.now();
      fs.writeFileSync(metaPath(uploadId), JSON.stringify(meta, null, 2));
      writeState(uploadId, state);
      return { uploadId, partNumber, size: bytes, uploadedBytes: state.uploadedBytes };
    },

    async complete(uploadId: string): Promise<ClientFileUploadCompleteResult> {
      const meta = readMeta(uploadId);
      const state = readState(uploadId);
      const uploaded = new Set(state.uploadedParts);
      for (let partNumber = 0; partNumber < meta.partCount; partNumber += 1) {
        if (!uploaded.has(partNumber)) throw new Error(`Missing uploaded part ${partNumber}`);
      }
      const targetDir = meta.resolvedTargetDir;
      if (!targetDir) throw new Error('Missing resolved target directory');
      ensureDir(targetDir);
      const assemblingPath = path.join(sessionDir(uploadId), 'assembling.tmp');
      const buffers: Buffer[] = [];
      for (let partNumber = 0; partNumber < meta.partCount; partNumber += 1) {
        buffers.push(fs.readFileSync(partPath(uploadId, partNumber)));
      }
      fs.writeFileSync(assemblingPath, Buffer.concat(buffers));
      const finalPath = path.join(targetDir, meta.filename);
      fs.renameSync(assemblingPath, finalPath);
      fs.rmSync(sessionDir(uploadId), { recursive: true, force: true });
      return {
        uploadId,
        rootId: meta.rootId,
        path: meta.targetPath === '.' ? meta.filename : path.posix.join(meta.targetPath, meta.filename),
        size: meta.size,
      };
    },

    abort(uploadId: string): ClientFileUploadAbortResult {
      fs.rmSync(sessionDir(uploadId), { recursive: true, force: true });
      return { uploadId, deleted: true };
    },
  };
}
