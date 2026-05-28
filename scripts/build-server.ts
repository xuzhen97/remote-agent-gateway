/**
 * Build server bundle.
 * Usage: tsx scripts/build-server.ts
 */
import * as esbuild from 'esbuild';
import * as fs from 'node:fs';
import * as path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..');
const DIST = path.join(ROOT, 'dist');
fs.mkdirSync(DIST, { recursive: true });

// Clean old server builds
for (const f of fs.readdirSync(DIST)) {
  if ((f.startsWith('server.') && (f.endsWith('.js') || f.endsWith('.cjs') || f.endsWith('.map')))
    || f === 'sql-wasm.wasm') {
    fs.unlinkSync(path.join(DIST, f));
  }
}

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
}

console.log('Server bundle: dist/server.bundle.cjs');
