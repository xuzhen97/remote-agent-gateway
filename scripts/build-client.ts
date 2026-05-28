/**
 * Build client bundle.
 * Usage: tsx scripts/build-client.ts
 */
import * as esbuild from 'esbuild';
import * as fs from 'node:fs';
import * as path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..');
const DIST = path.join(ROOT, 'dist');
fs.mkdirSync(DIST, { recursive: true });

// Clean old client builds
for (const f of fs.readdirSync(DIST)) {
  if (f.startsWith('client.') && (f.endsWith('.js') || f.endsWith('.cjs') || f.endsWith('.map'))) {
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
});

console.log('Client bundle: dist/client.bundle.cjs');
