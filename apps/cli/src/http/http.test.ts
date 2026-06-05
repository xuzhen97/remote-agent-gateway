import { beforeEach, describe, expect, it, vi } from 'vitest';
import { CliError } from './http-error.js';
import { ClientHttpApi } from './client-http.js';
import { ServerApi } from './server-api.js';

const fetchMock = vi.fn();

describe('ServerApi', () => {
  beforeEach(() => {
    fetchMock.mockReset();
    globalThis.fetch = fetchMock as any;
  });

  it('lists clients with bearer auth', async () => {
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify([{ id: 'client-1' }]), { status: 200 }));
    const api = new ServerApi({ serverUrl: 'http://server:3000', token: 'agent-token' });

    await expect(api.listClients()).resolves.toEqual([{ id: 'client-1' }]);
    expect(fetchMock).toHaveBeenCalledWith('http://server:3000/api/clients', expect.objectContaining({
      method: 'GET',
      headers: expect.objectContaining({ Authorization: 'Bearer agent-token' }),
    }));
  });

  it('gets client HTTP connection details', async () => {
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({ id: 'client-1', clientHttpBaseUrl: 'http://client:20000', clientHttpToken: 'client-token', httpReady: true }), { status: 200 }));
    const api = new ServerApi({ serverUrl: 'http://server:3000', token: 'agent-token' });

    await expect(api.getClient('client-1')).resolves.toEqual({ id: 'client-1', clientHttpBaseUrl: 'http://client:20000', clientHttpToken: 'client-token', httpReady: true });
  });

  it('throws HTTP_ERROR for non-2xx responses', async () => {
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({ error: 'Client not found' }), { status: 404 }));
    const api = new ServerApi({ serverUrl: 'http://server:3000', token: 'agent-token' });

    await expect(api.getClient('missing')).rejects.toMatchObject({ code: 'HTTP_ERROR', status: 404, message: 'Client not found' });
  });

  it('discovers ready client HTTP details', async () => {
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({ id: 'client-1', clientHttpBaseUrl: 'http://client:20000', clientHttpToken: 'client-token', httpReady: true }), { status: 200 }));
    const api = new ServerApi({ serverUrl: 'http://server:3000', token: 'agent-token' });

    await expect(api.discoverClientHttp('client-1')).resolves.toEqual({ baseUrl: 'http://client:20000', token: 'client-token', client: { id: 'client-1', clientHttpBaseUrl: 'http://client:20000', clientHttpToken: 'client-token', httpReady: true } });
  });

  it('throws CLIENT_DISCOVERY_ERROR when client HTTP token is absent', async () => {
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({ id: 'client-1', clientHttpBaseUrl: 'http://client:20000', httpReady: false }), { status: 200 }));
    const api = new ServerApi({ serverUrl: 'http://server:3000', token: 'agent-token' });

    await expect(api.discoverClientHttp('client-1')).rejects.toMatchObject({ code: 'CLIENT_DISCOVERY_ERROR' });
  });

  it('lists task history with query filters', async () => {
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({ items: [], total: 0, page: 1, pageSize: 20 }), { status: 200 }));
    const api = new ServerApi({ serverUrl: 'http://server:3000', token: 'agent-token' });

    await api.listTasks({ clientId: 'client-1', actionType: 'file.write', pageSize: 10 });

    expect(fetchMock).toHaveBeenCalledWith('http://server:3000/api/tasks?clientId=client-1&actionType=file.write&pageSize=10', expect.any(Object));
  });
});

describe('ClientHttpApi', () => {
  beforeEach(() => {
    fetchMock.mockReset();
    globalThis.fetch = fetchMock as any;
  });

  it('calls client health with client token', async () => {
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({ status: 'ready' }), { status: 200 }));
    const api = new ClientHttpApi({ baseUrl: 'http://client:20000', token: 'client-token' });

    await expect(api.health()).resolves.toEqual({ status: 'ready' });
    expect(fetchMock).toHaveBeenCalledWith('http://client:20000/health', expect.objectContaining({
      method: 'GET',
      headers: expect.objectContaining({ Authorization: 'Bearer client-token' }),
    }));
  });

  it('creates command jobs', async () => {
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({ jobId: 'job_1', status: 'queued' }), { status: 200 }));
    const api = new ClientHttpApi({ baseUrl: 'http://client:20000', token: 'client-token' });

    await expect(api.createCommandJob({ command: 'node', args: ['-v'] })).resolves.toEqual({ jobId: 'job_1', status: 'queued' });
  });

  it('reads text files as raw text', async () => {
    fetchMock.mockResolvedValueOnce(new Response('hello', { status: 200, headers: { 'Content-Type': 'text/plain' } }));
    const api = new ClientHttpApi({ baseUrl: 'http://client:20000', token: 'client-token' });

    await expect(api.readFile('root-0', 'README.md')).resolves.toBe('hello');
  });

  it('downloads binary files as Uint8Array', async () => {
    fetchMock.mockResolvedValueOnce(new Response(new Uint8Array([1, 2, 3]), { status: 200 }));
    const api = new ClientHttpApi({ baseUrl: 'http://client:20000', token: 'client-token' });

    const bytes = await api.downloadFile('root-0', 'a.bin');
    expect(Array.from(bytes)).toEqual([1, 2, 3]);
  });

  it('initializes upload sessions with json payload', async () => {
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({ uploadId: 'upl_1', partCount: 2 }), { status: 200 }));
    const api = new ClientHttpApi({ baseUrl: 'http://client:20000', token: 'client-token' });

    await api.initUploadSession({ rootId: 'root-0', path: 'drop', filename: 'demo.jar', size: 8, chunkSize: 4, fingerprint: 'fp' } as any);

    expect(fetchMock).toHaveBeenCalledWith('http://client:20000/files/uploads/init', expect.objectContaining({
      method: 'POST',
      headers: expect.objectContaining({ Authorization: 'Bearer client-token', 'Content-Type': 'application/json' }),
    }));
  });

  it('uploads one binary part with offset and size query params', async () => {
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({ uploadId: 'upl_1', partNumber: 0, size: 4, uploadedBytes: 4 }), { status: 200 }));
    const api = new ClientHttpApi({ baseUrl: 'http://client:20000', token: 'client-token' });

    await api.uploadPart('upl_1', 0, new Uint8Array([1, 2, 3, 4]), { offset: 0, size: 4 } as any);

    expect(fetchMock).toHaveBeenCalledWith('http://client:20000/files/uploads/upl_1/parts/0?offset=0&size=4', expect.objectContaining({
      method: 'PUT',
      headers: expect.objectContaining({ Authorization: 'Bearer client-token', 'Content-Type': 'application/octet-stream' }),
    }));
  });
});
