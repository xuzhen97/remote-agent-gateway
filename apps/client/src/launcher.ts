import { existsSync, readFileSync, rmSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { isAbsolute, join, relative, resolve } from 'node:path';
import { markPendingUpdateRolledBack, promotePendingVersion, readClientVersionState, rollbackToPreviousVersion } from './runtime/updates/current-version.js';

export interface CurrentVersionState {
  version: string;
  entrypoint: string;
}

export interface EntrypointResolutionInput {
  deployRoot: string;
  currentVersion: CurrentVersionState | null;
  bundleExists: (file: string) => boolean;
}

export interface EntrypointResolution {
  version: string;
  entrypoint: string;
}

export const CLIENT_EXIT_UPDATE_RESTART = 20;
export const CLIENT_EXIT_ROLLBACK = 21;

export type LauncherDecision = 'exit' | 'promote-pending' | 'rollback' | 'restart-current';

export function decideNextLaunch(input: { exitCode: number | null; hasPending: boolean; verificationFailed: boolean }): LauncherDecision {
  if (input.exitCode === CLIENT_EXIT_UPDATE_RESTART && input.hasPending) return 'promote-pending';
  if (input.exitCode === CLIENT_EXIT_ROLLBACK || input.verificationFailed) return 'rollback';
  if (input.exitCode === 0) return 'exit';
  return 'exit';
}

function hasText(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function isInsideDeployRoot(deployRoot: string, filePath: string): boolean {
  const rel = relative(resolve(deployRoot), resolve(filePath));
  return rel === '' || (!rel.startsWith('..') && !isAbsolute(rel));
}

export function readCurrentVersionState(deployRoot: string): CurrentVersionState | null {
  const file = join(deployRoot, 'state', 'client-current-version.json');
  if (!existsSync(file)) return null;

  try {
    const parsed = JSON.parse(readFileSync(file, 'utf8')) as Partial<CurrentVersionState>;
    if (!hasText(parsed.version) || !hasText(parsed.entrypoint)) return null;
    return {
      version: parsed.version,
      entrypoint: parsed.entrypoint,
    };
  } catch {
    return null;
  }
}

export function resolveClientEntrypoint(input: EntrypointResolutionInput): EntrypointResolution {
  const deployRoot = resolve(input.deployRoot);

  if (input.currentVersion) {
    const resolved = resolve(deployRoot, input.currentVersion.entrypoint);
    if (isInsideDeployRoot(deployRoot, resolved) && input.bundleExists(resolved)) {
      return { version: input.currentVersion.version, entrypoint: resolved };
    }
  }

  const legacy = join(deployRoot, 'client.bundle.cjs');
  if (input.bundleExists(legacy)) {
    return { version: 'bootstrap', entrypoint: legacy };
  }

  throw new Error(`No client bundle found under ${deployRoot}`);
}

function readReadyVersion(deployRoot: string): string | null {
  const file = join(deployRoot, 'state', 'client-ready.json');
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
    if (readReadyVersion(deployRoot) === version) return true;
    await new Promise((resolveReady) => setTimeout(resolveReady, 250));
  }
  return false;
}

async function launchClient(deployRoot: string, resolved: EntrypointResolution, verifyReadyVersion?: string): Promise<{ code: number | null; signal: NodeJS.Signals | null; readyVerified: boolean }> {
  console.log(`[launcher] starting client ${resolved.version}: ${resolved.entrypoint}`);
  if (verifyReadyVersion) {
    rmSync(join(deployRoot, 'state', 'client-ready.json'), { force: true });
  }

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

  if (!verifyReadyVersion) {
    const exit = await exitPromise;
    return { ...exit, readyVerified: false };
  }

  const timeoutMs = Number(process.env.RAG_UPDATE_READY_TIMEOUT_MS ?? '30000');
  const ready = await Promise.race([
    waitForReadyVersion(deployRoot, verifyReadyVersion, timeoutMs).then((value) => ({ type: 'ready' as const, value })),
    exitPromise.then((exit) => ({ type: 'exit' as const, exit })),
  ]);

  if (ready.type === 'exit') return { ...ready.exit, readyVerified: false };
  if (!ready.value) {
    child.kill();
    return { code: CLIENT_EXIT_ROLLBACK, signal: null, readyVerified: false };
  }

  const exit = await exitPromise;
  return { ...exit, readyVerified: true };
}

export async function runLauncher(): Promise<void> {
  const deployRoot = resolve(process.env.RAG_DEPLOY_ROOT ?? process.cwd());
  let verifyingPending = false;

  for (;;) {
    const currentVersion = readCurrentVersionState(deployRoot);
    const resolved = resolveClientEntrypoint({
      deployRoot,
      currentVersion,
      bundleExists: existsSync,
    });

    const { code, signal, readyVerified } = await launchClient(deployRoot, resolved, verifyingPending ? resolved.version : undefined);
    if (readyVerified) verifyingPending = false;
    if (signal) {
      process.kill(process.pid, signal);
      return;
    }

    const state = readClientVersionState(deployRoot);
    const decision = decideNextLaunch({
      exitCode: code,
      hasPending: Boolean(state.pending),
      verificationFailed: verifyingPending && !readyVerified && code !== 0,
    });

    if (decision === 'promote-pending') {
      promotePendingVersion(deployRoot);
      verifyingPending = true;
      continue;
    }

    if (decision === 'rollback') {
      rollbackToPreviousVersion(deployRoot);
      const errorCode = code === CLIENT_EXIT_ROLLBACK ? 'READY_TIMEOUT' : 'START_FAILED';
      markPendingUpdateRolledBack(deployRoot, errorCode, `client version ${resolved.version} failed to become ready`);
      verifyingPending = false;
      continue;
    }

    process.exit(code ?? 0);
  }
}

if (typeof require !== 'undefined' && typeof module !== 'undefined' && require.main === module) {
  runLauncher().catch((err) => {
    console.error('[launcher] fatal:', err instanceof Error ? err.message : err);
    process.exit(1);
  });
}
