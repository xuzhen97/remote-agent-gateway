#!/usr/bin/env tsx
/**
 * FRP binary download helper.
 *
 * Downloads the latest frp release for the current platform
 * and extracts frps + frpc to ./bin/
 *
 * Usage:
 *   tsx scripts/download-frp.ts              # direct GitHub
 *   tsx scripts/download-frp.ts --mirror     # use built-in mirrors
 *   FRP_MIRROR=https://ghfast.top/ tsx scripts/download-frp.ts
 */

import * as path from 'node:path';
import * as fs from 'node:fs';
import { execSync } from 'node:child_process';

const ROOT = path.resolve(import.meta.dirname, '..');
const BIN = path.join(ROOT, 'bin');
const FRP_VERSION = '0.69.1';

const useMirror = process.argv.includes('--mirror') || !!process.env.FRP_MIRROR;
const customMirror = process.env.FRP_MIRROR;
const MIRRORS = customMirror
  ? [customMirror]
  : ['https://ghfast.top/', 'https://gh-proxy.com/', 'https://gh.llkk.cc/'];

const platform = process.platform;
const arch = process.arch === 'x64' ? 'amd64' : process.arch;

let fileName: string;
if (platform === 'win32') {
  fileName = `frp_${FRP_VERSION}_windows_${arch}.zip`;
} else if (platform === 'darwin') {
  fileName = `frp_${FRP_VERSION}_darwin_${arch}.tar.gz`;
} else {
  fileName = `frp_${FRP_VERSION}_linux_${arch}.tar.gz`;
}

const rawUrl = `https://github.com/fatedier/frp/releases/download/v${FRP_VERSION}/${fileName}`;

console.log(`Platform: ${platform} ${arch}`);

fs.mkdirSync(BIN, { recursive: true });

function tryDownload(url: string): boolean {
  console.log(`Downloading: ${url}`);
  try {
    const outPath = path.join(BIN, fileName);
    execSync(`curl -fsSL --connect-timeout 10 --max-time 120 -o "${outPath}" "${url}"`, { cwd: ROOT, stdio: 'inherit' });
    return true;
  } catch {
    // Clean up partial download
    try { fs.unlinkSync(path.join(BIN, fileName)); } catch { /* ok */ }
    return false;
  }
}

let downloaded = false;

if (useMirror) {
  // Mirror mode: try each mirror
  for (const mirror of MIRRORS) {
    if (tryDownload(mirror + rawUrl)) {
      downloaded = true;
      break;
    }
    console.log(`Mirror ${mirror} failed, trying next...`);
  }
} else {
  // Direct mode
  if (!tryDownload(rawUrl)) {
    console.error('Direct download failed. Retry with --mirror:');
    console.error('  tsx scripts/download-frp.ts --mirror');
    console.error('Or specify a custom mirror:');
    console.error('  FRP_MIRROR=https://your-mirror/ tsx scripts/download-frp.ts');
  } else {
    downloaded = true;
  }
}

if (!downloaded) {
  console.error('\nAll download attempts failed.');
  console.error('Manually download from:');
  console.error(`  ${rawUrl}`);
  console.error('Extract frps and frpc to the bin/ directory.');
  process.exit(1);
}

// Extract
try {
  const archivePath = path.join(BIN, fileName);
  if (platform === 'win32') {
    execSync(`powershell -Command "Expand-Archive -Path '${archivePath}' -DestinationPath '${BIN}' -Force"`, { stdio: 'inherit' });
    const subdir = `frp_${FRP_VERSION}_windows_${arch}`;
    const src = path.join(BIN, subdir);
    if (fs.existsSync(src)) {
      for (const f of fs.readdirSync(src)) {
        fs.copyFileSync(path.join(src, f), path.join(BIN, f));
      }
      fs.rmSync(src, { recursive: true });
    }
  } else {
    execSync(`tar -xzf "${archivePath}" -C "${BIN}"`, { stdio: 'inherit' });
    const subdir = `frp_${FRP_VERSION}_${platform === 'darwin' ? 'darwin' : 'linux'}_${arch}`;
    const src = path.join(BIN, subdir);
    if (fs.existsSync(src)) {
      for (const f of fs.readdirSync(src)) {
        fs.copyFileSync(path.join(src, f), path.join(BIN, f));
      }
      fs.rmSync(src, { recursive: true });
    }
  }

  // Cleanup archive
  fs.unlinkSync(path.join(BIN, fileName));

  console.log('\nDone! Binaries in bin/:');
  for (const f of fs.readdirSync(BIN)) {
    console.log(`  ${path.join(BIN, f)}`);
  }
} catch (err) {
  console.error('Extraction failed:', err instanceof Error ? err.message : err);
  process.exit(1);
}
