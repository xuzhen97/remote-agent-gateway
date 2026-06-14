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

assert.ok(
  source.includes('client-launcher.cjs'),
  'ecosystem.config.cjs should know about client launcher'
);

assert.ok(
  source.includes('CLIENT_LAUNCHER'),
  'ecosystem.config.cjs should define CLIENT_LAUNCHER'
);

assert.ok(
  source.includes('fs.existsSync(CLIENT_LAUNCHER)'),
  'ecosystem.config.cjs should prefer launcher when present'
);

assert.ok(
  source.includes('RAG_DEPLOY_ROOT'),
  'ecosystem.config.cjs should expose deployment root to launcher/updater'
);

console.log('ecosystem config layout policy is correct');
