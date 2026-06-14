const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert');

const root = path.join(__dirname, '..');
const buildAll = fs.readFileSync(path.join(root, 'scripts', 'build-all.ts'), 'utf8');
const buildServer = fs.readFileSync(path.join(root, 'scripts', 'build-server.ts'), 'utf8');
const buildClient = fs.readFileSync(path.join(root, 'scripts', 'build-client.ts'), 'utf8');

for (const [name, source] of [
  ['build-all.ts', buildAll],
  ['build-server.ts', buildServer],
  ['build-client.ts', buildClient],
]) {
  assert.ok(source.includes("process.env.RAG_BUILD_VERSION"), `${name} should inject process.env.RAG_BUILD_VERSION into bundles`);
  assert.ok(source.includes("package.json"), `${name} should read root package.json for the build version`);
}

console.log('build version injection policy is correct');
