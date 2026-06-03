import type { TaskActionType } from '@rag/shared';

export interface TaskAuditActionSummary {
  targetId: string;
  requestSummary: Record<string, unknown>;
  resultSummary: Record<string, unknown>;
}

export function buildTaskAuditActionSummary(input: {
  actionType: TaskActionType;
  method: string;
  path: string;
  payload?: Record<string, unknown>;
  result?: Record<string, unknown>;
}): TaskAuditActionSummary {
  const payload = input.payload ?? {};
  const result = input.result ?? {};

  switch (input.actionType) {
    case 'job.command':
      return {
        targetId: String(result.jobId ?? 'job:pending'),
        requestSummary: {
          command: payload.command ?? null,
          argsPreview: Array.isArray(payload.args) ? payload.args.slice(0, 5) : [],
          cwd: payload.cwd ?? null,
          timeoutMs: payload.timeoutMs ?? null,
          envKeys: payload.env && typeof payload.env === 'object' ? Object.keys(payload.env as Record<string, string>).sort() : [],
        },
        resultSummary: { jobId: result.jobId ?? null, status: result.status ?? null },
      };
    case 'job.script': {
      const script = typeof payload.script === 'string' ? payload.script : '';
      return {
        targetId: String(result.jobId ?? 'job:pending'),
        requestSummary: {
          runtime: payload.runtime ?? 'node',
          scriptLength: script.length,
          cwd: payload.cwd ?? null,
          timeoutMs: payload.timeoutMs ?? null,
          envKeys: payload.env && typeof payload.env === 'object' ? Object.keys(payload.env as Record<string, string>).sort() : [],
        },
        resultSummary: { jobId: result.jobId ?? null, status: result.status ?? null },
      };
    }
    case 'job.cancel':
      return {
        targetId: String(payload.jobId ?? result.jobId ?? 'job:unknown'),
        requestSummary: { jobId: payload.jobId ?? result.jobId ?? null },
        resultSummary: { status: result.status ?? 'cancelled' },
      };
    case 'file.write':
      return {
        targetId: `${payload.rootId ?? 'root'}:${payload.path ?? 'unknown'}`,
        requestSummary: { rootId: payload.rootId ?? null, path: payload.path ?? null, size: payload.size ?? null },
        resultSummary: { size: result.size ?? null },
      };
    case 'file.upload':
      return {
        targetId: `${payload.rootId ?? 'root'}:${payload.path ?? 'unknown'}/${payload.filename ?? 'unknown'}`,
        requestSummary: { rootId: payload.rootId ?? null, path: payload.path ?? null, filename: payload.filename ?? null, size: payload.size ?? null },
        resultSummary: { size: result.size ?? null },
      };
    case 'file.mkdir':
      return {
        targetId: `${payload.rootId ?? 'root'}:${payload.path ?? 'unknown'}`,
        requestSummary: { rootId: payload.rootId ?? null, path: payload.path ?? null, recursive: payload.recursive ?? true },
        resultSummary: {},
      };
    case 'file.delete':
      return {
        targetId: `${payload.rootId ?? 'root'}:${payload.path ?? 'unknown'}`,
        requestSummary: { rootId: payload.rootId ?? null, path: payload.path ?? null, recursive: payload.recursive ?? false },
        resultSummary: { deleted: result.deleted ?? null },
      };
    case 'file.move':
      return {
        targetId: `${payload.rootId ?? 'root'}:${payload.to ?? 'unknown'}`,
        requestSummary: { rootId: payload.rootId ?? null, from: payload.from ?? null, to: payload.to ?? null, overwrite: payload.overwrite ?? false },
        resultSummary: {},
      };
    case 'file.copy':
      return {
        targetId: `${payload.rootId ?? 'root'}:${payload.to ?? 'unknown'}`,
        requestSummary: { rootId: payload.rootId ?? null, from: payload.from ?? null, to: payload.to ?? null, overwrite: payload.overwrite ?? false },
        resultSummary: {},
      };
    case 'frp_mapping.create':
      return {
        targetId: String(result.id ?? 'mapping:pending'),
        requestSummary: { name: payload.name ?? null, type: payload.type ?? null, localHost: payload.localHost ?? null, localPort: payload.localPort ?? null, remotePort: payload.remotePort ?? null },
        resultSummary: { id: result.id ?? null, remotePort: result.remotePort ?? null, publicUrl: result.publicUrl ?? null },
      };
    case 'frp_mapping.delete':
      return {
        targetId: String(payload.mappingId ?? result.id ?? 'mapping:unknown'),
        requestSummary: { mappingId: payload.mappingId ?? result.id ?? null },
        resultSummary: { deleted: result.deleted ?? null },
      };
  }
}
