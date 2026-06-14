import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

export interface ClientVersionPointer {
  version: string;
  entrypoint: string;
  updatedAt?: number;
}

export interface ClientVersionState {
  current: ClientVersionPointer | null;
  pending: ClientVersionPointer | null;
  previous: ClientVersionPointer | null;
}

function statePath(deployRoot: string, name: string): string {
  return join(deployRoot, 'state', name);
}

function readPointer(filePath: string): ClientVersionPointer | null {
  if (!existsSync(filePath)) return null;
  try {
    const parsed = JSON.parse(readFileSync(filePath, 'utf8')) as ClientVersionPointer;
    if (!parsed.version || !parsed.entrypoint) return null;
    return parsed;
  } catch {
    return null;
  }
}

function writeJsonAtomic(filePath: string, value: unknown): void {
  mkdirSync(dirname(filePath), { recursive: true });
  const tmp = `${filePath}.tmp`;
  writeFileSync(tmp, `${JSON.stringify(value, null, 2)}\n`);
  rmSync(filePath, { force: true });
  renameSync(tmp, filePath);
}

function withTimestamp(pointer: ClientVersionPointer): ClientVersionPointer {
  return { ...pointer, updatedAt: pointer.updatedAt ?? Date.now() };
}

export function readClientVersionState(deployRoot: string): ClientVersionState {
  return {
    current: readPointer(statePath(deployRoot, 'client-current-version.json')),
    pending: readPointer(statePath(deployRoot, 'client-pending-version.json')),
    previous: readPointer(statePath(deployRoot, 'client-previous-version.json')),
  };
}

export function writePendingVersion(deployRoot: string, pointer: ClientVersionPointer): void {
  writeJsonAtomic(statePath(deployRoot, 'client-pending-version.json'), withTimestamp(pointer));
}

export function promotePendingVersion(deployRoot: string): void {
  const state = readClientVersionState(deployRoot);
  if (!state.pending) throw new Error('No pending client version to promote');

  if (state.current) {
    writeJsonAtomic(statePath(deployRoot, 'client-previous-version.json'), withTimestamp(state.current));
  }
  writeJsonAtomic(statePath(deployRoot, 'client-current-version.json'), withTimestamp(state.pending));
  rmSync(statePath(deployRoot, 'client-pending-version.json'), { force: true });
}

export function rollbackToPreviousVersion(deployRoot: string): void {
  const state = readClientVersionState(deployRoot);
  if (!state.previous) throw new Error('No previous client version to roll back to');

  if (state.current) {
    writeJsonAtomic(statePath(deployRoot, 'client-previous-version.json'), withTimestamp(state.current));
  }
  writeJsonAtomic(statePath(deployRoot, 'client-current-version.json'), withTimestamp(state.previous));
  rmSync(statePath(deployRoot, 'client-pending-version.json'), { force: true });
}
