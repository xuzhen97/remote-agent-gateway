const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert');

const root = path.join(__dirname, '..');
const source = fs.readFileSync(path.join(root, 'scripts/package.ts'), 'utf8');

assert.ok(source.includes('client-launcher.cjs'), 'package should keep client launcher in bootstrap package');
assert.ok(source.includes('server-launcher.cjs'), 'package should keep server launcher in bootstrap/update packages');
assert.ok(source.includes('rag-client-v'), 'package should generate client artifacts');
assert.ok(source.includes('rag-server-v'), 'package should generate server artifacts');
assert.ok(source.includes('release-manifest.json'), 'package should generate release manifest');
assert.ok(source.includes('sha256'), 'package should calculate sha256');
assert.ok(source.includes('ReleaseManifest'), 'package should build a release manifest shape');
assert.ok(source.includes("copyIfExists(path.join(DIST, 'client-launcher.cjs')"), 'client role artifact should include client launcher');
assert.ok(source.includes("copyIfExists(path.join(DIST, 'start-client.bat')"), 'client role artifact should include Windows startup script');
assert.ok(source.includes("copyIfExists(path.join(DIST, 'start-client.sh')"), 'client role artifact should include POSIX startup script');
assert.ok(source.includes("copyIfExists(path.join(DIST, 'download-frp.bat')"), 'client role artifact should include Windows FRP downloader');
assert.ok(source.includes("copyIfExists(path.join(DIST, 'download-frp.sh')"), 'client role artifact should include POSIX FRP downloader');
assert.ok(source.includes("copyIfExists(path.join(DIST, 'ecosystem.config.cjs')"), 'client role artifact should include ecosystem config');
assert.ok(source.includes("copyIfExists(path.join(DIST, 'server-launcher.cjs')"), 'server role artifact should include server launcher');
assert.ok(source.includes("copyIfExists(path.join(DIST, 'start-server.bat')"), 'server role artifact should include Windows startup script');
assert.ok(source.includes("copyIfExists(path.join(DIST, 'start-server.sh')"), 'server role artifact should include POSIX startup script');
assert.ok(source.includes("copyIfExists(path.join(DIST, 'download-frp.bat')"), 'server role artifact should include Windows FRP downloader');
assert.ok(source.includes("copyIfExists(path.join(DIST, 'download-frp.sh')"), 'server role artifact should include POSIX FRP downloader');
assert.ok(source.includes("copyIfExists(path.join(DIST, 'ecosystem.config.cjs')"), 'server role artifact should include ecosystem config');

console.log('package artifacts policy is correct');
