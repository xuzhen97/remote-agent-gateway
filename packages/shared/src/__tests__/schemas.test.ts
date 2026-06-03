import { describe, it, expect } from 'vitest';
import {
  ClientRegisterPayloadSchema,
  ClientHeartbeatPayloadSchema,
  ClientFilePathPayloadSchema,
  ClientFileMovePayloadSchema,
  ClientFileCopyPayloadSchema,
  ClientFileMkdirPayloadSchema,
  ClientFileRootPayloadSchema,
  ClientFileRootPathPayloadSchema,
  ClientFileRootMkdirPayloadSchema,
  ClientFileRootMovePayloadSchema,
  ClientFileRootCopyPayloadSchema,
  ClientHttpCapabilitiesSchema,
  ClientHttpInfoSchema,
  ClientHttpReadyPayloadSchema,
  ClientHttpFailedPayloadSchema,
  ServerAckPayloadSchema,
  ClientJobCommandPayloadSchema,
  ClientJobScriptPayloadSchema,
  ClientFrpMappingCreatePayloadSchema,
  ClientTaskAuditMirrorRecordSchema,
  ClientTaskAuditLocalRecordSchema,
  TaskHistoryQuerySchema,
} from '../schemas.js';

describe('ClientRegisterPayloadSchema', () => {
  it('validates a complete registration payload', () => {
    const payload = ClientRegisterPayloadSchema.parse({
      clientId: 'win-dev-01',
      name: 'Windows Dev Machine',
      hostname: 'DESKTOP-123',
      os: 'windows',
      arch: 'x64',
      version: '0.1.0',
      tags: ['windows', 'dev'],
      http: { localHost: '127.0.0.1', localPort: 17890, protocol: 'http' },
      capabilities: { httpControl: true, jobs: true, sse: true, files: true, frpMappings: true },
    });
    expect(payload.clientId).toBe('win-dev-01');
    expect(payload.http?.localPort).toBe(17890);
  });

  it('rejects missing required fields', () => {
    expect(() => ClientRegisterPayloadSchema.parse({})).toThrow();
  });
});

describe('ClientHeartbeatPayloadSchema', () => {
  it('accepts heartbeat payloads', () => {
    expect(ClientHeartbeatPayloadSchema.parse({ clientId: 'c1', cpu: 0.1, memory: 0.2, uptime: 123 })).toEqual({
      clientId: 'c1', cpu: 0.1, memory: 0.2, uptime: 123,
    });
  });
});

describe('client file management schemas', () => {
  it('accepts client file operation payloads', () => {
    expect(ClientFilePathPayloadSchema.parse({ path: 'notes/a.txt' })).toEqual({ path: 'notes/a.txt' });
    expect(ClientFileMkdirPayloadSchema.parse({ path: 'notes', recursive: true })).toEqual({ path: 'notes', recursive: true });
    expect(ClientFileMovePayloadSchema.parse({ from: 'notes/a.txt', to: 'archive/a.txt', overwrite: false })).toEqual({
      from: 'notes/a.txt',
      to: 'archive/a.txt',
      overwrite: false,
    });
    expect(ClientFileCopyPayloadSchema.parse({ from: 'archive/a.txt', to: 'copy/a.txt', overwrite: true })).toEqual({
      from: 'archive/a.txt',
      to: 'copy/a.txt',
      overwrite: true,
    });
  });

  it('accepts root metadata and root-aware payloads', () => {
    expect(ClientFileRootPayloadSchema.parse({ rootId: 'root-0' })).toEqual({ rootId: 'root-0' });
    expect(ClientFileRootPathPayloadSchema.parse({ rootId: 'root-1', path: 'Windows/System32' })).toEqual({
      rootId: 'root-1',
      path: 'Windows/System32',
    });
    expect(ClientFileRootMkdirPayloadSchema.parse({ rootId: 'root-2', path: 'reports/2026', recursive: true })).toEqual({
      rootId: 'root-2',
      path: 'reports/2026',
      recursive: true,
    });
    expect(ClientFileRootMovePayloadSchema.parse({ rootId: 'root-2', from: 'a.txt', to: 'archive/a.txt', overwrite: false })).toEqual({
      rootId: 'root-2',
      from: 'a.txt',
      to: 'archive/a.txt',
      overwrite: false,
    });
    expect(ClientFileRootCopyPayloadSchema.parse({ rootId: 'root-2', from: 'a.txt', to: 'copy/a.txt', overwrite: true })).toEqual({
      rootId: 'root-2',
      from: 'a.txt',
      to: 'copy/a.txt',
      overwrite: true,
    });
  });

  it('rejects absolute paths, traversal paths, and empty root ids', () => {
    expect(() => ClientFilePathPayloadSchema.parse({ path: '../secret.txt' })).toThrow();
    expect(() => ClientFilePathPayloadSchema.parse({ path: '/etc/passwd' })).toThrow();
    expect(() => ClientFilePathPayloadSchema.parse({ path: 'C:\\Windows\\win.ini' })).toThrow();
    expect(() => ClientFileRootPayloadSchema.parse({ rootId: '' })).toThrow();
    expect(() => ClientFileRootPathPayloadSchema.parse({ rootId: 'root-0', path: '../secret.txt' })).toThrow();
  });
});

describe('task audit schemas', () => {
  it('accepts a local record with sync metadata', () => {
    const value = ClientTaskAuditLocalRecordSchema.parse({
      recordId: 'rec_01',
      clientId: 'client-1',
      requestId: 'req_01',
      resourceType: 'file',
      actionType: 'file.write',
      method: 'PUT',
      path: '/files/write',
      targetId: 'workspace:src/index.ts',
      sourceType: 'web-console',
      actorType: 'admin-token',
      actorLabel: 'web-console/admin-token',
      requestSummary: { rootId: 'workspace', path: 'src/index.ts', size: 123 },
      resultSummary: { size: 123 },
      status: 'success',
      httpStatus: 200,
      startedAt: 1710000000000,
      finishedAt: 1710000000100,
      durationMs: 100,
      syncStatus: 'pending',
      reportedAt: 1710000000101,
    });

    expect(value.syncStatus).toBe('pending');
  });

  it('accepts mirrored query filters', () => {
    const value = TaskHistoryQuerySchema.parse({
      clientId: 'client-1',
      status: 'failed',
      resourceType: 'file',
      actionType: 'file.write',
      sourceType: 'web-console',
      page: '2',
      pageSize: '20',
    });

    expect(value.page).toBe(2);
    expect(value.pageSize).toBe(20);
  });

  it('rejects invalid audit statuses', () => {
    expect(() => ClientTaskAuditMirrorRecordSchema.parse({
      recordId: 'rec_01',
      clientId: 'client-1',
      requestId: 'req_01',
      resourceType: 'file',
      actionType: 'file.write',
      method: 'PUT',
      path: '/files/write',
      targetId: 'workspace:src/index.ts',
      sourceType: 'web-console',
      actorType: 'admin-token',
      actorLabel: 'web-console/admin-token',
      requestSummary: {},
      resultSummary: {},
      status: 'running',
      httpStatus: 200,
      startedAt: 1710000000000,
      finishedAt: 1710000000100,
      durationMs: 100,
      reportedAt: 1710000000101,
    })).toThrow();
  });
});

describe('client HTTP control schemas', () => {
  it('validates server ack HTTP control payload', () => {
    const parsed = ServerAckPayloadSchema.parse({
      message: 'registered',
      frp: { serverAddr: 'frps.example.com', serverPort: 7000, authToken: 'frp-token' },
      httpControl: {
        localHost: '127.0.0.1',
        localPort: 17890,
        remotePort: 20317,
        publicBaseUrl: 'http://frps.example.com:20317',
        token: 'client-token-client-token',
      },
    });

    expect(parsed.httpControl?.remotePort).toBe(20317);
  });

  it('validates ready and failed payloads', () => {
    expect(ClientHttpReadyPayloadSchema.parse({
      clientId: 'dev-client-01',
      remotePort: 20317,
      baseUrl: 'http://frps.example.com:20317',
    }).remotePort).toBe(20317);

    expect(ClientHttpFailedPayloadSchema.parse({
      clientId: 'dev-client-01',
      remotePort: 20317,
      reason: 'frpc exited',
    }).reason).toContain('frpc');
  });

  it('validates job and mapping payloads', () => {
    expect(ClientJobCommandPayloadSchema.parse({ command: 'node', args: ['-v'] }).command).toBe('node');
    expect(ClientJobScriptPayloadSchema.parse({ runtime: 'node', script: 'console.log(1)' }).runtime).toBe('node');
    expect(ClientFrpMappingCreatePayloadSchema.parse({
      name: 'vite',
      type: 'tcp',
      localHost: '127.0.0.1',
      localPort: 5173,
    }).localPort).toBe(5173);
  });

  it('rejects invalid local ports', () => {
    expect(() => ClientHttpInfoSchema.parse({ localHost: '127.0.0.1', localPort: 70000, protocol: 'http' })).toThrow();
    expect(() => ClientHttpCapabilitiesSchema.parse({ httpControl: true, jobs: true, sse: true, files: true, frpMappings: true })).not.toThrow();
  });
});
