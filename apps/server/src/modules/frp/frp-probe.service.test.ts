import { afterEach, describe, expect, it } from 'vitest';
import * as http from 'node:http';
import * as net from 'node:net';
import { probeTcpTarget, probeHttpTarget } from './frp-probe.service.js';

describe('frp probe service', () => {
  const disposers: Array<() => Promise<void> | void> = [];

  afterEach(async () => {
    while (disposers.length > 0) {
      const dispose = disposers.pop();
      await dispose?.();
    }
  });

  it('probes tcp targets with node net', async () => {
    const server = net.createServer((socket) => socket.end());
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
    disposers.push(() => new Promise<void>((resolve, reject) => server.close((err) => err ? reject(err) : resolve())));
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('Missing TCP address');

    const result = await probeTcpTarget('127.0.0.1', address.port, 2000);

    expect(result.ok).toBe(true);
    expect(result.kind).toBe('tcp');
    expect(result.latencyMs).toEqual(expect.any(Number));
  });

  it('probes http targets with node fetch', async () => {
    const server = http.createServer((_req, res) => {
      res.writeHead(200, { 'Content-Type': 'text/plain' });
      res.end('ok');
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
    disposers.push(() => new Promise<void>((resolve, reject) => server.close((err) => err ? reject(err) : resolve())));
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('Missing HTTP address');

    const result = await probeHttpTarget(`http://127.0.0.1:${address.port}`, 2000);

    expect(result.ok).toBe(true);
    expect(result.kind).toBe('http');
    expect(result.status).toBe(200);
    expect(result.latencyMs).toEqual(expect.any(Number));
  });
});
