const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert');

const root = path.join(__dirname, '..');
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
const scripts = pkg.scripts || {};

assert.strictEqual(scripts.clean, 'tsx scripts/clean.ts', 'root clean script should exist');

const cleanScriptPath = path.join(root, 'scripts', 'clean.ts');
assert.ok(fs.existsSync(cleanScriptPath), 'scripts/clean.ts should exist');

const cleanSource = fs.readFileSync(cleanScriptPath, 'utf8');
for (const target of ['dist', 'release', 'apps/cli/dist', 'apps/client/dist', 'apps/server/dist', 'apps/web/dist', 'packages/shared/dist']) {
  assert.ok(cleanSource.includes(target), `clean.ts should target ${target}`);
}
assert.ok(!cleanSource.includes("'bin'"), 'clean.ts should not remove bin');
assert.ok(!cleanSource.includes('path.join(ROOT, \'bin\')'), 'clean.ts should not remove bin');

console.log('clean script policy is correct');
