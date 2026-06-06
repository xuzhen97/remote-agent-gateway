export interface AliyunDriveConfigRecord {
  id: 'default';
  clientId: string;
  clientSecret?: string | null;
  scope: string;
  openapiBase: string;
  redirectUri: string;
  transferFolder: string;
  cleanupTtlMs: number;
  createdAt: number;
  updatedAt: number;
}

export interface AliyunDriveAuthRecord {
  id: 'default';
  accessToken: string;
  refreshToken?: string | null;
  tokenType?: string | null;
  expiresAt: number;
  driveId?: string | null;
  authorizedAccountName?: string | null;
  updatedAt: number;
}

export interface AliyunOAuthSession {
  state: string;
  verifier: string;
  config: AliyunDriveConfigRecord;
  expiresAt: number;
}
