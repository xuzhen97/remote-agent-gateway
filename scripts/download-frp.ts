#!/usr/bin/env tsx
/**
 * FRP binary download helper.
 *
 * Downloads the latest frp release for the current platform
 * and extracts frps + frpc to ./bin/
 *
 * Usage: tsx scripts/download-frp.ts
 */

import * as path from 'node:path';
import * as fs from 'node:fs';
import { execSync } from 'node:child_process';

const ROOT = path.resolve(import.meta.dirname, '..');
const BIN = path.join(ROOT, 'bin');
const FRP_VERSION = '0.69.1';

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

const url = `https://github.com/fatedier/frp/releases/download/v${FRP_VERSION}/${fileName}`;

console.log(`Platform: ${platform} ${arch}`);
console.log(`Downloading: ${url}`);

fs.mkdirSync(BIN, { recursive: true });

try {
  execSync(`curl -L -o "${path.join(BIN, fileName)}" "${url}"`, { cwd: ROOT, stdio: 'inherit' });

  if (platform === 'win32') {
    execSync(`powershell -Command "Expand-Archive -Path '${path.join(BIN, fileName)}' -DestinationPath '${BIN}' -Force"`, { stdio: 'inherit' });
    // Move binaries out of subfolder
    const subdir = `frp_${FRP_VERSION}_windows_${arch}`;
    const src = path.join(BIN, subdir);
    if (fs.existsSync(src)) {
      for (const f of fs.readdirSync(src)) {
        fs.copyFileSync(path.join(src, f), path.join(BIN, f));
      }
      fs.rmSync(src, { recursive: true });
    }
  } else {
    execSync(`tar -xzf "${path.join(BIN, fileName)}" -C "${BIN}"`, { stdio: 'inherit' });
    const subdir = `frp_${FRP_VERSION}_linux_${arch}`;
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
  console.error('Download failed. You can manually download from:');
  console.error(`  ${url}`);
  console.error('Extract frps and frpc to the bin/ directory.');
  process.exit(1);
}
