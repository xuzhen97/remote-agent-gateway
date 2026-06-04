const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert');

const pkg = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'package.json'), 'utf8'));
const scripts = pkg.scripts || {};
const expectedKeys = ['build', 'compile', 'dev', 'package', 'test', 'typecheck'];

assert.deepStrictEqual(Object.keys(scripts).sort(), expectedKeys, 'root scripts should stay minimal');
assert.strictEqual(scripts.compile, 'pnpm -r build', 'compile should compile all workspace packages');
assert.strictEqual(scripts.build, 'tsx scripts/build-all.ts', 'build should assemble dist output');
assert.strictEqual(scripts.package, 'tsx scripts/package.ts', 'package should keep current-platform packaging entrypoint');

console.log('package.json script naming is correct');
