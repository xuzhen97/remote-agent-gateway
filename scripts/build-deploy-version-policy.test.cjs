const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert');

const root = path.join(__dirname, '..');
const source = fs.readFileSync(path.join(root, 'scripts/build-all.ts'), 'utf8');

assert.ok(source.includes('DEPLOY.txt'), 'build-all.ts should write DEPLOY.txt');
assert.ok(source.includes('Version:'), 'DEPLOY.txt content should include Version');
assert.ok(source.includes('DISPLAY_VERSION'), 'DEPLOY.txt should use root package display version');
assert.ok(source.includes('ROOT_PACKAGE.version'), 'DEPLOY.txt should derive version from root package metadata');

console.log('build deploy version policy is correct');
