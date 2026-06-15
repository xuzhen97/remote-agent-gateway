const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert');

const root = path.join(__dirname, '..');
const source = fs.readFileSync(path.join(root, 'scripts/build-all.ts'), 'utf8');

assert.ok(source.includes('client-launcher.cjs'), 'start-client scripts should mention client-launcher.cjs');
assert.ok(source.includes('node client-launcher.cjs'), 'start-client scripts should run launcher when present');
assert.ok(source.includes('node client.bundle.cjs'), 'start-client scripts should keep legacy bundle fallback');
assert.ok(source.includes('if exist client-launcher.cjs'), 'Windows start-client script should check launcher existence');
assert.ok(source.includes('[ -f client-launcher.cjs ]'), 'POSIX start-client script should check launcher existence');
assert.ok(source.includes('set RAG_DEPLOY_ROOT=%CD%'), 'Windows start-client script should expose deploy root to launcher');
assert.ok(source.includes('export RAG_DEPLOY_ROOT="${RAG_DEPLOY_ROOT:-$(pwd)}"'), 'POSIX start-client script should expose deploy root to launcher');

console.log('client startup script policy is correct');
