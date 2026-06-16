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
  lastErrorCode?: string | null;
  lastErrorMessage?: string | null;
  finishedAt?: number | null;
}

export interface AttemptRecord {
  id: string;
  targetId: string;
  attemptNo: number;
  phaseTimelineJson: string;
  result: string;
  errorCode?: string | null;
  errorMessage?: string | null;
  createdAt: number;
  updatedAt: number;
  finishedAt?: number | null;
}

export interface UploadedArtifact {
  fileName: string;
  targetType: 'server' | 'client';
  platform: 'windows' | 'linux';
  arch: string;
  sha256: string;
  size: number;
  enabled: boolean;
}

export interface ReleaseManifestDraft {
  version: string;
  releaseTime: string;
  notes: string;
  minUpdaterVersion: string;
  channel: 'stable' | 'beta';
  compatibleFrom: string[];
  artifacts: Array<UploadedArtifact & {
    downloadPath: string;
    entrypoint: string;
    installerType: 'archive' | 'binary';
  }>;
}

export function buildReleaseManifest(version: string, uploaded: UploadedArtifact[], releaseTime = new Date().toISOString()): ReleaseManifestDraft {
  const normalizedVersion = version.trim();
  return {
    version: normalizedVersion,
    releaseTime,
    notes: `Remote Agent Gateway ${normalizedVersion}`,
    minUpdaterVersion: normalizedVersion,
    channel: 'stable',
    compatibleFrom: [normalizedVersion],
    artifacts: uploaded.map((artifact) => ({
      fileName: artifact.fileName,
      targetType: artifact.targetType,
      platform: artifact.platform,
      arch: artifact.arch,
      downloadPath: `/updates/artifacts/${normalizedVersion}/${artifact.fileName}`,
      sha256: artifact.sha256,
      size: artifact.size,
      entrypoint: artifact.targetType === 'client' ? 'client.bundle.cjs' : 'server.bundle.cjs',
      installerType: 'archive',
      enabled: artifact.enabled,
    })),
  };
}

export async function listReleases(api: Api): Promise<ReleaseSummary[]> {
  const res = await api.get('/admin/updates/releases');
  return res.data ?? [];
}

export async function registerRelease(api: Api, manifest: string): Promise<{ version: string }> {
  const res = await api.post('/admin/updates/releases', { manifest });
  return res.data;
}

export async function uploadArtifact(api: Api, version: string, file: File): Promise<UploadedArtifact> {
  const form = new FormData();
  form.append('file', file);
  const baseUrl = window.location.origin;
  const token = (api as unknown as { _token?: string })._token ?? localStorage.getItem('rag_token') ?? '';
  const res = await fetch(`${baseUrl}/admin/updates/releases/${version}/artifacts`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
    body: form,
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data?.error?.message ?? `HTTP ${res.status}`);
  return data.data;
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

export async function listCampaigns(api: Api): Promise<CampaignRecord[]> {
  const res = await api.get('/admin/updates/campaigns');
  return res.data ?? [];
}

export async function getCampaign(api: Api, id: string): Promise<CampaignRecord> {
  const res = await api.get(`/admin/updates/campaigns/${id}`);
  return res.data;
}

export async function listTargets(api: Api, campaignId: string): Promise<TargetRecord[]> {
  const res = await api.get(`/admin/updates/campaigns/${campaignId}/targets`);
  return res.data ?? [];
}

export async function listTargetAttempts(api: Api, targetId: string): Promise<AttemptRecord[]> {
  const res = await api.get(`/admin/updates/targets/${targetId}/attempts`);
  return res.data ?? [];
}

export async function retryCampaign(api: Api, campaignId: string, mode: 'failed' | 'offline_skipped' | 'all'): Promise<{ retried: number }> {
  const res = await api.post(`/admin/updates/campaigns/${campaignId}/retry`, { mode });
  return res.data;
}

export async function startCampaign(api: Api, campaignId: string): Promise<{ phase: string }> {
  const res = await api.post(`/admin/updates/campaigns/${campaignId}/start`);
  return res.data;
}

export async function deleteRelease(
  api: Api,
  version: string,
  options?: { force?: boolean },
): Promise<{
  version: string;
  force: boolean;
  deletedCampaignCount: number;
  deletedTargetCount: number;
  deletedAttemptCount: number;
  deletedArtifactDir: boolean;
}> {
  const suffix = options?.force ? '?force=true' : '';
  const res = await api.delete(`/admin/updates/releases/${encodeURIComponent(version)}${suffix}`);
  return res.data;
}

export async function deleteCampaign(
  api: Api,
  id: string,
  options?: { force?: boolean },
): Promise<{
  campaignId: string;
  force: boolean;
  deletedTargetCount: number;
  deletedAttemptCount: number;
}> {
  const suffix = options?.force ? '?force=true' : '';
  const res = await api.delete(`/admin/updates/campaigns/${encodeURIComponent(id)}${suffix}`);
  return res.data;
}
