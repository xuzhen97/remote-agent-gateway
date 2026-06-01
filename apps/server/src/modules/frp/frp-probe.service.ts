import * as net from 'node:net';

export interface TcpProbeResult {
  ok: boolean;
  kind: 'tcp';
  latencyMs: number;
  error?: string;
}

export interface HttpProbeResult {
  ok: boolean;
  kind: 'http';
  latencyMs: number;
  status?: number;
  finalUrl?: string;
  error?: string;
}

export async function probeTcpTarget(host: string, port: number, timeoutMs = 5000): Promise<TcpProbeResult> {
  const startedAt = Date.now();

  return await new Promise<TcpProbeResult>((resolve) => {
    const socket = net.createConnection({ host, port });
    const finish = (result: TcpProbeResult) => {
      socket.removeAllListeners();
      socket.destroy();
      resolve(result);
    };

    socket.setTimeout(timeoutMs);
    socket.once('connect', () => finish({ ok: true, kind: 'tcp', latencyMs: Date.now() - startedAt }));
    socket.once('timeout', () => finish({ ok: false, kind: 'tcp', latencyMs: Date.now() - startedAt, error: 'timeout' }));
    socket.once('error', (err) => finish({ ok: false, kind: 'tcp', latencyMs: Date.now() - startedAt, error: err.message }));
  });
}

export async function probeHttpTarget(url: string, timeoutMs = 5000): Promise<HttpProbeResult> {
  const startedAt = Date.now();

  try {
    const response = await fetch(url, {
      method: 'GET',
      redirect: 'follow',
      signal: AbortSignal.timeout(timeoutMs),
    });

    return {
      ok: response.ok,
      kind: 'http',
      latencyMs: Date.now() - startedAt,
      status: response.status,
      finalUrl: response.url,
    };
  } catch (err) {
    return {
      ok: false,
      kind: 'http',
      latencyMs: Date.now() - startedAt,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}
