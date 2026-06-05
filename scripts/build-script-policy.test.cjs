const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert');

const root = path.join(__dirname, '..');
const buildAll = fs.readFileSync(path.join(root, 'scripts', 'build-all.ts'), 'utf8');

assert.ok(
  buildAll.includes("['--filter', '@rag/shared', 'build']"),
  'build-all.ts should build @rag/shared before bundling server/client dist'
);

console.log('build script dependency policy is correct');
