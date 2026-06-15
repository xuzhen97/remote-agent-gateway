#!/usr/bin/env tsx
/**
 * Package the dist/ folder into distributable archives and update artifacts.
 *
 * Usage:
 *   tsx scripts/package.ts              # package all supported platforms
 *   tsx scripts/package.ts --win        # Windows .zip
 *   tsx scripts/package.ts --linux      # Linux .tar.gz
 *   tsx scripts/package.ts --all        # both
 *
 * Prerequisites: dist/ built (auto-builds if needed)
 */

import * as path from 'node:path';
import * as fs from 'node:fs';
import { createHash } from 'node:crypto';
import { execSync, spawnSync } from 'node:child_process';

type PackageTarget = 'win' | 'linux';
type UpdatePlatform = 'windows' | 'linux';
type UpdateTargetType = 'server' | 'client';

interface ReleaseArtifact {
  targetType: UpdateTargetType;
  platform: UpdatePlatform;
  arch: string;
  fileName: string;
  downloadPath: string;
  sha256: string;
  size: number;
  entrypoint: string;
  installerType: 'archive';
  enabled: boolean;
}

interface ReleaseManifest {
  version: string;
  releaseTime: string;
  notes: string;
  minUpdaterVersion: string;
  channel: 'stable';
  compatibleFrom: string[];
  artifacts: ReleaseArtifact[];
}

const ROOT = path.resolve(import.meta.dirname, '..');
const DIST = path.join(ROOT, 'dist');
const RELEASE_DIR = path.join(ROOT, 'release');
const STAGING_DIR = path.join(RELEASE_DIR, '.staging');
const CLIENT_ARTIFACT_PREFIX = 'rag-client-v';
const SERVER_ARTIFACT_PREFIX = 'rag-server-v';

const args = process.argv.slice(2);
const targetWin = args.includes('--win') || args.includes('--all');
const targetLinux = args.includes('--linux') || args.includes('--all');
const targetAll = args.includes('--all');

const targets: PackageTarget[] = [];
if (!targetWin && !targetLinux) {
  targets.push('win', 'linux');
} else {
  if (targetWin || targetAll) targets.push('win');
  if (targetLinux || targetAll) targets.push('linux');
}

function ensureBuiltDist(): void {
  const required = ['server.bundle.cjs', 'client.bundle.cjs', 'client-launcher.cjs'];
  if (required.some((file) => !fs.existsSync(path.join(DIST, file)))) {
    console.log('Building dist...');
    execSync('pnpm build', { cwd: ROOT, stdio: 'inherit' });
  }
}

ensureBuiltDist();
fs.mkdirSync(RELEASE_DIR, { recursive: true });
for (const file of fs.readdirSync(RELEASE_DIR)) {
  if (/^rag-.*\.(zip|tar\.gz)$/.test(file) || file === 'release-manifest.json') {
    fs.rmSync(path.join(RELEASE_DIR, file), { force: true });
  }
}
fs.rmSync(STAGING_DIR, { recursive: true, force: true });
fs.mkdirSync(STAGING_DIR, { recursive: true });

const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf-8')) as { version?: string };
const version = pkg.version || '0.1.0';

function cleanDist() {
  const keepPatterns = [
    /^server\.bundle\.cjs$/,
    /^server-launcher\.cjs$/,
    /^client\.bundle\.cjs$/,
    /^client-launcher\.cjs$/,
    /^sql-wasm\.wasm$/,
    /^server\.config\.example\.yaml$/,
    /^client\.config\.example\.yaml$/,
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

function writeDeployGuide(): void {
  fs.writeFileSync(path.join(DIST, 'DEPLOY.txt'), [
    'Remote Agent Gateway — Deployment Guide',
    '==========================================',
    '',
    'Requirements: Node.js 22+',
    '',
    '── Quick Start (PM2 recommended) ──',
    '1. npm install -g pm2',
    '2. ./download-frp.sh   (auto-detect platform, see --mirror for China networks)',
    '3. Copy server.config.example.yaml / client.config.example.yaml and rename them before starting',
    '4. pm2 start ecosystem.config.cjs',
    '5. pm2 logs',
    '',
    '── Or without PM2 ──',
    'Server: node server-launcher.cjs  (or ./start-server.sh; falls back to server.bundle.cjs)',
    'Client: node client-launcher.cjs  (or ./start-client.sh; falls back to client.bundle.cjs)',
    '',
    '── FRP download in China ──',
    './download-frp.sh --mirror',
    'FRP_MIRROR=https://ghfast.top/ ./download-frp.sh',
    '',
    `Version: ${version}`,
    `Build date: ${new Date().toISOString().slice(0, 10)}`,
  ].join('\r\n'));
}

function copyIfExists(src: string, dest: string): void {
  if (!fs.existsSync(src)) return;
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  const stat = fs.statSync(src);
  if (stat.isDirectory()) fs.cpSync(src, dest, { recursive: true });
  else fs.copyFileSync(src, dest);
}

function sha256(filePath: string): string {
  return createHash('sha256').update(fs.readFileSync(filePath)).digest('hex');
}

function fileSize(filePath: string): number {
  return fs.statSync(filePath).size;
}

function packageZip(sourceDir: string, archivePath: string): void {
  const result = spawnSync('powershell', [
    '-NoProfile',
    '-Command',
    `Compress-Archive -Path "${sourceDir}\\*" -DestinationPath "${archivePath}" -Force`,
  ], { stdio: 'inherit' });
  if (result.status !== 0) throw new Error(`Failed to create zip: ${archivePath}`);
}

function packageTarGz(sourceDir: string, archivePath: string): void {
  const relativeArchive = path.relative(ROOT, archivePath).replace(/\\/g, '/');
  const result = spawnSync('tar', ['-czf', relativeArchive, '-C', sourceDir, '.'], { cwd: ROOT, stdio: 'inherit' });
  if (result.status !== 0) throw new Error(`Failed to create tar.gz: ${archivePath}`);
}

function packageDirectory(sourceDir: string, archivePath: string, target: PackageTarget): void {
  fs.rmSync(archivePath, { force: true });
  if (target === 'win') packageZip(sourceDir, archivePath);
  else packageTarGz(sourceDir, archivePath);
}

function platformForTarget(target: PackageTarget): UpdatePlatform {
  return target === 'win' ? 'windows' : 'linux';
}

function extensionForTarget(target: PackageTarget): 'zip' | 'tar.gz' {
  return target === 'win' ? 'zip' : 'tar.gz';
}

function stageClientArtifact(stage: string): void {
  copyIfExists(path.join(DIST, 'client.bundle.cjs'), path.join(stage, 'client.bundle.cjs'));
  copyIfExists(path.join(DIST, 'client-launcher.cjs'), path.join(stage, 'client-launcher.cjs'));
  copyIfExists(path.join(DIST, 'client.config.example.yaml'), path.join(stage, 'client.config.example.yaml'));
  copyIfExists(path.join(DIST, 'start-client.bat'), path.join(stage, 'start-client.bat'));
  copyIfExists(path.join(DIST, 'start-client.sh'), path.join(stage, 'start-client.sh'));
  copyIfExists(path.join(DIST, 'download-frp.bat'), path.join(stage, 'download-frp.bat'));
  copyIfExists(path.join(DIST, 'download-frp.sh'), path.join(stage, 'download-frp.sh'));
  copyIfExists(path.join(DIST, 'ecosystem.config.cjs'), path.join(stage, 'ecosystem.config.cjs'));
}

function stageServerArtifact(stage: string): void {
  copyIfExists(path.join(DIST, 'server.bundle.cjs'), path.join(stage, 'server.bundle.cjs'));
  copyIfExists(path.join(DIST, 'server-launcher.cjs'), path.join(stage, 'server-launcher.cjs'));
  copyIfExists(path.join(DIST, 'server.config.example.yaml'), path.join(stage, 'server.config.example.yaml'));
  copyIfExists(path.join(DIST, 'start-server.bat'), path.join(stage, 'start-server.bat'));
  copyIfExists(path.join(DIST, 'start-server.sh'), path.join(stage, 'start-server.sh'));
  copyIfExists(path.join(DIST, 'download-frp.bat'), path.join(stage, 'download-frp.bat'));
  copyIfExists(path.join(DIST, 'download-frp.sh'), path.join(stage, 'download-frp.sh'));
  copyIfExists(path.join(DIST, 'ecosystem.config.cjs'), path.join(stage, 'ecosystem.config.cjs'));
  copyIfExists(path.join(DIST, 'sql-wasm.wasm'), path.join(stage, 'sql-wasm.wasm'));
  copyIfExists(path.join(DIST, 'web'), path.join(stage, 'web'));
}

function createUpdateArtifact(targetType: UpdateTargetType, target: PackageTarget): ReleaseArtifact {
  const platform = platformForTarget(target);
  const ext = extensionForTarget(target);
  const artifactPrefix = targetType === 'client' ? CLIENT_ARTIFACT_PREFIX : SERVER_ARTIFACT_PREFIX;
  const artifactName = `${artifactPrefix}${version}-${platform}-x64.${ext}`;
  const stage = path.join(STAGING_DIR, artifactName.replace(/\.(zip|tar\.gz)$/, ''));
  fs.rmSync(stage, { recursive: true, force: true });
  fs.mkdirSync(stage, { recursive: true });

  if (targetType === 'client') stageClientArtifact(stage);
  else stageServerArtifact(stage);

  const archivePath = path.join(RELEASE_DIR, artifactName);
  packageDirectory(stage, archivePath, target);

  return {
    targetType,
    platform,
    arch: 'x64',
    fileName: artifactName,
    downloadPath: `/updates/artifacts/${version}/${artifactName}`,
    sha256: sha256(archivePath),
    size: fileSize(archivePath),
    entrypoint: targetType === 'client' ? 'client.bundle.cjs' : 'server.bundle.cjs',
    installerType: 'archive',
    enabled: true,
  };
}

cleanDist();
writeDeployGuide();

// Full bootstrap packages keep the complete dist layout, including client-launcher.cjs.
for (const target of targets) {
  const ext = extensionForTarget(target);
  const archiveName = `rag-v${version}-${target}`;
  const archiveFileName = `${archiveName}.${ext}`;
  const archivePath = path.join(RELEASE_DIR, archiveFileName);

  console.log(`\nPackaging bootstrap ${archiveFileName}...`);
  packageDirectory(DIST, archivePath, target);
}

// Update artifacts are intentionally split by role/platform for ReleaseManifest selection.
const artifacts: ReleaseArtifact[] = [];
for (const target of targets) {
  console.log(`\nPackaging update artifacts for ${target}...`);
  artifacts.push(createUpdateArtifact('client', target));
  artifacts.push(createUpdateArtifact('server', target));
}

const manifest: ReleaseManifest = {
  version,
  releaseTime: new Date().toISOString(),
  notes: `Remote Agent Gateway ${version}`,
  minUpdaterVersion: version,
  channel: 'stable',
  compatibleFrom: [version],
  artifacts,
};
fs.writeFileSync(path.join(RELEASE_DIR, 'release-manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);

fs.rmSync(STAGING_DIR, { recursive: true, force: true });

console.log(`\n${'─'.repeat(50)}`);
const files = fs.readdirSync(RELEASE_DIR).filter((f) => f.endsWith('.zip') || f.endsWith('.tar.gz') || f === 'release-manifest.json');
if (files.length === 0) {
  console.log('No archives created. dist/ folder is ready for manual packaging.');
} else {
  console.log('Release packages:');
  for (const f of files.sort()) {
    const stat = fs.statSync(path.join(RELEASE_DIR, f));
    const mb = (stat.size / (1024 * 1024)).toFixed(1);
    console.log(`  ${f.padEnd(48)} ${mb} MB`);
  }
  console.log(`\n  Location: ${RELEASE_DIR}/`);
}
console.log(`${'─'.repeat(50)}\n`);
