import { describe, it, expect } from 'vitest';
import {
  TaskTypeSchema,
  TaskStatusSchema,
  CreateTaskPayloadSchema,
  ClientRegisterPayloadSchema,
  TaskLogPayloadSchema,
  TaskResultPayloadSchema,
  CreatePortMappingPayloadSchema,
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
