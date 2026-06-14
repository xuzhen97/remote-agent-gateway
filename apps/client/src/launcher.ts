import { existsSync, readFileSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { isAbsolute, join, relative, resolve } from 'node:path';
import { promotePendingVersion, readClientVersionState, rollbackToPreviousVersion } from './runtime/updates/current-version.js';

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

async function launchClient(deployRoot: string, resolved: EntrypointResolution): Promise<{ code: number | null; signal: NodeJS.Signals | null }> {
  console.log(`[launcher] starting client ${resolved.version}: ${resolved.entrypoint}`);
  const child = spawn(process.execPath, [resolved.entrypoint], {
    cwd: deployRoot,
    stdio: 'inherit',
    env: {
      ...process.env,
      RAG_DEPLOY_ROOT: deployRoot,
    },
  });

  return new Promise((resolveExit) => {
    child.on('exit', (code, signal) => resolveExit({ code, signal }));
  });
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

    const { code, signal } = await launchClient(deployRoot, resolved);
    if (signal) {
      process.kill(process.pid, signal);
      return;
    }

    const state = readClientVersionState(deployRoot);
    const decision = decideNextLaunch({
      exitCode: code,
      hasPending: Boolean(state.pending),
      verificationFailed: verifyingPending && code !== 0,
    });

    if (decision === 'promote-pending') {
      promotePendingVersion(deployRoot);
      verifyingPending = true;
      continue;
    }

    if (decision === 'rollback') {
      rollbackToPreviousVersion(deployRoot);
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
