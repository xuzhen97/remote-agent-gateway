#!/usr/bin/env tsx
import * as fs from 'node:fs';
import * as path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..');
const targets = [
  'dist',
  'release',
  'apps/cli/dist',
  'apps/client/dist',
  'apps/server/dist',
  'apps/web/dist',
  'packages/shared/dist',
];

let removedCount = 0;
for (const relativeTarget of targets) {
  const absoluteTarget = path.join(ROOT, relativeTarget);
  if (!fs.existsSync(absoluteTarget)) {
    console.log(`skip ${relativeTarget}`);
    continue;
  }
  fs.rmSync(absoluteTarget, { recursive: true, force: true });
  removedCount += 1;
  console.log(`removed ${relativeTarget}`);
}

console.log(`clean complete (${removedCount}/${targets.length} removed)`);
