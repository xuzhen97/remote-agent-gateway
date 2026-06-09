import type { Api } from './http';

export interface ReleaseSummary {
  version: string;
  enabled: boolean;
}

export interface ReleaseArtifact {
  fileName: string;
  targetType: 'server' | 'client';
  platform: string;
  arch: string;
  sha256: string;
  size: number;
  enabled: boolean;
}

export interface ReleaseDetail {
  version: string;
  artifacts: ReleaseArtifact[];
}

export interface CampaignRecord {
  id: string;
  targetVersion: string;
  includeServer: boolean;
  batchSize: number;
  maxConcurrency: number;
  status: string;
  createdBy: string;
  createdAt: number;
}

export interface TargetRecord {
  id: string;
  campaignId: string;
  targetType: 'server' | 'client';
  clientId: string | null;
  platform: string | null;
  currentVersion: string | null;
  targetVersion: string;
  phase: string;
  attemptCount: number;
}

export async function listReleases(api: Api): Promise<ReleaseSummary[]> {
  const res = await api.get('/admin/updates/releases');
  return res.data ?? [];
}

export async function registerRelease(api: Api, manifest: string): Promise<{ version: string }> {
  const res = await api.post('/admin/updates/releases', { manifest });
  return res.data;
}

export async function getRelease(api: Api, version: string): Promise<ReleaseDetail> {
  const res = await api.get(`/admin/updates/releases/${version}`);
  return res.data;
}

export async function createCampaign(api: Api, input: {
  targetVersion: string;
  includeServer: boolean;
  batchSize: number;
  maxConcurrency: number;
  scope: Record<string, unknown>;
  createdBy: string;
}): Promise<{ campaignId: string; targets: TargetRecord[] }> {
  const res = await api.post('/admin/updates/campaigns', input);
  return res.data;
}

export async function getCampaign(api: Api, id: string): Promise<CampaignRecord> {
  const res = await api.get(`/admin/updates/campaigns/${id}`);
  return res.data;
}

export async function listTargets(api: Api, campaignId: string): Promise<TargetRecord[]> {
  const res = await api.get(`/admin/updates/campaigns/${campaignId}/targets`);
  return res.data ?? [];
}

export async function retryCampaign(api: Api, campaignId: string, mode: 'failed' | 'offline_skipped' | 'all'): Promise<{ retried: number }> {
  const res = await api.post(`/admin/updates/campaigns/${campaignId}/retry`, { mode });
  return res.data;
}
