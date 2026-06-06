import type { Api } from './http';

export interface AliyunDriveStatus {
  configured: boolean;
  authorized: boolean;
  clientId?: string;
  scope?: string;
  openapiBase?: string;
  redirectUri?: string;
  transferFolder?: string;
  cleanupTtlMs?: number;
  expiresAt?: number;
  driveId?: string;
  authorizedAccountName?: string;
}

export function getAliyunDriveStatus(api: Api): Promise<AliyunDriveStatus> {
  return api.get('/api/aliyundrive/status');
}

export function saveAliyunDriveConfig(api: Api, payload: Record<string, unknown>) {
  return api.put('/api/aliyundrive/config', payload);
}

export function startAliyunDriveOAuth(api: Api): Promise<{ state: string; authorizationUrl: string; expiresAt: number }> {
  return api.post('/api/aliyundrive/oauth/start', {});
}

export function completeAliyunDriveOAuth(api: Api, payload: { state: string; code: string }): Promise<AliyunDriveStatus> {
  return api.post('/api/aliyundrive/oauth/complete', payload);
}
