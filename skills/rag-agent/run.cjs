#!/usr/bin/env node
const path = require('node:path');

const entry = path.join(__dirname, 'dist', 'rag.cjs');
const cli = require(entry);

if (!cli || typeof cli.run !== 'function') {
  throw new Error(`Bundled skill CLI does not export run(): ${entry}`);
}

Promise.resolve(cli.run(process.argv.slice(2))).catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
