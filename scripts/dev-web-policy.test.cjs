const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert');

const root = path.join(__dirname, '..');
const source = fs.readFileSync(path.join(root, 'scripts', 'dev.ts'), 'utf8');

assert.ok(source.includes("'@rag/server'"), 'dev.ts should start @rag/server');
assert.ok(source.includes("'@rag/client'"), 'dev.ts should start @rag/client');
assert.ok(source.includes("'@rag/web'"), 'dev.ts should start @rag/web for front-end testing');
assert.ok(source.includes('http://127.0.0.1:5174') || source.includes('http://localhost:5174'), 'dev.ts should know the web dev URL');

console.log('dev.ts web policy is correct');
