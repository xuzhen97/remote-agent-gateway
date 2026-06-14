const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert');

const root = path.join(__dirname, '..');
const buildAll = fs.readFileSync(path.join(root, 'scripts/build-all.ts'), 'utf8');
const buildClient = fs.readFileSync(path.join(root, 'scripts/build-client.ts'), 'utf8');

for (const [name, source] of [['build-all.ts', buildAll], ['build-client.ts', buildClient]]) {
  assert.ok(source.includes('apps/client/src/launcher.ts'), `${name} should build client launcher entrypoint`);
  assert.ok(source.includes('client-launcher.cjs'), `${name} should output client-launcher.cjs`);
  assert.ok(source.includes('process.env.RAG_BUILD_VERSION'), `${name} should inject build version into launcher`);
}

console.log('client launcher build policy is correct');
