const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert');

const root = path.join(__dirname, '..');
const source = fs.readFileSync(path.join(root, 'ecosystem.config.cjs'), 'utf8');

assert.ok(
  source.includes("fs.existsSync") && source.includes("server.bundle.cjs") && source.includes("client.bundle.cjs"),
  'ecosystem.config.cjs should detect whether bundles exist beside the config file'
);

assert.ok(
  source.includes("path.resolve(__dirname, 'dist')"),
  'ecosystem.config.cjs should retain dist/ fallback for source-repo usage'
);

console.log('ecosystem config layout policy is correct');
