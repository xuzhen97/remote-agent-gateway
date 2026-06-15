import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

export interface ServerVersionPointer {
  version: string;
  entrypoint: string;
  updatedAt?: number;
}

export interface ServerUpdateContext {
  campaignId: string;
  targetId: string;
  attemptId: string;
  fromVersion: string;
  targetVersion: string;
  updatedAt?: number;
}

export interface ServerRollbackContext extends ServerUpdateContext {
  errorCode: string;
  errorMessage: string;
}

function statePath(deployRoot: string, name: string): string {
  return join(deployRoot, 'state', name);
}

function writeJsonAtomic(filePath: string, value: unknown): void {
  mkdirSync(dirname(filePath), { recursive: true });
  const tmp = `${filePath}.tmp`;
  writeFileSync(tmp, `${JSON.stringify(value, null, 2)}\n`);
  rmSync(filePath, { force: true });
  renameSync(tmp, filePath);
}

function readJson<T>(filePath: string, validate: (value: Partial<T>) => boolean): T | null {
  if (!existsSync(filePath)) return null;
  try {
    const parsed = JSON.parse(readFileSync(filePath, 'utf8')) as Partial<T>;
    if (!validate(parsed)) return null;
    return parsed as T;
  } catch {
    return null;
  }
}

function withTimestamp<T extends { updatedAt?: number }>(value: T): T {
  return { ...value, updatedAt: value.updatedAt ?? Date.now() };
}

function isPointer(value: Partial<ServerVersionPointer>): boolean {
  return Boolean(value.version && value.entrypoint);
}

function isUpdateContext(value: Partial<ServerUpdateContext>): boolean {
  return Boolean(value.campaignId && value.targetId && value.attemptId && value.fromVersion && value.targetVersion);
}

function isRollbackContext(value: Partial<ServerRollbackContext>): boolean {
  return isUpdateContext(value) && Boolean(value.errorCode && value.errorMessage);
}

export function readCurrentServerVersion(deployRoot: string): ServerVersionPointer | null {
  return readJson<ServerVersionPointer>(statePath(deployRoot, 'server-current-version.json'), isPointer);
}

export function readPendingServerVersion(deployRoot: string): ServerVersionPointer | null {
  return readJson<ServerVersionPointer>(statePath(deployRoot, 'server-pending-version.json'), isPointer);
}

export function readPreviousServerVersion(deployRoot: string): ServerVersionPointer | null {
  return readJson<ServerVersionPointer>(statePath(deployRoot, 'server-previous-version.json'), isPointer);
}

export function writePendingServerVersion(deployRoot: string, pointer: ServerVersionPointer): void {
  writeJsonAtomic(statePath(deployRoot, 'server-pending-version.json'), withTimestamp(pointer));
}

export function promotePendingServerVersion(deployRoot: string): void {
  const pending = readPendingServerVersion(deployRoot);
  if (!pending) throw new Error('No pending server version to promote');
  const current = readCurrentServerVersion(deployRoot);
  if (current) writeJsonAtomic(statePath(deployRoot, 'server-previous-version.json'), withTimestamp(current));
  writeJsonAtomic(statePath(deployRoot, 'server-current-version.json'), withTimestamp(pending));
  rmSync(statePath(deployRoot, 'server-pending-version.json'), { force: true });
}

export function rollbackToPreviousServerVersion(deployRoot: string): void {
  const previous = readPreviousServerVersion(deployRoot);
  if (!previous) throw new Error('No previous server version to roll back to');
  const current = readCurrentServerVersion(deployRoot);
  if (current) writeJsonAtomic(statePath(deployRoot, 'server-previous-version.json'), withTimestamp(current));
  writeJsonAtomic(statePath(deployRoot, 'server-current-version.json'), withTimestamp(previous));
  rmSync(statePath(deployRoot, 'server-pending-version.json'), { force: true });
}

export function writePendingServerUpdateContext(deployRoot: string, context: ServerUpdateContext): void {
  writeJsonAtomic(statePath(deployRoot, 'server-pending-update.json'), withTimestamp(context));
}

export function readPendingServerUpdateContext(deployRoot: string): ServerUpdateContext | null {
  return readJson<ServerUpdateContext>(statePath(deployRoot, 'server-pending-update.json'), isUpdateContext);
}

export function clearPendingServerUpdateContext(deployRoot: string): void {
  rmSync(statePath(deployRoot, 'server-pending-update.json'), { force: true });
}

export function readRollbackServerUpdateContext(deployRoot: string): ServerRollbackContext | null {
  return readJson<ServerRollbackContext>(statePath(deployRoot, 'server-rollback-update.json'), isRollbackContext);
}

export function clearRollbackServerUpdateContext(deployRoot: string): void {
  rmSync(statePath(deployRoot, 'server-rollback-update.json'), { force: true });
}

export function markPendingServerUpdateRolledBack(deployRoot: string, errorCode: string, errorMessage: string): void {
  const pending = readPendingServerUpdateContext(deployRoot);
  if (!pending) return;
  writeJsonAtomic(statePath(deployRoot, 'server-rollback-update.json'), withTimestamp({ ...pending, errorCode, errorMessage }));
  clearPendingServerUpdateContext(deployRoot);
}
