/**
 * Build client bundle.
 * Usage: tsx scripts/build-client.ts
 */
import * as esbuild from 'esbuild';
import * as fs from 'node:fs';
import * as path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..');
const DIST = path.join(ROOT, 'dist');
const ROOT_PACKAGE = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf-8')) as { version?: string };
const BUILD_VERSION = JSON.stringify(ROOT_PACKAGE.version ?? '0.0.0');
fs.mkdirSync(DIST, { recursive: true });

// Clean old client builds
for (const f of fs.readdirSync(DIST)) {
  if ((f.startsWith('client.') || f.startsWith('client-launcher.')) && (f.endsWith('.js') || f.endsWith('.cjs') || f.endsWith('.map'))) {
    fs.unlinkSync(path.join(DIST, f));
  }
}

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
  define: {
    'process.env.RAG_BUILD_VERSION': BUILD_VERSION,
  },
});

await esbuild.build({
  entryPoints: [path.join(ROOT, 'apps/client/src/launcher.ts')],
  bundle: true,
  platform: 'node',
  target: 'node22',
  format: 'cjs',
  outfile: path.join(DIST, 'client-launcher.cjs'),
  minify: false,
  sourcemap: true,
  external: [],
  define: {
    'process.env.RAG_BUILD_VERSION': BUILD_VERSION,
  },
});

console.log('Client bundle: dist/client.bundle.cjs');
console.log('Client launcher: dist/client-launcher.cjs');
