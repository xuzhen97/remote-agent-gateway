#!/usr/bin/env tsx
/**
 * Package the dist/ folder into a distributable archive.
 *
 * Usage:
 *   tsx scripts/package.ts              # package for current platform
 *   tsx scripts/package.ts --win        # Windows .zip
 *   tsx scripts/package.ts --linux      # Linux .tar.gz
 *   tsx scripts/package.ts --all        # both
 *
 * Prerequisites: dist/ built (auto-builds if needed)
 */

import * as path from 'node:path';
import * as fs from 'node:fs';
import { execSync, spawnSync } from 'node:child_process';

const ROOT = path.resolve(import.meta.dirname, '..');
const DIST = path.join(ROOT, 'dist');
const RELEASE_DIR = path.join(ROOT, 'release');

const args = process.argv.slice(2);
const targetWin = args.includes('--win') || args.includes('--all');
const targetLinux = args.includes('--linux') || args.includes('--all');
const targetAll = args.includes('--all');

// Default: current platform
if (!targetWin && !targetLinux) {
  if (process.platform === 'win32') targetWin ? null : null;
  // Default to both when no flag given
}

// Determine targets
const isWin = process.platform === 'win32';
const targets: ('win' | 'linux')[] = [];
if (targetWin || (targetAll && isWin) || (!targetWin && !targetLinux && isWin)) targets.push('win');
if (targetLinux || targetAll || (!targetWin && !targetLinux && !isWin)) targets.push('linux');

// ── Build ───────────────────────────────────────────────────────────
if (!fs.existsSync(path.join(DIST, 'server.bundle.cjs'))) {
  console.log('Building dist...');
  execSync('pnpm build:dist', { cwd: ROOT, stdio: 'inherit' });
}

fs.mkdirSync(RELEASE_DIR, { recursive: true });

// Read version from package.json
const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf-8'));
const version = pkg.version || '0.1.0';

// ── Clean dist (remove dev artifacts) ───────────────────────────────
function cleanDist() {
  // Remove files that shouldn't be in the release
  const keepPatterns = [
    /^server\.bundle\.cjs$/,
    /^client\.bundle\.cjs$/,
    /^sql-wasm\.wasm$/,
    /^server\.config\.example\.yaml$/,
    /^server\.config\.yaml$/,
    /^client\.config\.example\.yaml$/,
    /^client\.config\.yaml$/,
    /^start-server\.(bat|sh)$/,
    /^start-client\.(bat|sh)$/,
    /^download-frp\.(bat|sh)$/,
    /^ecosystem\.config\.cjs$/,
    /^DEPLOY\.txt$/,
    /^web$/,
  ];

  for (const f of fs.readdirSync(DIST)) {
    const shouldKeep = keepPatterns.some((p) => p.test(f));
    if (!shouldKeep) {
      const full = path.join(DIST, f);
      try {
        if (fs.statSync(full).isDirectory()) {
          fs.rmSync(full, { recursive: true });
        } else {
          fs.unlinkSync(full);
        }
      } catch { /* ok */ }
    }
  }
}

cleanDist();

// ── Add deploy instructions ─────────────────────────────────────────
fs.writeFileSync(path.join(DIST, 'DEPLOY.txt'), [
  'Remote Agent Gateway — Deployment Guide',
  '==========================================',
  '',
  'Requirements: Node.js 22+',
  '',
  '── Quick Start (PM2 recommended) ──',
  '1. npm install -g pm2',
  '2. ./download-frp.sh   (auto-detect platform, see --mirror for China networks)',
  '3. Edit server.config.yaml / client.config.yaml',
  '4. pm2 start ecosystem.config.cjs',
  '5. pm2 logs',
  '',
  '── Or without PM2 ──',
  'Server: node server.bundle.cjs  (or ./start-server.sh)',
  'Client: node client.bundle.cjs  (or ./start-client.sh)',
  '',
  '── FRP download in China ──',
  './download-frp.sh --mirror',
  'FRP_MIRROR=https://ghfast.top/ ./download-frp.sh',
  '',
  `Version: ${version}`,
  `Build date: ${new Date().toISOString().slice(0, 10)}`,
].join('\r\n'));

// ── Package ─────────────────────────────────────────────────────────
for (const target of targets) {
  const ext = target === 'win' ? 'zip' : 'tar.gz';
  const archiveName = `rag-v${version}-${target}`;
  const archivePath = path.join(RELEASE_DIR, `${archiveName}.${ext}`);

  console.log(`\nPackaging ${archiveName}.${ext}...`);

  if (target === 'win') {
    // Windows: use PowerShell Compress-Archive (built-in)
    const result = spawnSync('powershell', [
      '-Command',
      `Compress-Archive -Path "${DIST}\\*" -DestinationPath "${archivePath}" -Force`,
    ], { stdio: 'inherit' });
    if (result.status !== 0) {
      console.error('  Failed to create zip. Trying alternative...');
      // Fallback: use tar on Windows if available
      const tarResult = spawnSync('tar', ['-czf', archivePath.replace('.zip', '.tar.gz'), '-C', DIST, '.'], { stdio: 'inherit' });
      if (tarResult.status !== 0) {
        console.error('  No archiver available. Files are in dist/ — zip them manually.');
      }
    }
  } else {
    // Linux/Mac: use tar
    // First create a temp .tar, then gzip
    const tarResult = spawnSync('tar', ['-czf', archivePath, '-C', DIST, '.'], { stdio: 'inherit' });
    if (tarResult.status !== 0) {
      console.error('  tar not available. Please install tar or gzip.');
    }
  }
}

// ── Summary ─────────────────────────────────────────────────────────
console.log(`\n${'─'.repeat(50)}`);
const files = fs.readdirSync(RELEASE_DIR).filter((f) => f.endsWith('.zip') || f.endsWith('.tar.gz'));
if (files.length === 0) {
  console.log('No archives created. dist/ folder is ready for manual packaging.');
} else {
  console.log('Release packages:');
  for (const f of files.sort()) {
    const stat = fs.statSync(path.join(RELEASE_DIR, f));
    const mb = (stat.size / (1024 * 1024)).toFixed(1);
    console.log(`  ${f.padEnd(40)} ${mb} MB`);
  }
  console.log(`\n  Location: ${RELEASE_DIR}/`);
}
console.log(`${'─'.repeat(50)}\n`);
