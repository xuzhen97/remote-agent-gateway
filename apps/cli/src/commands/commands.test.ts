import { Command } from 'commander';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { registerClientsCommands } from './clients.js';
import { registerDoctorCommand } from './doctor.js';
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
