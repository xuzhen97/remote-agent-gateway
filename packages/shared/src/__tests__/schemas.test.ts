import { describe, it, expect } from 'vitest';
import {
  TaskTypeSchema,
  TaskStatusSchema,
  CreateTaskPayloadSchema,
  ClientRegisterPayloadSchema,
  TaskLogPayloadSchema,
  TaskResultPayloadSchema,
  CreatePortMappingPayloadSchema,
  FileServiceStartPayloadSchema,
  FileServiceStopPayloadSchema,
  FileServiceStatusPayloadSchema,
  ClientFilePathPayloadSchema,
  ClientFileMovePayloadSchema,
  ClientFileCopyPayloadSchema,
  ClientFileMkdirPayloadSchema,
  ClientFileRootPayloadSchema,
  ClientFileRootPathPayloadSchema,
  ClientFileRootMkdirPayloadSchema,
  ClientFileRootMovePayloadSchema,
  ClientFileRootCopyPayloadSchema,
} from '../schemas.js';

describe('TaskTypeSchema', () => {
  it('accepts valid task types', () => {
    expect(TaskTypeSchema.parse('exec_script')).toBe('exec_script');
    expect(TaskTypeSchema.parse('exec_command')).toBe('exec_command');
    expect(TaskTypeSchema.parse('push_file')).toBe('push_file');
    expect(TaskTypeSchema.parse('frp_create_proxy')).toBe('frp_create_proxy');
    expect(TaskTypeSchema.parse('frp_remove_proxy')).toBe('frp_remove_proxy');
    expect(TaskTypeSchema.parse('health_check')).toBe('health_check');
  });

  it('rejects invalid task types', () => {
    expect(() => TaskTypeSchema.parse('invalid')).toThrow();
  });
});

describe('TaskStatusSchema', () => {
  it('accepts valid statuses', () => {
    expect(TaskStatusSchema.parse('pending')).toBe('pending');
    expect(TaskStatusSchema.parse('dispatched')).toBe('dispatched');
    expect(TaskStatusSchema.parse('running')).toBe('running');
    expect(TaskStatusSchema.parse('success')).toBe('success');
    expect(TaskStatusSchema.parse('failed')).toBe('failed');
    expect(TaskStatusSchema.parse('cancelled')).toBe('cancelled');
  });
});

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
    });
    expect(payload.clientId).toBe('win-dev-01');
    expect(payload.tags).toEqual(['windows', 'dev']);
  });

  it('rejects missing required fields', () => {
    expect(() => ClientRegisterPayloadSchema.parse({})).toThrow();
  });
});

describe('CreateTaskPayloadSchema', () => {
  it('validates an exec_script task', () => {
    const task = CreateTaskPayloadSchema.parse({
      clientId: 'win-dev-01',
      type: 'exec_script',
      payload: {
        runtime: 'node',
        script: 'console.log("hello")',
        timeoutMs: 60000,
      },
    });
    expect(task.type).toBe('exec_script');
    expect(task.payload.script).toBe('console.log("hello")');
  });

  it('validates a push_file task', () => {
    const task = CreateTaskPayloadSchema.parse({
      clientId: 'win-dev-01',
      type: 'push_file',
      payload: {
        fileId: 'file_001',
        targetPath: '/workspace/project',
        fileName: 'archive.zip',
      },
    });
    expect(task.payload.fileId).toBe('file_001');
  });

  it('rejects missing clientId', () => {
    expect(() =>
      CreateTaskPayloadSchema.parse({ type: 'exec_script', payload: {} })
    ).toThrow();
  });
});

describe('TaskLogPayloadSchema', () => {
  it('validates a log entry', () => {
    const log = TaskLogPayloadSchema.parse({
      taskId: 'task_001',
      stream: 'stdout',
      content: 'hello world\n',
    });
    expect(log.stream).toBe('stdout');
  });

  it('rejects invalid stream', () => {
    expect(() =>
      TaskLogPayloadSchema.parse({ taskId: 'task_001', stream: 'err', content: 'x' })
    ).toThrow();
  });
});

describe('TaskResultPayloadSchema', () => {
  it('validates a success result', () => {
    const result = TaskResultPayloadSchema.parse({
      taskId: 'task_001',
      status: 'success',
      result: { exitCode: 0, durationMs: 238 },
    });
    expect(result.status).toBe('success');
  });

  it('validates a failed result with error', () => {
    const result = TaskResultPayloadSchema.parse({
      taskId: 'task_001',
      status: 'failed',
      error: 'Script timeout',
    });
    expect(result.error).toBe('Script timeout');
  });
});

describe('CreatePortMappingPayloadSchema', () => {
  it('validates a tcp port mapping', () => {
    const mapping = CreatePortMappingPayloadSchema.parse({
      clientId: 'win-dev-01',
      name: 'web-preview',
      proxyType: 'tcp',
      localIp: '127.0.0.1',
      localPort: 3000,
      remotePort: 23000,
    });
    expect(mapping.proxyType).toBe('tcp');
  });

  it('rejects invalid proxyType', () => {
    expect(() =>
      CreatePortMappingPayloadSchema.parse({
        clientId: 'win-dev-01',
        name: 'test',
        proxyType: 'udp',
        localIp: '127.0.0.1',
        localPort: 3000,
        remotePort: 23000,
      })
    ).toThrow();
  });

  it('rejects port out of range', () => {
    expect(() =>
      CreatePortMappingPayloadSchema.parse({
        clientId: 'win-dev-01',
        name: 'test',
        proxyType: 'tcp',
        localIp: '127.0.0.1',
        localPort: 99999,
        remotePort: 23000,
      })
    ).toThrow();
  });
});

describe('client file management schemas', () => {
  it('accepts file service task payloads', () => {
    expect(TaskTypeSchema.parse('file_service_start')).toBe('file_service_start');
    expect(TaskTypeSchema.parse('file_service_stop')).toBe('file_service_stop');
    expect(TaskTypeSchema.parse('file_service_status')).toBe('file_service_status');

    expect(FileServiceStartPayloadSchema.parse({ port: 0, token: 'tok_abc_1234567890', ttlMs: 600000 })).toEqual({
      port: 0,
      token: 'tok_abc_1234567890',
      ttlMs: 600000,
    });
    expect(FileServiceStopPayloadSchema.parse({})).toEqual({});
    expect(FileServiceStatusPayloadSchema.parse({})).toEqual({});
  });

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
