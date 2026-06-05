const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert');

const root = path.join(__dirname, '..');
const buildAll = fs.readFileSync(path.join(root, 'scripts', 'build-all.ts'), 'utf8');
const packageScript = fs.readFileSync(path.join(root, 'scripts', 'package.ts'), 'utf8');

assert.ok(
  !buildAll.includes("fs.copyFileSync(path.join(ROOT, 'server.config.yaml'), path.join(DIST, 'server.config.yaml'))"),
  'build-all.ts must not copy root server.config.yaml into dist'
);
assert.ok(
  !buildAll.includes("fs.copyFileSync(path.join(ROOT, 'client.config.yaml'), path.join(DIST, 'client.config.yaml'))"),
  'build-all.ts must not copy root client.config.yaml into dist'
);
assert.ok(
  buildAll.includes("fs.copyFileSync(path.join(ROOT, 'server.config.example.yaml'), path.join(DIST, 'server.config.example.yaml'))"),
  'build-all.ts must copy server.config.example.yaml into dist'
);
assert.ok(
  buildAll.includes("fs.copyFileSync(path.join(ROOT, 'client.config.example.yaml'), path.join(DIST, 'client.config.example.yaml'))"),
  'build-all.ts must copy client.config.example.yaml into dist'
);
assert.ok(
  packageScript.includes("/^server\\.config\\.example\\.yaml$/"),
  'package.ts must retain server.config.example.yaml in packaged dist'
);
assert.ok(
  packageScript.includes("/^client\\.config\\.example\\.yaml$/"),
  'package.ts must retain client.config.example.yaml in packaged dist'
);
assert.ok(
  !packageScript.includes("/^server\\.config\\.yaml$/"),
  'package.ts must not retain server.config.yaml in packaged dist'
);
assert.ok(
  !packageScript.includes("/^client\\.config\\.yaml$/"),
  'package.ts must not retain client.config.yaml in packaged dist'
);

console.log('distribution config policy is correct');
