/**
 * Build both server and client bundles for distribution.
 */
import * as esbuild from 'esbuild';
import * as fs from 'node:fs';
import * as path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..');
const DIST = path.join(ROOT, 'dist');

fs.mkdirSync(DIST, { recursive: true });

// Clean old builds
for (const f of fs.readdirSync(DIST)) {
  if (f.endsWith('.js') || f.endsWith('.cjs') || f.endsWith('.map')) {
    fs.unlinkSync(path.join(DIST, f));
  }
}

// ── Build Server (CJS for Fastify/avvio compat) ─────────────────────
console.log('[1/2] Building server bundle...');

await esbuild.build({
  entryPoints: [path.join(ROOT, 'apps/server/src/main.ts')],
  bundle: true,
  platform: 'node',
  target: 'node22',
  format: 'cjs',
  outfile: path.join(DIST, 'server.bundle.cjs'),
  minify: false,
  sourcemap: true,
  external: [],
});

// Copy sql.js wasm
const wasmPattern = /sql-wasm\.wasm$/;
function findWasm(dir: string): string | null {
  try {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        const found = findWasm(full);
        if (found) return found;
      } else if (wasmPattern.test(entry.name)) {
        return full;
      }
    }
  } catch { /* skip */ }
  return null;
}

const wasmPath = findWasm(path.join(ROOT, 'node_modules', '.pnpm'));
if (wasmPath) {
  fs.copyFileSync(wasmPath, path.join(DIST, 'sql-wasm.wasm'));
  console.log('  Copied sql-wasm.wasm');
} else {
  console.warn('  WARNING: sql-wasm.wasm not found');
}

fs.existsSync(path.join(ROOT, '.env.example')) &&
  fs.copyFileSync(path.join(ROOT, '.env.example'), path.join(DIST, '.env.example'));

// Copy web console
const webSrc = path.join(ROOT, 'apps', 'server', 'src', 'web');
const webDst = path.join(DIST, 'web');
if (fs.existsSync(webSrc)) {
  fs.cpSync(webSrc, webDst, { recursive: true });
  console.log('  Copied web console');
}

console.log('  server.bundle.js ready');

// ── Build Client (CJS) ──────────────────────────────────────────────
console.log('[2/2] Building client bundle...');

await esbuild.build({
  entryPoints: [path.join(ROOT, 'apps/client/src/main.ts')],
  bundle: true,
  platform: 'node',
  target: 'node22',
  format: 'cjs',
  outfile: path.join(DIST, 'client.bundle.cjs'),
  minify: false,
  sourcemap: true,
  external: ['systeminformation'],
});

fs.existsSync(path.join(ROOT, 'apps/client/config.example.json')) &&
  fs.copyFileSync(path.join(ROOT, 'apps/client/config.example.json'), path.join(DIST, 'config.example.json'));

console.log('  client.bundle.js ready');

// ── Launcher scripts ────────────────────────────────────────────────
console.log('Generating launchers...');

fs.writeFileSync(path.join(DIST, 'start-server.bat'), [
  '@echo off',
  'title Remote Agent Gateway - Server',
  'echo Starting server...',
  'if not exist .env copy .env.example .env',
  'echo Edit .env to configure admin/agent tokens',
  'node server.bundle.cjs',
  'pause',
].join('\r\n'));

fs.writeFileSync(path.join(DIST, 'start-client.bat'), [
  '@echo off',
  'title Remote Agent Gateway - Client',
  'echo Starting client agent...',
  'if not exist config.json copy config.example.json config.json',
  'echo Edit config.json to configure server URL and token',
  'node client.bundle.cjs',
  'pause',
].join('\r\n'));

const shServer = [
  '#!/bin/bash',
  'echo "Starting Remote Agent Gateway Server..."',
  '[ ! -f .env ] && cp .env.example .env && echo "Created .env — edit to configure"',
  'node server.bundle.cjs',
].join('\n');
fs.writeFileSync(path.join(DIST, 'start-server.sh'), shServer);
fs.chmodSync(path.join(DIST, 'start-server.sh'), 0o755);

const shClient = [
  '#!/bin/bash',
  'echo "Starting Remote Agent Gateway Client..."',
  '[ ! -f config.json ] && cp config.example.json config.json && echo "Created config.json — edit to configure"',
  'node client.bundle.cjs',
].join('\n');
fs.writeFileSync(path.join(DIST, 'start-client.sh'), shClient);
fs.chmodSync(path.join(DIST, 'start-client.sh'), 0o755);

// ── Summary ─────────────────────────────────────────────────────────
const files = fs.readdirSync(DIST).filter((f) => !f.endsWith('.map'));
console.log('\n=== Build complete ===');
console.log(`Output: ${DIST}/`);
for (const f of files.sort()) {
  const stat = fs.statSync(path.join(DIST, f));
  const kb = (stat.size / 1024).toFixed(0);
  console.log(`  ${f.padEnd(24)} ${kb.padStart(6)} KB`);
}
console.log('\nTo distribute: zip dist/ folder and extract on target machine.');
console.log('Requirements: Node.js 22+');
console.log('');
console.log('  Server:  node server.bundle.cjs  (from dist/)');
console.log('  Client:  node client.bundle.cjs  (from dist/)');
