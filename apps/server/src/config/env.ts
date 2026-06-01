import { loadServerConfig } from './server.config.js';

const serverConfig = loadServerConfig();

export const env = {
  SERVER_PORT: serverConfig.server.port,
  SERVER_HOST: serverConfig.server.host,
  ADMIN_TOKEN: serverConfig.auth.adminToken,
  AGENT_API_TOKEN: serverConfig.auth.agentApiToken,
  DB_PATH: serverConfig.storage.dbPath,
  STORAGE_DIR: serverConfig.storage.filesDir,
  FRP_MODE: serverConfig.frp.mode,
  FRPS_HOST: serverConfig.frp.connectHost,
  FRPS_PUBLIC_HOST: serverConfig.frp.publicHost,
  FRPS_PORT: serverConfig.frp.port,
  FRPS_TOKEN: serverConfig.frp.token,
  FRPS_DASHBOARD_SCHEME: serverConfig.frp.dashboard.scheme,
  FRPS_DASHBOARD_HOST: serverConfig.frp.dashboard.host || serverConfig.frp.connectHost,
  FRPS_DASHBOARD_PORT: serverConfig.frp.dashboard.port,
  FRPS_DASHBOARD_USER: serverConfig.frp.dashboard.user,
  FRPS_DASHBOARD_PASSWORD: serverConfig.frp.dashboard.password,
  FRPS_BIN_PATH: serverConfig.frp.binPath,
  FRP_PORT_RANGE_START: serverConfig.frp.portRange.start,
  FRP_PORT_RANGE_END: serverConfig.frp.portRange.end,
} as const;

export type FrpEnvLike = Pick<typeof env, 'FRP_MODE' | 'FRPS_HOST' | 'FRPS_PUBLIC_HOST' | 'SERVER_HOST'>;

export type Env = typeof env;
export const envSource = serverConfig.source;

export function resolveFrpsHostForEnv(value: FrpEnvLike): string {
  if (!value.FRPS_HOST) {
    throw new Error('FRPS_HOST is required');
  }
  return value.FRPS_HOST;
}

export function buildFrpPublicUrlForEnv(
  value: FrpEnvLike,
  remotePort: number,
  options?: { proxyType?: 'tcp' | 'http' | 'https'; customDomain?: string },
): string {
  if (options?.customDomain) {
    if (options.proxyType === 'https') return `https://${options.customDomain}`;
    if (options.proxyType === 'http') return `http://${options.customDomain}`;
    return options.customDomain;
  }

  const host = value.FRPS_PUBLIC_HOST || value.FRPS_HOST;
  if (!host) {
    throw new Error('FRPS_PUBLIC_HOST or FRPS_HOST is required');
  }

  if (options?.proxyType === 'https') return `https://${host}:${remotePort}`;
  if (options?.proxyType === 'http') return `http://${host}:${remotePort}`;
  return `${host}:${remotePort}`;
}

export function resolveFrpsHost(): string {
  return resolveFrpsHostForEnv(env);
}

export function buildFrpPublicUrl(
  remotePort: number,
  options?: { proxyType?: 'tcp' | 'http' | 'https'; customDomain?: string },
): string {
  return buildFrpPublicUrlForEnv(env, remotePort, options);
}
