const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert');

const root = path.join(__dirname, '..');
const buildAll = fs.readFileSync(path.join(root, 'scripts/build-all.ts'), 'utf8');
const buildClient = fs.readFileSync(path.join(root, 'scripts/build-client.ts'), 'utf8');
const buildServer = fs.readFileSync(path.join(root, 'scripts/build-server.ts'), 'utf8');

assert.ok(buildAll.includes('apps/server/src/launcher.ts'), 'build-all.ts should build server launcher entrypoint');
assert.ok(buildAll.includes('server-launcher.cjs'), 'build-all.ts should output server-launcher.cjs');
assert.ok(buildServer.includes('apps/server/src/launcher.ts'), 'build-server.ts should build server launcher entrypoint');
assert.ok(buildServer.includes('server-launcher.cjs'), 'build-server.ts should output server-launcher.cjs');

for (const [name, source] of [['build-all.ts', buildAll], ['build-client.ts', buildClient]]) {
  assert.ok(source.includes('apps/client/src/launcher.ts'), `${name} should build client launcher entrypoint`);
  assert.ok(source.includes('client-launcher.cjs'), `${name} should output client-launcher.cjs`);
  assert.ok(source.includes('process.env.RAG_BUILD_VERSION'), `${name} should inject build version into launcher`);
}

console.log('client launcher build policy is correct');
