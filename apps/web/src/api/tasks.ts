import type { Api } from './http';

export function summarizeTaskResult(row: { resultSummary?: Record<string, any>; durationMs?: number }) {
  const result = row.resultSummary ?? {};
  const lifecycle = result.lifecycle ?? {};
  const extracted = result.extracted ?? {};
  const output = result.output ?? {};
  const parts: string[] = [];

  const status = lifecycle.status ?? result.status;
  if (status) parts.push(String(status));
  if (lifecycle.exitCode !== undefined && lifecycle.exitCode !== null) parts.push(`exitCode ${lifecycle.exitCode}`);
  if (Array.isArray(extracted.ipv4) && extracted.ipv4[0]) parts.push(`IPv4 ${extracted.ipv4[0]}`);
  if (output.stdoutLineCount !== undefined && output.stdoutLineCount !== null) parts.push(`stdout ${output.stdoutLineCount} 行`);
  if (parts.length > 0) return parts.join(' · ');

  const duration = row.durationMs;
  if (typeof duration === 'number') return duration >= 1000 ? `${(duration / 1000).toFixed(1)}s` : `${duration}ms`;
  return JSON.stringify(result);
}

export interface TaskListQuery {
  clientId?: string;
  status?: string;
  resourceType?: string;
  actionType?: string;
  sourceType?: string;
  keyword?: string;
  page?: number;
  pageSize?: number;
}

function toQueryString(query: TaskListQuery): string {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value !== undefined && value !== '') params.set(key, String(value));
  }
  const text = params.toString();
  return text ? `?${text}` : '';
}

export function listTasks(api: Api, query: TaskListQuery = {}) {
  return api.get(`/api/tasks${toQueryString(query)}`);
}

export function getTaskDetail(api: Api, recordId: string) {
  return api.get(`/api/tasks/${encodeURIComponent(recordId)}`);
}

export function deleteTaskRecord(api: Api, recordId: string) {
  return api.delete(`/api/tasks/${encodeURIComponent(recordId)}`);
}

export function bulkDeleteTaskRecords(api: Api, recordIds: string[]) {
  return api.post('/api/tasks/bulk-delete', { recordIds });
}
