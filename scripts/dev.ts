#!/usr/bin/env tsx
import { spawn, type ChildProcess } from 'node:child_process';
import * as path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..');
const BASE_URL = process.env.RAG_DEV_SERVER_URL ?? 'http://localhost:3000';
const SERVER_START_TIMEOUT_MS = 15_000;

let serverProc: ChildProcess | null = null;
let clientProc: ChildProcess | null = null;
let shuttingDown = false;

function prefixPipe(proc: ChildProcess, name: string): void {
  proc.stdout?.on('data', (data: Buffer) => {
    process.stdout.write(`[${name}] ${data}`);
  });
  proc.stderr?.on('data', (data: Buffer) => {
    process.stderr.write(`[${name}:err] ${data}`);
  });
}

function startProcess(name: string, filter: string): ChildProcess {
  const proc = spawn('cmd.exe', ['/d', '/s', '/c', `pnpm --filter ${filter} dev`], {
    cwd: ROOT,
    stdio: 'pipe',
    env: process.env,
  });

  prefixPipe(proc, name);

  proc.on('error', (err) => {
    if (shuttingDown) {
      return;
    }
    console.error(`[${name}] failed to start: ${err.message}`);
    void shutdown(1);
  });

  proc.on('exit', (code, signal) => {
    if (shuttingDown) {
      return;
    }

    const reason = signal ? `signal ${signal}` : `code ${code ?? 0}`;
    console.error(`[${name}] exited with ${reason}`);
    void shutdown(code ?? 1);
  });

  return proc;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForServerReady(timeoutMs: number): Promise<void> {
  const startedAt = Date.now();

  while (Date.now() - startedAt < timeoutMs) {
    try {
      const response = await fetch(`${BASE_URL}/api/health`);
      if (response.ok) {
        return;
      }
    } catch {
      // Server is still starting.
    }

    await sleep(500);
  }

  throw new Error(`Timed out waiting for server readiness at ${BASE_URL}/api/health`);
}

async function shutdown(exitCode = 0): Promise<void> {
  if (shuttingDown) {
    return;
  }
  shuttingDown = true;

  const processes = [clientProc, serverProc].filter((proc): proc is ChildProcess => proc !== null);
  for (const proc of processes) {
    proc.kill('SIGTERM');
  }

  await sleep(1_000);

  for (const proc of processes) {
    if (!proc.killed) {
      proc.kill('SIGKILL');
    }
  }

  process.exit(exitCode);
}

async function main(): Promise<void> {
  console.log('Starting server...');
  serverProc = startProcess('server', '@rag/server');

  await waitForServerReady(SERVER_START_TIMEOUT_MS);
  console.log(`Server ready at ${BASE_URL}`);

  console.log('Starting client...');
  clientProc = startProcess('client', '@rag/client');

  process.on('SIGINT', () => {
    void shutdown(0);
  });
  process.on('SIGTERM', () => {
    void shutdown(0);
  });
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  void shutdown(1);
});
