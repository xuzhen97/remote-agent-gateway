const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert');

const root = path.join(__dirname, '..');
const source = fs.readFileSync(path.join(root, 'scripts/package.ts'), 'utf8');

assert.ok(source.includes('client-launcher.cjs'), 'package should keep client launcher in bootstrap package');
assert.ok(source.includes('rag-client-v'), 'package should generate client artifacts');
assert.ok(source.includes('rag-server-v'), 'package should generate server artifacts');
assert.ok(source.includes('release-manifest.json'), 'package should generate release manifest');
assert.ok(source.includes('sha256'), 'package should calculate sha256');
assert.ok(source.includes('ReleaseManifest'), 'package should build a release manifest shape');

console.log('package artifacts policy is correct');
