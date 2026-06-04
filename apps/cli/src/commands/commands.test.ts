import { Command } from 'commander';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { registerClientsCommands } from './clients.js';
import { registerDoctorCommand } from './doctor.js';
import { registerFilesCommands } from './files.js';
import { registerFrpCommands } from './frp.js';
import { registerJobsCommands } from './jobs.js';
import { registerTasksCommands } from './tasks.js';

const serverApi = {
  listClients: vi.fn(),
  getClient: vi.fn(),
  discoverClientHttp: vi.fn(),
  listTasks: vi.fn(),
  getTaskRecord: vi.fn(),
};

const clientHttpFactory = vi.fn();

function createProgram(write: (value: unknown) => void): Command {
  const program = new Command();
  program.exitOverride();
  program.configureOutput({ writeOut: () => undefined, writeErr: () => undefined });
  program.option('--server <url>');
  program.option('--token <token>');
  registerClientsCommands(program, { serverApi: serverApi as any, write });
  registerTasksCommands(program, { serverApi: serverApi as any, write });
  registerDoctorCommand(program, { serverApi: serverApi as any, clientHttpFactory, write });
  return program;
}

describe('read-only CLI commands', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('runs clients list', async () => {
    const outputs: unknown[] = [];
    serverApi.listClients.mockResolvedValueOnce([{ id: 'client-1' }]);
    const program = createProgram((value) => outputs.push(value));

    await program.parseAsync(['clients', 'list'], { from: 'user' });

    expect(outputs).toEqual([{ ok: true, data: [{ id: 'client-1' }] }]);
  });

  it('requires --client for clients get', async () => {
    const program = createProgram(() => undefined);

    await expect(program.parseAsync(['clients', 'get'], { from: 'user' })).rejects.toThrow();
  });

  it('runs clients get', async () => {
    const outputs: unknown[] = [];
    serverApi.getClient.mockResolvedValueOnce({ id: 'client-1' });
    const program = createProgram((value) => outputs.push(value));

    await program.parseAsync(['clients', 'get', '--client', 'client-1'], { from: 'user' });

    expect(serverApi.getClient).toHaveBeenCalledWith('client-1');
    expect(outputs[0]).toEqual({ ok: true, data: { id: 'client-1' } });
  });

  it('runs tasks list with filters', async () => {
    const outputs: unknown[] = [];
    serverApi.listTasks.mockResolvedValueOnce({ items: [], total: 0 });
    const program = createProgram((value) => outputs.push(value));

    await program.parseAsync(['tasks', 'list', '--client', 'client-1', '--action', 'file.write', '--page-size', '10'], { from: 'user' });

    expect(serverApi.listTasks).toHaveBeenCalledWith({ clientId: 'client-1', actionType: 'file.write', pageSize: 10, status: undefined, resourceType: undefined, sourceType: undefined, keyword: undefined, page: undefined });
    expect(outputs[0]).toEqual({ ok: true, data: { items: [], total: 0 } });
  });

  it('runs doctor without client', async () => {
    const outputs: unknown[] = [];
    serverApi.listClients.mockResolvedValueOnce([{ id: 'client-1' }]);
    const program = createProgram((value) => outputs.push(value));

    await program.parseAsync(['doctor'], { from: 'user' });

    expect(outputs[0]).toEqual({ ok: true, data: { server: { reachable: true }, clients: { reachable: true, count: 1 } } });
  });

  it('runs doctor with client HTTP checks', async () => {
    const outputs: unknown[] = [];
    const clientHttp = { health: vi.fn().mockResolvedValue({ status: 'ready' }), roots: vi.fn().mockResolvedValue({ roots: [{ id: 'root-0' }] }), listMappings: vi.fn().mockResolvedValue({ mappings: [] }) };
    serverApi.discoverClientHttp.mockResolvedValueOnce({ baseUrl: 'http://client', token: 'client-token', client: { id: 'client-1', online: true } });
    clientHttpFactory.mockReturnValueOnce(clientHttp);
    const program = createProgram((value) => outputs.push(value));

    await program.parseAsync(['doctor', '--client', 'client-1'], { from: 'user' });

    const result = outputs[0] as any;
    expect(result.ok).toBe(true);
    expect(result.data.clientHttp.reachable).toBe(true);
    expect(result.data.files.rootsCount).toBe(1);
    expect(result.data.frp.mappingsCount).toBe(0);
    expect(result.data.server.reachable).toBe(true);
  });
});

describe('client direct command groups', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('runs jobs run with -- command args', async () => {
    const outputs: unknown[] = [];
    const clientHttp = { createCommandJob: vi.fn().mockResolvedValue({ jobId: 'job_1', status: 'queued' }) };
    const program = new Command();
    program.exitOverride();
    registerJobsCommands(program, { discoverClientHttp: async () => clientHttp as any, write: (value) => outputs.push(value) });

    await program.parseAsync(['jobs', 'run', '--client', 'client-1', '--', 'node', '-v'], { from: 'user' });

    expect(clientHttp.createCommandJob).toHaveBeenCalledWith({ command: 'node', args: ['-v'] });
    expect(outputs[0]).toEqual({ ok: true, data: { jobId: 'job_1', status: 'queued' } });
  });

  it('runs jobs run --wait and returns final job state', async () => {
    const outputs: unknown[] = [];
    const clientHttp = {
      createCommandJob: vi.fn().mockResolvedValue({ jobId: 'job_1', status: 'queued' }),
      getJob: vi.fn().mockResolvedValue({ jobId: 'job_1', status: 'success', exitCode: 0 }),
    };
    const program = new Command();
    program.exitOverride();
    registerJobsCommands(program, { discoverClientHttp: async () => clientHttp as any, write: (value) => outputs.push(value) });

    await program.parseAsync(['jobs', 'run', '--client', 'client-1', '--wait', '--', 'node', '-v'], { from: 'user' });

    expect(clientHttp.getJob).toHaveBeenCalledWith('job_1');
    expect(outputs[0]).toEqual({ ok: true, data: { jobId: 'job_1', status: 'success', exitCode: 0 } });
  });

  it('runs jobs run --wait --logs and returns final job plus logs', async () => {
    const outputs: unknown[] = [];
    const clientHttp = {
      createCommandJob: vi.fn().mockResolvedValue({ jobId: 'job_1', status: 'queued' }),
      getJob: vi.fn().mockResolvedValue({ jobId: 'job_1', status: 'success', exitCode: 0 }),
      getJobLogs: vi.fn().mockResolvedValue({ jobId: 'job_1', logs: [{ seq: 1, stream: 'stdout', content: 'hello', timestamp: 1 }], nextSeq: 1 }),
    };
    const program = new Command();
    program.exitOverride();
    registerJobsCommands(program, { discoverClientHttp: async () => clientHttp as any, write: (value) => outputs.push(value) });

    await program.parseAsync(['jobs', 'run', '--client', 'client-1', '--wait', '--logs', '--', 'node', '-v'], { from: 'user' });

    expect(clientHttp.getJobLogs).toHaveBeenCalledWith('job_1', 0, 500);
    expect(outputs[0]).toEqual({ ok: true, data: { job: { jobId: 'job_1', status: 'success', exitCode: 0 }, logs: { jobId: 'job_1', logs: [{ seq: 1, stream: 'stdout', content: 'hello', timestamp: 1 }], nextSeq: 1 } } });
  });

  it('runs jobs script --wait --logs and returns final script job plus logs', async () => {
    const outputs: unknown[] = [];
    const clientHttp = {
      createScriptJob: vi.fn().mockResolvedValue({ jobId: 'job_2', status: 'queued' }),
      getJob: vi.fn().mockResolvedValue({ jobId: 'job_2', status: 'success', exitCode: 0 }),
      getJobLogs: vi.fn().mockResolvedValue({ jobId: 'job_2', logs: [], nextSeq: 0 }),
    };
    const program = new Command();
    program.exitOverride();
    registerJobsCommands(program, { discoverClientHttp: async () => clientHttp as any, write: (value) => outputs.push(value) });

    await program.parseAsync(['jobs', 'script', '--client', 'client-1', '--inline', 'console.log(1)', '--wait', '--logs'], { from: 'user' });

    expect(clientHttp.createScriptJob).toHaveBeenCalledWith({ runtime: 'node', script: 'console.log(1)', cwd: undefined, timeoutMs: undefined });
    expect(outputs[0]).toEqual({ ok: true, data: { job: { jobId: 'job_2', status: 'success', exitCode: 0 }, logs: { jobId: 'job_2', logs: [], nextSeq: 0 } } });
  });

  it('runs files read with JSON content by default', async () => {
    const outputs: unknown[] = [];
    const clientHttp = { readFile: vi.fn().mockResolvedValue('hello') };
    const program = new Command();
    program.exitOverride();
    registerFilesCommands(program, { discoverClientHttp: async () => clientHttp as any, write: (value) => outputs.push(value), writeRaw: (value) => outputs.push(value) });

    await program.parseAsync(['files', 'read', '--client', 'client-1', '--root', 'root-0', '--path', 'README.md'], { from: 'user' });

    expect(outputs[0]).toEqual({ ok: true, data: { rootId: 'root-0', path: 'README.md', content: 'hello' } });
  });

  it('runs files read --raw as raw output', async () => {
    const outputs: unknown[] = [];
    const clientHttp = { readFile: vi.fn().mockResolvedValue('hello') };
    const program = new Command();
    program.exitOverride();
    registerFilesCommands(program, { discoverClientHttp: async () => clientHttp as any, write: (value) => outputs.push(value), writeRaw: (value) => outputs.push(value) });

    await program.parseAsync(['files', 'read', '--client', 'client-1', '--root', 'root-0', '--path', 'README.md', '--raw'], { from: 'user' });

    expect(outputs[0]).toBe('hello');
  });

  it('runs frp create', async () => {
    const outputs: unknown[] = [];
    const clientHttp = { createMapping: vi.fn().mockResolvedValue({ id: 'pm_1' }) };
    const program = new Command();
    program.exitOverride();
    registerFrpCommands(program, { discoverClientHttp: async () => clientHttp as any, write: (value) => outputs.push(value) });

    await program.parseAsync(['frp', 'create', '--client', 'client-1', '--name', 'web', '--type', 'tcp', '--local-port', '3000'], { from: 'user' });

    expect(clientHttp.createMapping).toHaveBeenCalledWith({ name: 'web', type: 'tcp', localHost: '127.0.0.1', localPort: 3000, remotePort: undefined, customDomain: undefined });
    expect(outputs[0]).toEqual({ ok: true, data: { id: 'pm_1' } });
  });
});
