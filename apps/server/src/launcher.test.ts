import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { resolveServerEntrypoint } from './launcher.js';
import { promotePendingServerVersion, writePendingServerVersion } from './modules/updates/server-version-state.js';

const roots: string[] = [];
function root(): string {
  const value = join(tmpdir(), `rag-server-launcher-${process.pid}-${Date.now()}-${Math.random().toString(16).slice(2)}`);
  mkdirSync(value, { recursive: true });
  roots.push(value);
  return value;
}

afterEach(() => {
  for (const value of roots.splice(0)) rmSync(value, { recursive: true, force: true });
});

describe('server launcher', () => {
  it('resolves current version entrypoint when present', () => {
    const deployRoot = root();
    const bundle = join(deployRoot, 'versions', 'server', '1.0.1', 'server.bundle.cjs');
    mkdirSync(dirname(bundle), { recursive: true });
    writeFileSync(bundle, 'console.log("server")');
    writePendingServerVersion(deployRoot, { version: '1.0.1', entrypoint: 'versions/server/1.0.1/server.bundle.cjs' });
    promotePendingServerVersion(deployRoot);

    const resolved = resolveServerEntrypoint(deployRoot);
    expect(resolved.version).toBe('1.0.1');
    expect(resolved.entrypoint).toBe(bundle);
  });

  it('falls back to root server.bundle.cjs for legacy deployments', () => {
    const deployRoot = root();
    const bundle = join(deployRoot, 'server.bundle.cjs');
    writeFileSync(bundle, 'console.log("server")');

    const resolved = resolveServerEntrypoint(deployRoot);
    expect(resolved.version).toBe('bootstrap');
    expect(resolved.entrypoint).toBe(bundle);
  });
});
