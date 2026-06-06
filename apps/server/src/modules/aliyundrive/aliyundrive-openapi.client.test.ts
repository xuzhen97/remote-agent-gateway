import { describe, expect, it, vi } from 'vitest';
import { AliyunDriveOpenApiClient } from './aliyundrive-openapi.client.js';

describe('AliyunDriveOpenApiClient', () => {
  it('posts with bearer auth and returns json', async () => {
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({ default_drive_id: 'drive-1' }), { status: 200 }));
    const client = new AliyunDriveOpenApiClient({ openapiBase: 'https://openapi.alipan.com', accessToken: 'token', fetchImpl: fetchImpl as any });
    const data = await client.post('/adrive/v1.0/user/getDriveInfo', {});
    expect(data).toEqual({ default_drive_id: 'drive-1' });
    expect(fetchImpl).toHaveBeenCalledWith('https://openapi.alipan.com/adrive/v1.0/user/getDriveInfo', expect.objectContaining({
      method: 'POST',
      headers: expect.objectContaining({ Authorization: 'Bearer token' }),
    }));
  });

  it('throws a redacted error on api failure', async () => {
    const fetchImpl = vi.fn(async () => new Response('bad token secret-value', { status: 401 }));
    const client = new AliyunDriveOpenApiClient({ openapiBase: 'https://openapi.alipan.com', accessToken: 'token', fetchImpl: fetchImpl as any });
    await expect(client.post('/x', {})).rejects.toThrow('Aliyun OpenAPI failed: HTTP 401');
  });
});
