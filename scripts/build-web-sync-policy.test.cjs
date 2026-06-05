const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert');

const root = path.join(__dirname, '..');
const buildAll = fs.readFileSync(path.join(root, 'scripts', 'build-all.ts'), 'utf8');
const buildServer = fs.readFileSync(path.join(root, 'scripts', 'build-server.ts'), 'utf8');

assert.ok(buildAll.includes("apps', 'web', 'dist"), 'build-all.ts should copy apps/web/dist into dist/web');
assert.ok(buildServer.includes("apps', 'web', 'dist"), 'build-server.ts should copy apps/web/dist into dist/web');
assert.ok(!buildServer.includes("apps', 'server', 'src', 'web"), 'build-server.ts should not copy legacy apps/server/src/web assets');

console.log('build web sync policy is correct');
