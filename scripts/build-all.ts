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
  // Suppress harmless warning: import.meta.dirname is a dead fallback in CJS
  // (the typeof __dirname check always takes the CJS branch when bundled)
  logOverride: {
    'empty-import-meta': 'silent',
  },
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

// Copy React web console
console.log('[web] Building React admin console...');
import { execFileSync } from 'node:child_process';
const webBuildSrc = path.join(ROOT, 'apps', 'web', 'dist');
try {
  execFileSync(process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm', ['--filter', '@rag/web', 'build'], { cwd: ROOT, stdio: 'inherit', shell: true });
} catch {
  console.warn('  Admin console build failed; falling back to legacy web dir');
  const webSrcFallback = path.join(ROOT, 'apps', 'server', 'src', 'web');
  if (fs.existsSync(webSrcFallback)) fs.cpSync(webSrcFallback, path.join(DIST, 'web'), { recursive: true });
  return;
}
const webDst = path.join(DIST, 'web');
if (fs.existsSync(webBuildSrc)) {
  fs.rmSync(webDst, { recursive: true, force: true });
  fs.cpSync(webBuildSrc, webDst, { recursive: true });
  console.log('  Copied React web console');
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
  '',
  '# Usage:',
  '#   ./download-frp.sh                  # mirror mode (default)',
  '#   ./download-frp.sh --direct         # GitHub directly',
  '#   ./download-frp.sh ./bin            # specify output dir',
  '#   FRP_MIRROR=https://your-mirror/ ./download-frp.sh  # custom mirror',
  '',
  `FRP_VERSION="${FRP_VERSION}"`,
  'BIN_DIR="./bin"',
  'USE_DIRECT=""',
  '',
  '# Parse args',
  'for arg in "$@"; do',
  '  case "$arg" in',
  '    --direct) USE_DIRECT="1" ;;',
  '    -*) ;;',
  '    *) BIN_DIR="$arg" ;;',
  '  esac',
  'done',
  '',
  '# Mirror list (tried in order, skip if --direct)',
  'MIRRORS=(${FRP_MIRROR:-https://ghfast.top/ https://gh-proxy.com/ https://gh.llkk.cc/})',
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
  'RAW_URL="https://github.com/fatedier/frp/releases/download/v${FRP_VERSION}/${FILE}"',
  '',
  'echo "Platform: ${PLATFORM} ${ARCH}"',
  'echo "FRP version: ${FRP_VERSION}"',
  '',
  'mkdir -p "$BIN_DIR"',
  '',
  '# Try direct download first',
  'download_frp() {',
  '  local url="$1"',
  '  echo "Downloading: ${url}"',
  '  if curl -fsSL --connect-timeout 10 --max-time 120 -o "${BIN_DIR}/${FILE}" "${url}"; then',
  '    return 0',
  '  fi',
  '  rm -f "${BIN_DIR}/${FILE}"',
  '  return 1',
  '}',
  '',
  'if [ -n "$USE_DIRECT" ]; then',
  '  # Direct mode: GitHub only',
  '  if ! download_frp "$RAW_URL"; then',
  '    echo "GitHub direct download failed. Try without --direct to use mirrors."',
  '    exit 1',
  '  fi',
  'else',
  '  # Default: mirror mode — try mirrors first, fallback to direct',
  '  DOWNLOADED=0',
  '  for mirror in "${MIRRORS[@]}"; do',
  '    MIRROR_URL="${mirror}${RAW_URL}"',
  '    if download_frp "$MIRROR_URL"; then',
  '      DOWNLOADED=1',
  '      break',
  '    fi',
  '    echo "Mirror ${mirror} failed, trying next..."',
  '  done',
  '  if [ "$DOWNLOADED" -eq 0 ]; then',
  '    echo "All mirrors failed. Falling back to GitHub direct..."',
  '    if ! download_frp "$RAW_URL"; then',
  '      echo "GitHub direct also failed. Try a custom mirror:"',
  '      echo "  FRP_MIRROR=https://your-mirror/ ./download-frp.sh"',
  '      exit 1',
  '    fi',
  '  fi',
  'fi',
  '',
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
  '',
  ':: Usage:',
  '::   download-frp.bat                  :: mirror mode (default)',
  '::   download-frp.bat --direct         :: GitHub directly',
  '::   set FRP_MIRROR=https://ghfast.top/ && download-frp.bat',
  '',
  `set FRP_VERSION=${FRP_VERSION}`,
  'set BIN_DIR=.\\bin',
  'set USE_DIRECT=0',
  '',
  ':: Parse args',
  ':parse',
  'if "%~1"=="" goto :detect',
  'if "%~1"=="--direct" set USE_DIRECT=1',
  'if not "%~1"=="--direct" set BIN_DIR=%~1',
  'shift',
  'goto :parse',
  '',
  ':detect',
  'set FILE=frp_%FRP_VERSION%_windows_amd64.zip',
  'set RAW_URL=https://github.com/fatedier/frp/releases/download/v%FRP_VERSION%/%FILE%',
  '',
  ':: Build mirror list',
  'if not "%FRP_MIRROR%"=="" (',
  '  set MIRRORS=%FRP_MIRROR%',
  ') else (',
  '  set MIRRORS=https://ghfast.top/ https://gh-proxy.com/ https://gh.llkk.cc/',
  ')',
  '',
  'echo Platform: windows amd64',
  'echo FRP version: %FRP_VERSION%',
  '',
  'mkdir "%BIN_DIR%" 2>nul',
  '',
  'if %USE_DIRECT%==1 (',
  '  echo Downloading: %RAW_URL%',
  '  powershell -Command "try { Invoke-WebRequest -Uri \'%RAW_URL%\' -OutFile \'%BIN_DIR%\\%FILE%\' -TimeoutSec 30 } catch { exit 1 }"',
  '  if errorlevel 1 (',
  '    echo GitHub direct download failed. Try without --direct to use mirrors.',
  '    exit /b 1',
  '  )',
  '  goto :extract',
  ')',
  '',
  ':: Default: mirror mode — try mirrors first, fallback to direct',
  'for %%m in (%MIRRORS%) do (',
  '  set MIRROR_URL=%%m%RAW_URL%',
  '  echo Trying mirror: %%m',
  '  powershell -Command "try { Invoke-WebRequest -Uri \'!MIRROR_URL!\' -OutFile \'%BIN_DIR%\\%FILE%\' -TimeoutSec 30 } catch { exit 1 }"',
  '  if not errorlevel 1 goto :extract',
  '  echo Mirror %%m failed, trying next...',
  '  del "%BIN_DIR%\\%FILE%" 2>nul',
  ')',
  '',
  ':: All mirrors failed, fallback to direct',
  'echo All mirrors failed. Falling back to GitHub direct...',
  'powershell -Command "try { Invoke-WebRequest -Uri \'%RAW_URL%\' -OutFile \'%BIN_DIR%\\%FILE%\' -TimeoutSec 30 } catch { exit 1 }"',
  'if errorlevel 1 (',
  '  echo GitHub direct also failed. Set a custom mirror:',
  '  echo   set FRP_MIRROR=https://your-mirror/ ^&^& download-frp.bat',
  '  exit /b 1',
  ')',
  '',
  ':extract',
  'powershell -Command "Expand-Archive -Path \'%BIN_DIR%\\%FILE%\' -DestinationPath \'%BIN_DIR%\' -Force"',
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

// ── PM2 ecosystem ───────────────────────────────────────────────────
const ecosystemSrc = path.join(ROOT, 'ecosystem.config.cjs');
if (fs.existsSync(ecosystemSrc)) {
  fs.copyFileSync(ecosystemSrc, path.join(DIST, 'ecosystem.config.cjs'));
  console.log('  Copied ecosystem.config.cjs');
}

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
console.log('Requirements: Node.js 22+, pm2 (optional)');
console.log('');
console.log('  Quick start:');
console.log('    pm2 start ecosystem.config.cjs');
console.log('  Or without pm2:');
console.log('    Server:  node server.bundle.cjs  (from dist/)');
console.log('    Client:  node client.bundle.cjs  (from dist/)');
