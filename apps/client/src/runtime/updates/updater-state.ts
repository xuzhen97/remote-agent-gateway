import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { dirname } from 'node:path';

export function writeUpdaterState(stateDir: string, state: Record<string, unknown>): void {
  const file = `${stateDir}/updater-state.json`;
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, JSON.stringify(state, null, 2));
}

export function readUpdaterState(stateDir: string): Record<string, unknown> | null {
  const file = `${stateDir}/updater-state.json`;
  if (!existsSync(file)) return null;
  return JSON.parse(readFileSync(file, 'utf8'));
}
