import * as esbuild from 'esbuild';
import * as fs from 'node:fs';
import * as path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..');
const SKILL_DIST = path.join(ROOT, 'skills', 'rag-agent', 'dist');
const OUTFILE = path.join(SKILL_DIST, 'rag.cjs');

fs.mkdirSync(SKILL_DIST, { recursive: true });

for (const file of fs.readdirSync(SKILL_DIST)) {
  if (file === 'rag.js' || file === 'rag.js.map' || file === 'rag.cjs' || file === 'rag.cjs.map') {
    fs.rmSync(path.join(SKILL_DIST, file), { force: true });
  }
}

await esbuild.build({
  entryPoints: [path.join(ROOT, 'apps', 'cli', 'src', 'index.ts')],
  bundle: true,
  platform: 'node',
  target: 'node22',
  format: 'cjs',
  outfile: OUTFILE,
  minify: false,
  sourcemap: false,
  external: [],
});

console.log(`Bundled skill CLI: ${path.relative(ROOT, OUTFILE)}`);
