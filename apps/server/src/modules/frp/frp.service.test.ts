import { beforeEach, describe, expect, it } from 'vitest';
import { initDb } from '../../db/index.js';
import { frpService } from './frp.service.js';

describe('frp service public url generation', () => {
  beforeEach(async () => {
    await initDb();
  });

  it('builds protocol-aware public urls', () => {
    const tcp = frpService.createMapping({
      clientId: 'client-1',
      name: 'tcp-mapping',
      proxyType: 'tcp',
      localIp: '127.0.0.1',
      localPort: 3000,
      remotePort: 23001,
    });

    const http = frpService.createMapping({
      clientId: 'client-1',
      name: 'http-mapping',
      proxyType: 'http',
      localIp: '127.0.0.1',
      localPort: 3001,
      remotePort: 23002,
    });

    const https = frpService.createMapping({
      clientId: 'client-1',
      name: 'https-mapping',
      proxyType: 'https',
      localIp: '127.0.0.1',
      localPort: 3002,
      remotePort: 23003,
      customDomain: 'secure.example.com',
    });

    expect(tcp.public_url).toBe('your-server-ip:23001');
    expect(http.public_url).toBe('http://your-server-ip:23002');
    expect(https.public_url).toBe('https://secure.example.com');
  });
});
