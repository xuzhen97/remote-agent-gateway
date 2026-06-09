import { EventEmitter } from 'node:events';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { JobManager } from './job-manager.js';

const { spawnMock } = vi.hoisted(() => ({
  spawnMock: vi.fn(),
}));

vi.mock('node:child_process', () => ({
  spawn: spawnMock,
}));

class FakeChildProcess extends EventEmitter {
  stdout = new EventEmitter();
  stderr = new EventEmitter();
  killed = false;

  kill(): boolean {
    this.killed = true;
    return true;
  }
}

function createManager(workspaceDir: string, maxConcurrent = 1): JobManager {
  return new JobManager({
    maxConcurrent,
    defaultTimeoutMs: 1_000,
    maxTimeoutMs: 5_000,
    logBufferLines: 100,
    workspaceDir,
  });
}

describe('JobManager lifecycle finalization', () => {
  let workspaceDir: string;

  beforeEach(() => {
    workspaceDir = mkdtempSync(join(tmpdir(), 'rag-job-manager-'));
    spawnMock.mockReset();
  });

  afterEach(() => {
    rmSync(workspaceDir, { recursive: true, force: true });
  });

  it('keeps a cancelled job cancelled when the child later closes successfully', () => {
    const child = new FakeChildProcess();
    spawnMock.mockReturnValueOnce(child);
    const manager = createManager(workspaceDir);

    const job = manager.createCommand({ command: 'node', args: ['-v'] });
    manager.cancel(job.jobId);
    child.emit('close', 0);

    expect(manager.getJob(job.jobId)).toMatchObject({ status: 'cancelled', exitCode: null });
  });

  it('releases a cancelled job active slot exactly once when close also fires', () => {
    const first = new FakeChildProcess();
    const second = new FakeChildProcess();
    const third = new FakeChildProcess();
    spawnMock.mockReturnValueOnce(first).mockReturnValueOnce(second).mockReturnValueOnce(third);
    const manager = createManager(workspaceDir, 2);

    const firstJob = manager.createCommand({ command: 'node' });
    manager.createCommand({ command: 'node' });
    manager.cancel(firstJob.jobId);
    first.emit('close', 0);

    manager.createCommand({ command: 'node' });
    expect(() => manager.createCommand({ command: 'node' })).toThrow(/并发任务已达上限 2/);
  });

  it('releases the active slot when command startup throws before a child is attached', async () => {
    spawnMock.mockImplementationOnce(() => {
      throw new Error('spawn failed before child');
    });
    spawnMock.mockReturnValueOnce(new FakeChildProcess());
    const manager = createManager(workspaceDir);

    const failed = manager.createCommand({ command: 'missing-binary' });
    await expect(manager.wait(failed.jobId)).resolves.toMatchObject({ status: 'failed', error: 'spawn failed before child' });

    expect(() => manager.createCommand({ command: 'node' })).not.toThrow();
  });

  it('releases the active slot when script startup throws before a child is attached', async () => {
    spawnMock.mockImplementationOnce(() => {
      throw new Error('script spawn failed');
    });
    spawnMock.mockReturnValueOnce(new FakeChildProcess());
    const manager = createManager(workspaceDir);

    const failed = manager.createScript({ runtime: 'node', script: 'console.log(1)' });
    await expect(manager.wait(failed.jobId)).resolves.toMatchObject({ status: 'failed', error: 'script spawn failed' });

    expect(() => manager.createCommand({ command: 'node' })).not.toThrow();
  });

  it('does not persist a ghost queued job when the concurrency limit rejects creation', () => {
    spawnMock.mockReturnValueOnce(new FakeChildProcess());
    const manager = createManager(workspaceDir, 1);

    manager.createCommand({ command: 'node' });
    expect(() => manager.createCommand({ command: 'node' })).toThrow(/并发任务已达上限 1/);

    expect((manager as unknown as { jobs: Map<string, unknown> }).jobs.size).toBe(1);
  });
});
