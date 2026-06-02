/**
 * Build both server and client bundles for distribution.
 */
import * as esbuild from 'esbuild';
import * as fs from 'node:fs';
import * as path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..');
const DIST = path.join(ROOT, 'dist');

fs.mkdirSync(DIST, { recursive: true });

// Clean old builds and stale legacy config artifacts
for (const f of fs.readdirSync(DIST)) {
  if (
    f.endsWith('.js') ||
    f.endsWith('.cjs') ||
    f.endsWith('.map') ||
    f === '.env' ||
    f === '.env.example' ||
    f === 'config.json' ||
    f === 'config.example.json'
  ) {
    fs.rmSync(path.join(DIST, f), { recursive: true, force: true });
  }
}

// ── Build Server (CJS for Fastify/avvio compat) ─────────────────────
console.log('[1/2] Building server bundle...');

await esbuild.build({
  entryPoints: [path.join(ROOT, 'apps/server/src/main.ts')],
  bundle: true,
  platform: 'node',
  target: 'node22',
  format: 'cjs',
  outfile: path.join(DIST, 'server.bundle.cjs'),
  minify: false,
  sourcemap: true,
  external: [],
});

// Copy sql.js wasm
const wasmPattern = /sql-wasm\.wasm$/;
function findWasm(dir: string): string | null {
  try {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        const found = findWasm(full);
        if (found) return found;
      } else if (wasmPattern.test(entry.name)) {
        return full;
      }
    }
  } catch { /* skip */ }
  return null;
}

const wasmPath = findWasm(path.join(ROOT, 'node_modules', '.pnpm'));
if (wasmPath) {
  fs.copyFileSync(wasmPath, path.join(DIST, 'sql-wasm.wasm'));
  console.log('  Copied sql-wasm.wasm');
} else {
  console.warn('  WARNING: sql-wasm.wasm not found');
}

// Copy server YAML template (always overwrite example)
fs.existsSync(path.join(ROOT, 'server.config.example.yaml')) &&
  fs.copyFileSync(path.join(ROOT, 'server.config.example.yaml'), path.join(DIST, 'server.config.example.yaml'));

// Copy active server config only if dist doesn't already have one
if (!fs.existsSync(path.join(DIST, 'server.config.yaml')) && fs.existsSync(path.join(ROOT, 'server.config.yaml'))) {
  fs.copyFileSync(path.join(ROOT, 'server.config.yaml'), path.join(DIST, 'server.config.yaml'));
}

// Copy web console
const webSrc = path.join(ROOT, 'apps', 'server', 'src', 'web');
const webDst = path.join(DIST, 'web');
if (fs.existsSync(webSrc)) {
  fs.cpSync(webSrc, webDst, { recursive: true });
  console.log('  Copied web console');
}

console.log('  server.bundle.js ready');

// ── Build Client (CJS) ──────────────────────────────────────────────
console.log('[2/2] Building client bundle...');

await esbuild.build({
  entryPoints: [path.join(ROOT, 'apps/client/src/main.ts')],
  bundle: true,
  platform: 'node',
  target: 'node22',
  format: 'cjs',
  outfile: path.join(DIST, 'client.bundle.cjs'),
  minify: false,
  sourcemap: true,
  external: ['systeminformation'],
});

fs.existsSync(path.join(ROOT, 'client.config.example.yaml')) &&
  fs.copyFileSync(path.join(ROOT, 'client.config.example.yaml'), path.join(DIST, 'client.config.example.yaml'));

if (!fs.existsSync(path.join(DIST, 'client.config.yaml')) && fs.existsSync(path.join(ROOT, 'client.config.yaml'))) {
  fs.copyFileSync(path.join(ROOT, 'client.config.yaml'), path.join(DIST, 'client.config.yaml'));
}

console.log('  client.bundle.js ready');

// ── Launcher scripts ────────────────────────────────────────────────
console.log('Generating launchers...');

fs.writeFileSync(path.join(DIST, 'start-server.bat'), [
  '@echo off',
  'title Remote Agent Gateway - Server',
  'echo Starting server...',
  'if not exist server.config.yaml copy server.config.example.yaml server.config.yaml',
  'echo Edit server.config.yaml to configure host, tokens and FRP settings',
  'node server.bundle.cjs',
  'pause',
].join('\r\n'));

fs.writeFileSync(path.join(DIST, 'start-client.bat'), [
  '@echo off',
  'title Remote Agent Gateway - Client',
  'echo Starting client agent...',
  'if not exist client.config.yaml copy client.config.example.yaml client.config.yaml',
  'echo Edit client.config.yaml to configure server URLs and token',
  'node client.bundle.cjs',
  'pause',
].join('\r\n'));

const shServer = [
  '#!/bin/bash',
  'echo "Starting Remote Agent Gateway Server..."',
  '[ ! -f server.config.yaml ] && cp server.config.example.yaml server.config.yaml && echo "Created server.config.yaml — edit to configure"',
  'node server.bundle.cjs',
].join('\n');
fs.writeFileSync(path.join(DIST, 'start-server.sh'), shServer);
fs.chmodSync(path.join(DIST, 'start-server.sh'), 0o755);

const shClient = [
  '#!/bin/bash',
  'echo "Starting Remote Agent Gateway Client..."',
  '[ ! -f client.config.yaml ] && cp client.config.example.yaml client.config.yaml && echo "Created client.config.yaml — edit to configure"',
  'node client.bundle.cjs',
].join('\n');
fs.writeFileSync(path.join(DIST, 'start-client.sh'), shClient);
fs.chmodSync(path.join(DIST, 'start-client.sh'), 0o755);

// ── FRP Download Scripts ────────────────────────────────────────────
const FRP_VERSION = '0.69.1';

// Linux/macOS: download-frp.sh
const shFrp = [
  '#!/bin/bash',
  'set -e',
  `FRP_VERSION="${FRP_VERSION}"`,
  'BIN_DIR="${1:-./bin}"',
  '',
  'case "$(uname -s)" in',
  '  Linux)  PLATFORM="linux";;',
  '  Darwin) PLATFORM="darwin";;',
  '  *)      echo "Unsupported platform: $(uname -s)"; exit 1;;',
  'esac',
  '',
  'ARCH="$(uname -m)"',
  'if [ "$ARCH" = "x86_64" ]; then ARCH="amd64"; fi',
  'if [ "$ARCH" = "aarch64" ]; then ARCH="arm64"; fi',
  '',
  'FILE="frp_${FRP_VERSION}_${PLATFORM}_${ARCH}.tar.gz"',
  'URL="https://github.com/fatedier/frp/releases/download/v${FRP_VERSION}/${FILE}"',
  '',
  'echo "Platform: ${PLATFORM} ${ARCH}"',
  'echo "Downloading: ${URL}"',
  '',
  'mkdir -p "$BIN_DIR"',
  'curl -L -o "${BIN_DIR}/${FILE}" "${URL}"',
  'tar -xzf "${BIN_DIR}/${FILE}" -C "${BIN_DIR}"',
  'rm "${BIN_DIR}/${FILE}"',
  '',
  '# Move binaries out of subfolder',
  'SUBDIR="${BIN_DIR}/frp_${FRP_VERSION}_${PLATFORM}_${ARCH}"',
  'if [ -d "$SUBDIR" ]; then',
  '  cp "$SUBDIR"/* "$BIN_DIR/"',
  '  rm -rf "$SUBDIR"',
  'fi',
  '',
  'chmod +x "$BIN_DIR"/frp*',
  'echo "Done! FRP binaries in $BIN_DIR/:"',
  'ls -la "$BIN_DIR"/frp*',
].join('\n');
fs.writeFileSync(path.join(DIST, 'download-frp.sh'), shFrp);
fs.chmodSync(path.join(DIST, 'download-frp.sh'), 0o755);

// Windows: download-frp.bat
const batFrp = [
  '@echo off',
  'setlocal enabledelayedexpansion',
  `set FRP_VERSION=${FRP_VERSION}`,
  'set BIN_DIR=%~1',
  'if "%BIN_DIR%"=="" set BIN_DIR=.\\bin',
  '',
  'set FILE=frp_%FRP_VERSION%_windows_amd64.zip',
  'set URL=https://github.com/fatedier/frp/releases/download/v%FRP_VERSION%/%FILE%',
  '',
  'echo Downloading: %URL%',
  '',
  'mkdir "%BIN_DIR%" 2>nul',
  'powershell -Command "Invoke-WebRequest -Uri '%URL%' -OutFile '%BIN_DIR%\\%FILE%'"',
  'powershell -Command "Expand-Archive -Path '%BIN_DIR%\\%FILE%' -DestinationPath '%BIN_DIR%' -Force"',
  'del "%BIN_DIR%\\%FILE%"',
  '',
  ':: Move binaries out of subfolder',
  'set SUBDIR=%BIN_DIR%\\frp_%FRP_VERSION%_windows_amd64',
  'if exist "%SUBDIR%" (',
  '  copy "%SUBDIR%\\*" "%BIN_DIR%\\" >nul',
  '  rmdir /s /q "%SUBDIR%"',
  ')',
  '',
  'echo Done! FRP binaries in %BIN_DIR%:',
  'dir "%BIN_DIR%\\frp*"',
].join('\r\n');
fs.writeFileSync(path.join(DIST, 'download-frp.bat'), batFrp);

// ── Summary ─────────────────────────────────────────────────────────
const files = fs.readdirSync(DIST).filter((f) => !f.endsWith('.map'));
console.log('\n=== Build complete ===');
console.log(`Output: ${DIST}/`);
for (const f of files.sort()) {
  const stat = fs.statSync(path.join(DIST, f));
  const kb = (stat.size / 1024).toFixed(0);
  console.log(`  ${f.padEnd(24)} ${kb.padStart(6)} KB`);
}
console.log('\nTo distribute: zip dist/ folder and extract on target machine.');
console.log('Requirements: Node.js 22+');
console.log('');
console.log('  Server:  node server.bundle.cjs  (from dist/)');
console.log('  Client:  node client.bundle.cjs  (from dist/)');
