import type { Api } from './http';

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
