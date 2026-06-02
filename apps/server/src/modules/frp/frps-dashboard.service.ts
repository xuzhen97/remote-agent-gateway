export interface FrpsDashboardConfig {
  scheme: 'http' | 'https';
  host: string;
  port: number;
  user: string;
  password: string;
}

export interface FrpsRegistrationCheckInput {
  dashboard: FrpsDashboardConfig;
  mapping: {
    name: string;
    proxyType: 'tcp' | 'http' | 'https';
    remotePort?: number | null;
  };
}

export interface FrpsRegistrationCheckResult {
  registered: boolean;
  dashboardReachable: boolean;
  reason: 'registered' | 'not_found' | 'auth_failed' | 'dashboard_unreachable' | 'unexpected_status';
  proxyType: 'tcp' | 'http' | 'https';
  name: string;
  remotePort?: number | null;
  statusCode?: number;
  detail?: string;
}

export interface FrpsProxySummary {
  name: string;
  proxyType: 'tcp' | 'http' | 'https';
  remotePort?: number;
}

export interface FrpsProxyListResult {
  dashboardReachable: boolean;
  proxies: FrpsProxySummary[];
  detail?: string;
}

function buildDashboardHeaders(dashboard: FrpsDashboardConfig) {
  const auth = Buffer.from(`${dashboard.user}:${dashboard.password}`).toString('base64');
  return {
    Authorization: `Basic ${auth}`,
  };
}

async function fetchProxyTypeList(
  dashboard: FrpsDashboardConfig,
  proxyType: 'tcp' | 'http' | 'https',
): Promise<FrpsProxySummary[]> {
  const url = `${dashboard.scheme}://${dashboard.host}:${dashboard.port}/api/proxy/${proxyType}`;
  const response = await fetch(url, {
    headers: buildDashboardHeaders(dashboard),
    signal: AbortSignal.timeout(5000),
  });

  if (!response.ok) {
    throw new Error(`Dashboard list ${proxyType} failed: HTTP ${response.status}`);
  }

  const body = await response.json() as {
    proxies?: Array<{
      name?: string;
      remotePort?: number;
      conf?: { remotePort?: number };
    }>;
  };

  return (body.proxies ?? [])
    .filter((proxy) => typeof proxy.name === 'string')
    .map((proxy) => ({
      name: proxy.name!,
      proxyType,
      remotePort: proxy.remotePort ?? proxy.conf?.remotePort,
    }));
}

export async function listFrpsProxies(dashboard: FrpsDashboardConfig): Promise<FrpsProxyListResult> {
  try {
    const [tcp, http, https] = await Promise.all([
      fetchProxyTypeList(dashboard, 'tcp'),
      fetchProxyTypeList(dashboard, 'http'),
      fetchProxyTypeList(dashboard, 'https'),
    ]);

    return {
      dashboardReachable: true,
      proxies: [...tcp, ...http, ...https],
    };
  } catch (err) {
    return {
      dashboardReachable: false,
      proxies: [],
      detail: err instanceof Error ? err.message : String(err),
    };
  }
}

export async function checkFrpsProxyRegistration(input: FrpsRegistrationCheckInput): Promise<FrpsRegistrationCheckResult> {
  const { dashboard, mapping } = input;
  const url = `${dashboard.scheme}://${dashboard.host}:${dashboard.port}/api/proxy/${mapping.proxyType}/${encodeURIComponent(mapping.name)}`;

  try {
    const response = await fetch(url, {
      headers: buildDashboardHeaders(dashboard),
      signal: AbortSignal.timeout(5000),
    });

    if (response.status === 200) {
      return {
        registered: true,
        dashboardReachable: true,
        reason: 'registered',
        proxyType: mapping.proxyType,
        name: mapping.name,
        remotePort: mapping.remotePort,
        statusCode: 200,
      };
    }

    if (response.status === 404) {
      return {
        registered: false,
        dashboardReachable: true,
        reason: 'not_found',
        proxyType: mapping.proxyType,
        name: mapping.name,
        remotePort: mapping.remotePort,
        statusCode: 404,
      };
    }

    if (response.status === 401 || response.status === 403) {
      return {
        registered: false,
        dashboardReachable: true,
        reason: 'auth_failed',
        proxyType: mapping.proxyType,
        name: mapping.name,
        remotePort: mapping.remotePort,
        statusCode: response.status,
      };
    }

    return {
      registered: false,
      dashboardReachable: true,
      reason: 'unexpected_status',
      proxyType: mapping.proxyType,
      name: mapping.name,
      remotePort: mapping.remotePort,
      statusCode: response.status,
      detail: response.statusText,
    };
  } catch (err) {
    return {
      registered: false,
      dashboardReachable: false,
      reason: 'dashboard_unreachable',
      proxyType: mapping.proxyType,
      name: mapping.name,
      remotePort: mapping.remotePort,
      detail: err instanceof Error ? err.message : String(err),
    };
  }
}
