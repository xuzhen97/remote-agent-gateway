/**
 * Build server bundle.
 * Usage: tsx scripts/build-server.ts
 */
import * as esbuild from 'esbuild';
import * as fs from 'node:fs';
import * as path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..');
const DIST = path.join(ROOT, 'dist');
const ROOT_PACKAGE = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf-8')) as { version?: string };
const BUILD_VERSION = JSON.stringify(ROOT_PACKAGE.version ?? '0.0.0');
fs.mkdirSync(DIST, { recursive: true });

// Clean old server builds
for (const f of fs.readdirSync(DIST)) {
  if (((f.startsWith('server.') || f.startsWith('server-launcher.')) && (f.endsWith('.js') || f.endsWith('.cjs') || f.endsWith('.map')))
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
  define: {
    'process.env.RAG_BUILD_VERSION': BUILD_VERSION,
  },
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

// Copy React web console build output
const webSrc = path.join(ROOT, 'apps', 'web', 'dist');
const webDst = path.join(DIST, 'web');
if (fs.existsSync(webSrc)) {
  fs.rmSync(webDst, { recursive: true, force: true });
  fs.cpSync(webSrc, webDst, { recursive: true });
  console.log('  Copied React web console');
}

await esbuild.build({
  entryPoints: [path.join(ROOT, 'apps/server/src/launcher.ts')],
  bundle: true,
  platform: 'node',
  target: 'node22',
  format: 'cjs',
  outfile: path.join(DIST, 'server-launcher.cjs'),
  minify: false,
  sourcemap: true,
  external: [],
  define: {
    'process.env.RAG_BUILD_VERSION': BUILD_VERSION,
  },
});

console.log('Server bundle: dist/server.bundle.cjs');
console.log('Server launcher: dist/server-launcher.cjs');
