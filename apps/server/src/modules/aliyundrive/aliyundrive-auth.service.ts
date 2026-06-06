import { createHash, randomBytes } from 'node:crypto';
import { getDb, saveDb } from '../../db/index.js';
import type { AliyunDriveAuthRecord, AliyunDriveConfigRecord, AliyunOAuthSession } from './aliyundrive-types.js';

const DEFAULT_ID = 'default';
const DEFAULT_SCOPE = 'user:base,file:all:read,file:all:write';
const DEFAULT_OPENAPI_BASE = 'https://openapi.alipan.com';
const DEFAULT_REDIRECT_URI = 'oob';
const DEFAULT_TRANSFER_FOLDER = 'RemoteAgentGatewayTransfers';
const DEFAULT_CLEANUP_TTL_MS = 24 * 60 * 60 * 1000;

export function buildCodeVerifier(randomString = randomBytes(48).toString('base64url')): string {
  return randomString.replace(/[^A-Za-z0-9]/g, '').slice(0, 96).padEnd(43, 'A');
}

export function buildCodeChallenge(verifier: string): string {
  return createHash('sha256').update(verifier, 'ascii').digest('base64url');
}

export class AliyunDriveAuthService {
  private oauthSessions = new Map<string, AliyunOAuthSession>();

  constructor(private readonly deps: {
    fetchImpl?: typeof fetch;
    now?: () => number;
    randomString?: () => string;
  } = {}) {}

  private now(): number { return this.deps.now?.() ?? Date.now(); }
  private fetchImpl(): typeof fetch { return this.deps.fetchImpl ?? fetch; }

  getDefaultConfig(input: Partial<Omit<AliyunDriveConfigRecord, 'id' | 'createdAt' | 'updatedAt'>> = {}): AliyunDriveConfigRecord {
    const now = this.now();
    return {
      id: DEFAULT_ID,
      clientId: input.clientId ?? '',
      clientSecret: input.clientSecret ?? null,
      scope: input.scope ?? DEFAULT_SCOPE,
      openapiBase: (input.openapiBase ?? DEFAULT_OPENAPI_BASE).replace(/\/+$/, ''),
      redirectUri: input.redirectUri ?? DEFAULT_REDIRECT_URI,
      transferFolder: input.transferFolder ?? DEFAULT_TRANSFER_FOLDER,
      cleanupTtlMs: input.cleanupTtlMs ?? DEFAULT_CLEANUP_TTL_MS,
      createdAt: now,
      updatedAt: now,
    };
  }

  saveConfig(input: Partial<Omit<AliyunDriveConfigRecord, 'id' | 'createdAt' | 'updatedAt'>> & { clientId: string }): AliyunDriveConfigRecord {
    if (!input.clientId.trim()) throw new Error('clientId is required');
    const now = this.now();
    const existing = this.getConfig();
    const record: AliyunDriveConfigRecord = {
      id: DEFAULT_ID,
      clientId: input.clientId.trim(),
      clientSecret: input.clientSecret ?? existing?.clientSecret ?? null,
      scope: input.scope ?? existing?.scope ?? DEFAULT_SCOPE,
      openapiBase: (input.openapiBase ?? existing?.openapiBase ?? DEFAULT_OPENAPI_BASE).replace(/\/+$/, ''),
      redirectUri: input.redirectUri ?? existing?.redirectUri ?? DEFAULT_REDIRECT_URI,
      transferFolder: input.transferFolder ?? existing?.transferFolder ?? DEFAULT_TRANSFER_FOLDER,
      cleanupTtlMs: input.cleanupTtlMs ?? existing?.cleanupTtlMs ?? DEFAULT_CLEANUP_TTL_MS,
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
    };
    getDb().run(
      `INSERT OR REPLACE INTO aliyundrive_config (id, client_id, client_secret, scope, openapi_base, redirect_uri, transfer_folder, cleanup_ttl_ms, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [record.id, record.clientId, record.clientSecret ?? null, record.scope, record.openapiBase, record.redirectUri, record.transferFolder, record.cleanupTtlMs, record.createdAt, record.updatedAt],
    );
    saveDb();
    return record;
  }

  getConfig(): AliyunDriveConfigRecord | null {
    const stmt = getDb().prepare('SELECT * FROM aliyundrive_config WHERE id = ?');
    stmt.bind([DEFAULT_ID]);
    try {
      if (!stmt.step()) return null;
      const row = stmt.getAsObject() as Record<string, unknown>;
      return {
        id: DEFAULT_ID,
        clientId: String(row.client_id),
        clientSecret: row.client_secret == null ? null : String(row.client_secret),
        scope: String(row.scope),
        openapiBase: String(row.openapi_base),
        redirectUri: String(row.redirect_uri),
        transferFolder: String(row.transfer_folder),
        cleanupTtlMs: Number(row.cleanup_ttl_ms),
        createdAt: Number(row.created_at),
        updatedAt: Number(row.updated_at),
      };
    } finally {
      stmt.free();
    }
  }

  getAuth(): AliyunDriveAuthRecord | null {
    const stmt = getDb().prepare('SELECT * FROM aliyundrive_auth WHERE id = ?');
    stmt.bind([DEFAULT_ID]);
    try {
      if (!stmt.step()) return null;
      const row = stmt.getAsObject() as Record<string, unknown>;
      return {
        id: DEFAULT_ID,
        accessToken: String(row.access_token),
        refreshToken: row.refresh_token == null ? null : String(row.refresh_token),
        tokenType: row.token_type == null ? 'Bearer' : String(row.token_type),
        expiresAt: Number(row.expires_at),
        driveId: row.drive_id == null ? null : String(row.drive_id),
        authorizedAccountName: row.authorized_account_name == null ? null : String(row.authorized_account_name),
        updatedAt: Number(row.updated_at),
      };
    } finally {
      stmt.free();
    }
  }

  getStatus() {
    const config = this.getConfig();
    const auth = this.getAuth();
    return {
      configured: Boolean(config?.clientId),
      authorized: Boolean(auth?.accessToken && auth.expiresAt > this.now() + 300_000),
      clientId: config?.clientId,
      scope: config?.scope,
      openapiBase: config?.openapiBase,
      redirectUri: config?.redirectUri,
      transferFolder: config?.transferFolder,
      cleanupTtlMs: config?.cleanupTtlMs,
      expiresAt: auth?.expiresAt,
      driveId: auth?.driveId ?? undefined,
      authorizedAccountName: auth?.authorizedAccountName ?? undefined,
    };
  }

  async startOAuth(configInput?: Partial<AliyunDriveConfigRecord> & { clientId: string }) {
    const config = configInput ? this.saveConfig(configInput) : this.getConfig();
    if (!config?.clientId) throw new Error('Aliyun Drive client_id is not configured');
    const verifier = buildCodeVerifier(this.deps.randomString?.());
    const state = randomBytes(16).toString('hex');
    const url = new URL(`${config.openapiBase}/oauth/authorize`);
    url.searchParams.set('client_id', config.clientId);
    url.searchParams.set('redirect_uri', config.redirectUri);
    url.searchParams.set('scope', config.scope);
    url.searchParams.set('response_type', 'code');
    url.searchParams.set('state', state);
    url.searchParams.set('code_challenge', buildCodeChallenge(verifier));
    url.searchParams.set('code_challenge_method', 'S256');
    this.oauthSessions.set(state, { state, verifier, config, expiresAt: this.now() + 10 * 60 * 1000 });
    return { state, authorizationUrl: url.toString(), expiresAt: this.now() + 10 * 60 * 1000 };
  }

  async completeOAuth(input: { state: string; code: string }) {
    const session = this.oauthSessions.get(input.state);
    if (!session || session.expiresAt < this.now()) throw new Error('OAuth session expired');
    const payload: Record<string, string> = {
      client_id: session.config.clientId,
      grant_type: 'authorization_code',
      code: input.code.trim(),
      code_verifier: session.verifier,
    };
    if (session.config.clientSecret) payload.client_secret = session.config.clientSecret;
    const response = await this.fetchImpl()(`${session.config.openapiBase}/oauth/access_token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    if (!response.ok) throw new Error(`Aliyun token exchange failed: HTTP ${response.status} ${await response.text()}`);
    const data = await response.json() as { access_token: string; refresh_token?: string; token_type?: string; expires_in: number };
    const record: AliyunDriveAuthRecord = {
      id: DEFAULT_ID,
      accessToken: data.access_token,
      refreshToken: data.refresh_token ?? null,
      tokenType: data.token_type ?? 'Bearer',
      expiresAt: this.now() + Number(data.expires_in) * 1000,
      driveId: null,
      authorizedAccountName: null,
      updatedAt: this.now(),
    };
    this.saveAuth(record);
    this.oauthSessions.delete(input.state);
    return this.getStatus();
  }

  saveAuth(record: AliyunDriveAuthRecord): void {
    getDb().run(
      `INSERT OR REPLACE INTO aliyundrive_auth (id, access_token, refresh_token, token_type, expires_at, drive_id, authorized_account_name, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [record.id, record.accessToken, record.refreshToken ?? null, record.tokenType ?? 'Bearer', record.expiresAt, record.driveId ?? null, record.authorizedAccountName ?? null, record.updatedAt],
    );
    saveDb();
  }

  revoke(): void {
    getDb().run('DELETE FROM aliyundrive_auth WHERE id = ?', [DEFAULT_ID]);
    saveDb();
  }
}

export const aliyunDriveAuthService = new AliyunDriveAuthService();
