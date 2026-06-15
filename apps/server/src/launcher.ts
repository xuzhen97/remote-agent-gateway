import { existsSync, readFileSync, rmSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { isAbsolute, join, relative, resolve } from 'node:path';
import {
  markPendingServerUpdateRolledBack,
  promotePendingServerVersion,
  readCurrentServerVersion,
  readPendingServerVersion,
  rollbackToPreviousServerVersion,
} from './modules/updates/server-version-state.js';
import { SERVER_EXIT_UPDATE_RESTART } from './modules/updates/server-updater.js';

export const SERVER_EXIT_ROLLBACK = 21;

function normalizeVersion(version: string): string {
  return version.trim().replace(/^v/i, '');
}

export interface ServerEntrypointResolution {
  version: string;
  entrypoint: string;
}

function isInsideDeployRoot(deployRoot: string, filePath: string): boolean {
  const rel = relative(resolve(deployRoot), resolve(filePath));
  return rel === '' || (!rel.startsWith('..') && !isAbsolute(rel));
}

function readReadyVersion(deployRoot: string): string | null {
  const file = join(deployRoot, 'state', 'server-ready.json');
  if (!existsSync(file)) return null;
  try {
    const parsed = JSON.parse(readFileSync(file, 'utf8')) as { version?: string };
    return parsed.version ?? null;
  } catch {
    return null;
  }
}

async function waitForReadyVersion(deployRoot: string, version: string, timeoutMs: number): Promise<boolean> {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    if (normalizeVersion(readReadyVersion(deployRoot) ?? '') === normalizeVersion(version)) return true;
    await new Promise((resolveReady) => setTimeout(resolveReady, 250));
  }
  return false;
}

export function resolveServerEntrypoint(deployRoot: string): ServerEntrypointResolution {
  const current = readCurrentServerVersion(deployRoot);
  if (current) {
    const entrypoint = resolve(deployRoot, current.entrypoint);
    if (isInsideDeployRoot(deployRoot, entrypoint) && existsSync(entrypoint)) {
      return { version: current.version, entrypoint };
    }
  }

  const legacy = join(deployRoot, 'server.bundle.cjs');
  if (existsSync(legacy)) return { version: 'bootstrap', entrypoint: legacy };
  throw new Error(`No server bundle found under ${deployRoot}`);
}

async function launchServer(deployRoot: string, resolved: ServerEntrypointResolution, verifyReadyVersion?: string): Promise<{ code: number | null; signal: NodeJS.Signals | null; readyVerified: boolean }> {
  console.log(`[server-launcher] starting server ${resolved.version}: ${resolved.entrypoint}`);
  if (verifyReadyVersion) rmSync(join(deployRoot, 'state', 'server-ready.json'), { force: true });

  const child = spawn(process.execPath, [resolved.entrypoint], {
    cwd: deployRoot,
    stdio: 'inherit',
    env: {
      ...process.env,
      RAG_DEPLOY_ROOT: deployRoot,
    },
  });

  const exitPromise = new Promise<{ code: number | null; signal: NodeJS.Signals | null }>((resolveExit) => {
    child.on('exit', (code, signal) => resolveExit({ code, signal }));
  });

  if (!verifyReadyVersion) return { ...(await exitPromise), readyVerified: false };

  const timeoutMs = Number(process.env.RAG_UPDATE_READY_TIMEOUT_MS ?? '30000');
  const ready = await Promise.race([
    waitForReadyVersion(deployRoot, verifyReadyVersion, timeoutMs).then((value) => ({ type: 'ready' as const, value })),
    exitPromise.then((exit) => ({ type: 'exit' as const, exit })),
  ]);

  if (ready.type === 'exit') return { ...ready.exit, readyVerified: false };
  if (!ready.value) {
    child.kill();
    return { code: SERVER_EXIT_ROLLBACK, signal: null, readyVerified: false };
  }

  return { ...(await exitPromise), readyVerified: true };
}

export async function runServerLauncher(): Promise<void> {
  const deployRoot = resolve(process.env.RAG_DEPLOY_ROOT ?? process.cwd());
  let verifyingPending = false;

  for (;;) {
    const resolved = resolveServerEntrypoint(deployRoot);
    const { code, signal, readyVerified } = await launchServer(deployRoot, resolved, verifyingPending ? resolved.version : undefined);
    if (readyVerified) verifyingPending = false;
    if (signal) {
      process.kill(process.pid, signal);
      return;
    }

    if (code === SERVER_EXIT_UPDATE_RESTART && readPendingServerVersion(deployRoot)) {
      promotePendingServerVersion(deployRoot);
      verifyingPending = true;
      continue;
    }

    if (code === SERVER_EXIT_ROLLBACK || (verifyingPending && !readyVerified && code !== 0)) {
      rollbackToPreviousServerVersion(deployRoot);
      const errorCode = code === SERVER_EXIT_ROLLBACK ? 'READY_TIMEOUT' : 'START_FAILED';
      markPendingServerUpdateRolledBack(deployRoot, errorCode, `server version ${resolved.version} failed to become ready`);
      verifyingPending = false;
      continue;
    }

    process.exit(code ?? 0);
  }
}

if (typeof require !== 'undefined' && typeof module !== 'undefined' && require.main === module) {
  runServerLauncher().catch((err) => {
    console.error('[server-launcher] fatal:', err instanceof Error ? err.message : err);
    process.exit(1);
  });
}
