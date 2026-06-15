const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert');

const root = path.join(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');

const ecosystem = read('ecosystem.config.cjs');
const buildAll = read('scripts/build-all.ts');
const packageScript = read('scripts/package.ts');
const startPolicy = read('scripts/client-startup-policy.test.cjs');
const clientMain = read('apps/client/src/main.ts');
const campaignExecutor = read('apps/server/src/modules/updates/campaign-executor.ts');
const wsHandlers = read('apps/server/src/ws/ws-handlers.ts');

assert.ok(ecosystem.includes('client-launcher.cjs'), 'PM2 ecosystem should prefer client launcher');
assert.ok(ecosystem.includes('RAG_DEPLOY_ROOT'), 'PM2 ecosystem should expose deploy root');
assert.ok(buildAll.includes('apps/client/src/launcher.ts') && buildAll.includes('client-launcher.cjs'), 'build should emit client launcher');
assert.ok(startPolicy.includes('node client-launcher.cjs'), 'startup policy should enforce launcher scripts');
assert.ok(packageScript.includes('release-manifest.json'), 'package should emit release manifest');
assert.ok(packageScript.includes('rag-client-v') && packageScript.includes('rag-server-v'), 'package should emit split update artifacts');
assert.ok(!clientMain.includes('downloader not initialized'), 'client main must not use placeholder update deps');
assert.ok(clientMain.includes('createUpdateDeps(config, CLIENT_VERSION)'), 'client main should wire real update deps with current version context');
assert.ok(campaignExecutor.includes('Server self-update is not implemented yet'), 'server self-update should be explicitly blocked');
assert.ok(!campaignExecutor.includes('(placeholder)'), 'campaign executor must not fake placeholder success');
assert.ok(wsHandlers.includes('createUpdateStatusHandler'), 'WS handler should persist client update status');

console.log('update flow integration policy is correct');
