import { describe, expect, it } from 'vitest';
import { summarizeTaskAudit } from './task-audit-redaction.js';

describe('task audit redaction', () => {
  it('redacts script bodies and env values', () => {
    const summary = summarizeTaskAudit({
      actionType: 'job.script',
      method: 'POST',
      path: '/jobs/script',
      payload: {
        runtime: 'node',
        script: 'console.log(process.env.SECRET)',
        env: { SECRET: 'shh', SAFE: 'ok' },
        timeoutMs: 1000,
      },
      result: { jobId: 'job_01', status: 'queued' },
    });

    expect(summary.requestSummary).toEqual({
      runtime: 'node',
      scriptLength: 31,
      cwd: null,
      envKeys: ['SAFE', 'SECRET'],
      timeoutMs: 1000,
    });
    expect(JSON.stringify(summary)).not.toContain('shh');
    expect(JSON.stringify(summary)).not.toContain('console.log(process.env.SECRET)');
  });

  it('summarizes all remaining mutating routes without leaking raw bodies', () => {
    expect(summarizeTaskAudit({
      actionType: 'job.command',
      method: 'POST', path: '/jobs/command',
      payload: { command: 'node', args: ['-e', 'console.log(1)'], env: { TOKEN: 'secret' } },
      result: { jobId: 'job_02', status: 'queued' },
    }).requestSummary).toMatchObject({ command: 'node', argsPreview: ['-e', 'console.log(1)'], envKeys: ['TOKEN'] });

    expect(summarizeTaskAudit({
      actionType: 'job.cancel', method: 'POST', path: '/jobs/job_02/cancel',
      payload: { jobId: 'job_02' }, result: { status: 'cancelled' },
    }).targetId).toBe('job_02');

    expect(summarizeTaskAudit({
      actionType: 'file.upload', method: 'POST', path: '/files/upload',
      payload: { rootId: 'workspace', path: 'dist', filename: 'app.zip', size: 2048 },
      result: { size: 2048 },
    }).requestSummary).toEqual({ rootId: 'workspace', path: 'dist', filename: 'app.zip', size: 2048 });

    expect(summarizeTaskAudit({
      actionType: 'file.mkdir', method: 'POST', path: '/files/mkdir',
      payload: { rootId: 'workspace', path: 'logs', recursive: true }, result: {},
    }).targetId).toBe('workspace:logs');

    expect(summarizeTaskAudit({
      actionType: 'file.delete', method: 'DELETE', path: '/files',
      payload: { rootId: 'workspace', path: 'tmp.log', recursive: false },
      result: { deleted: true },
    }).requestSummary).toEqual({ rootId: 'workspace', path: 'tmp.log', recursive: false });

    expect(summarizeTaskAudit({
      actionType: 'file.move', method: 'POST', path: '/files/move',
      payload: { rootId: 'workspace', from: 'a.txt', to: 'archive/a.txt', overwrite: false }, result: {},
    }).requestSummary).toEqual({ rootId: 'workspace', from: 'a.txt', to: 'archive/a.txt', overwrite: false });

    expect(summarizeTaskAudit({
      actionType: 'file.copy', method: 'POST', path: '/files/copy',
      payload: { rootId: 'workspace', from: 'a.txt', to: 'copy/a.txt', overwrite: true }, result: {},
    }).requestSummary).toEqual({ rootId: 'workspace', from: 'a.txt', to: 'copy/a.txt', overwrite: true });

    expect(summarizeTaskAudit({
      actionType: 'frp_mapping.create', method: 'POST', path: '/frp/mappings',
      payload: { name: 'vite', type: 'tcp', localHost: '127.0.0.1', localPort: 5173, remotePort: 15173 },
      result: { id: 'pm_01', remotePort: 15173 },
    }).targetId).toBe('pm_01');

    expect(summarizeTaskAudit({
      actionType: 'frp_mapping.delete', method: 'DELETE', path: '/frp/mappings/pm_01',
      payload: { mappingId: 'pm_01' }, result: { deleted: true },
    }).targetId).toBe('pm_01');
  });
});
