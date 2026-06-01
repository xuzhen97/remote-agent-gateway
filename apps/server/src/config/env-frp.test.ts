import { describe, expect, it } from 'vitest';
import { buildFrpPublicUrlForEnv, resolveFrpsHostForEnv } from './env.js';

describe('FRP env helpers', () => {
  it('uses frp.connectHost for client connection and frp.publicHost for public urls', () => {
    const config = {
      FRP_MODE: 'builtin',
      FRPS_HOST: 'frps-connect.example.com',
      FRPS_PUBLIC_HOST: 'frps-public.example.com',
      SERVER_HOST: '0.0.0.0',
    } as const;

    expect(resolveFrpsHostForEnv(config)).toBe('frps-connect.example.com');
    expect(buildFrpPublicUrlForEnv(config, 23001)).toBe('frps-public.example.com:23001');
  });

  it('falls back to connectHost when publicHost is omitted', () => {
    const config = {
      FRP_MODE: 'remote',
      FRPS_HOST: 'your-server-ip',
      FRPS_PUBLIC_HOST: '',
      SERVER_HOST: '0.0.0.0',
    } as const;

    expect(resolveFrpsHostForEnv(config)).toBe('your-server-ip');
    expect(buildFrpPublicUrlForEnv(config, 23001, { proxyType: 'tcp' })).toBe('your-server-ip:23001');
  });

  it('formats public urls by proxy type and custom domain', () => {
    const config = {
      FRP_MODE: 'remote',
      FRPS_HOST: 'frps-connect.example.com',
      FRPS_PUBLIC_HOST: 'frps-public.example.com',
      SERVER_HOST: '0.0.0.0',
    } as const;

    expect(buildFrpPublicUrlForEnv(config, 23001, { proxyType: 'tcp' })).toBe('frps-public.example.com:23001');
    expect(buildFrpPublicUrlForEnv(config, 8080, { proxyType: 'http' })).toBe('http://frps-public.example.com:8080');
    expect(buildFrpPublicUrlForEnv(config, 8443, { proxyType: 'https' })).toBe('https://frps-public.example.com:8443');
    expect(buildFrpPublicUrlForEnv(config, 80, { proxyType: 'http', customDomain: 'preview.example.com' })).toBe('http://preview.example.com');
    expect(buildFrpPublicUrlForEnv(config, 443, { proxyType: 'https', customDomain: 'secure.example.com' })).toBe('https://secure.example.com');
  });
});
