const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert');

const root = path.join(__dirname, '..');
const source = fs.readFileSync(path.join(root, 'scripts', 'build-all.ts'), 'utf8');

assert.ok(
  source.includes("process.platform === 'win32'") && source.includes("'cmd.exe'") && source.includes("'/d'") && source.includes("'/s'") && source.includes("'/c'"),
  'build-all.ts should invoke pnpm through cmd.exe /d /s /c on Windows for cross-platform child-process compatibility'
);

assert.ok(
  source.includes("'pnpm'") || source.includes('"pnpm"'),
  'build-all.ts should invoke pnpm directly on non-Windows platforms'
);

assert.ok(
  !source.includes('shell: true'),
  'build-all.ts should not enable shell:true for execFileSync child process calls'
);

console.log('build-all child process policy is correct');
