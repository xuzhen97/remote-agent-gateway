const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert');

const root = path.join(__dirname, '..');
const source = fs.readFileSync(path.join(root, 'scripts', 'package.ts'), 'utf8');

assert.ok(
  source.includes("spawnSync('tar'") || source.includes('spawnSync("tar"'),
  'package.ts should invoke tar for linux archives'
);
assert.ok(
  source.includes("cwd: ROOT") || source.includes("cwd: root") || source.includes("cwd: repoRoot"),
  'package.ts should run tar with an explicit cwd to avoid Windows absolute-path issues'
);
assert.ok(
  source.includes("release/${archiveName}.tar.gz") || source.includes("path.join('release'") || source.includes('path.posix.join(\'release\''),
  'package.ts should build tar.gz using a relative release path instead of a drive-letter absolute path'
);

console.log('package tar path policy is correct');
