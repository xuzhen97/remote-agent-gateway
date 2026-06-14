const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert');

const pkg = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'package.json'), 'utf8'));
const scripts = pkg.scripts || {};
const expectedKeys = ['build', 'clean', 'compile', 'dev', 'package', 'test', 'typecheck', 'version:major', 'version:minor', 'version:patch', 'version:sync'];

assert.deepStrictEqual(Object.keys(scripts).sort(), expectedKeys, 'root scripts should stay minimal');
assert.strictEqual(scripts.compile, 'pnpm -r build', 'compile should compile all workspace packages');
assert.strictEqual(scripts.build, 'tsx scripts/build-all.ts', 'build should assemble dist output');
assert.strictEqual(scripts.dev, 'tsx scripts/dev.ts', 'dev should start server, client, and web development processes');
assert.strictEqual(scripts.package, 'tsx scripts/package.ts', 'package should keep current-platform packaging entrypoint');
assert.strictEqual(scripts['version:sync'], 'tsx scripts/sync-version.ts', 'version:sync should sync root version to all subpackages');
assert.strictEqual(scripts['version:patch'], 'tsx scripts/sync-version.ts --bump patch', 'version:patch should perform patch bump via sync-version');
assert.strictEqual(scripts['version:minor'], 'tsx scripts/sync-version.ts --bump minor', 'version:minor should perform minor bump via sync-version');
assert.strictEqual(scripts['version:major'], 'tsx scripts/sync-version.ts --bump major', 'version:major should perform major bump via sync-version');

console.log('package.json script naming is correct');
