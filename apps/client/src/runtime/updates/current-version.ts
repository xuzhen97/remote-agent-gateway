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

export interface PendingUpdateContext {
  campaignId: string;
  targetId: string;
  attemptId: string;
  fromVersion: string;
  targetVersion: string;
  updatedAt?: number;
}

export interface RollbackUpdateContext extends PendingUpdateContext {
  errorCode: string;
  errorMessage: string;
}

function statePath(deployRoot: string, name: string): string {
  return join(deployRoot, 'state', name);
}

function readJson<T>(filePath: string, isValid: (value: Partial<T>) => boolean): T | null {
  if (!existsSync(filePath)) return null;
  try {
    const parsed = JSON.parse(readFileSync(filePath, 'utf8')) as Partial<T>;
    if (!isValid(parsed)) return null;
    return parsed as T;
  } catch {
    return null;
  }
}

function readPointer(filePath: string): ClientVersionPointer | null {
  return readJson<ClientVersionPointer>(filePath, (value) => Boolean(value.version && value.entrypoint));
}

function writeJsonAtomic(filePath: string, value: unknown): void {
  mkdirSync(dirname(filePath), { recursive: true });
  const tmp = `${filePath}.tmp`;
  writeFileSync(tmp, `${JSON.stringify(value, null, 2)}\n`);
  rmSync(filePath, { force: true });
  renameSync(tmp, filePath);
}

function withTimestamp<T extends { updatedAt?: number }>(value: T): T {
  return { ...value, updatedAt: value.updatedAt ?? Date.now() };
}

function isPendingUpdateContext(value: Partial<PendingUpdateContext>): boolean {
  return Boolean(value.campaignId && value.targetId && value.attemptId && value.fromVersion && value.targetVersion);
}

function isRollbackUpdateContext(value: Partial<RollbackUpdateContext>): boolean {
  return isPendingUpdateContext(value) && Boolean(value.errorCode && value.errorMessage);
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

export function writePendingUpdateContext(deployRoot: string, context: PendingUpdateContext): void {
  writeJsonAtomic(statePath(deployRoot, 'client-pending-update.json'), withTimestamp(context));
}

export function readPendingUpdateContext(deployRoot: string): PendingUpdateContext | null {
  return readJson<PendingUpdateContext>(statePath(deployRoot, 'client-pending-update.json'), isPendingUpdateContext);
}

export function clearPendingUpdateContext(deployRoot: string): void {
  rmSync(statePath(deployRoot, 'client-pending-update.json'), { force: true });
}

export function readRollbackUpdateContext(deployRoot: string): RollbackUpdateContext | null {
  return readJson<RollbackUpdateContext>(statePath(deployRoot, 'client-rollback-update.json'), isRollbackUpdateContext);
}

export function clearRollbackUpdateContext(deployRoot: string): void {
  rmSync(statePath(deployRoot, 'client-rollback-update.json'), { force: true });
}

export function markPendingUpdateRolledBack(deployRoot: string, errorCode: string, errorMessage: string): void {
  const pending = readPendingUpdateContext(deployRoot);
  if (!pending) return;
  writeJsonAtomic(statePath(deployRoot, 'client-rollback-update.json'), withTimestamp({
    ...pending,
    errorCode,
    errorMessage,
  }));
  clearPendingUpdateContext(deployRoot);
}
