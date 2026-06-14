const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert');

const root = path.join(__dirname, '..');
const source = fs.readFileSync(path.join(root, 'apps/client/src/main.ts'), 'utf8');

assert.ok(source.includes('CLIENT_VERSION'), 'client main should use CLIENT_VERSION');
assert.ok(!source.includes("currentVersion: '0.1.0'"), 'client update currentVersion must not be hardcoded');
assert.ok(!source.includes('客户端 Agent v0.1.0'), 'client startup log must not hardcode 0.1.0');

console.log('client main version policy is correct');
