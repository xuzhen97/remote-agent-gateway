const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert');

const root = path.join(__dirname, '..');
const source = fs.readFileSync(path.join(root, 'scripts', 'package.ts'), 'utf8');

assert.ok(
  source.includes('// Default: build all platforms when no flag is given'),
  'package.ts should document all-platform default behavior'
);
assert.ok(
  source.includes("if (!targetWin && !targetLinux) {") && source.includes("targets.push('win')") && source.includes("targets.push('linux')"),
  'package.ts should select both win and linux targets by default'
);

console.log('package default platform policy is correct');
