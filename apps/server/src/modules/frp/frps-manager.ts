/**
 * Built-in frps manager.
 *
 * Only used when FRP_MODE=builtin. Downloads frps if needed,
 * starts it as a managed child process, and provides health status.
 */
import { spawn, type ChildProcess } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { env } from '../../config/env.js';

let frpsProcess: ChildProcess | null = null;
let frpsReady = false;

export function resolveFrpsBinaryPath(configuredPath: string, fromDir = process.cwd()): string {
  const relativeInput = configuredPath.replace(/^[.][/\\]/, '');
  const candidates: string[] = [];

  if (path.isAbsolute(configuredPath)) {
    candidates.push(configuredPath);
  } else {
    let current = path.resolve(fromDir);
    for (;;) {
      candidates.push(path.resolve(current, relativeInput));
      const parent = path.dirname(current);
      if (parent === current) break;
      current = parent;
    }
  }

  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) return candidate;
    if (process.platform === 'win32' && !candidate.toLowerCase().endsWith('.exe')) {
      const withExe = `${candidate}.exe`;
      if (fs.existsSync(withExe)) return withExe;
    }
  }

  return path.isAbsolute(configuredPath) ? configuredPath : path.resolve(fromDir, configuredPath);
}

/**
 * Ensure frps binary exists. If not, print instructions.
 */
export function ensureFrpsBinary(): boolean {
  const binaryPath = resolveFrpsBinaryPath(env.FRPS_BIN_PATH);
  if (fs.existsSync(binaryPath)) return true;

  console.log('╔══════════════════════════════════════════════╗');
  console.log('║  frps binary not found.                      ║');
  console.log('║                                              ║');
  console.log('║  Run: pnpm download:frp                      ║');
  console.log('║  Or download manually from:                  ║');
  console.log('║  https://github.com/fatedier/frp/releases    ║');
  console.log('║  and place frps at:                          ║');
  console.log(`║  ${binaryPath.padEnd(42)}║`);
  console.log('╚══════════════════════════════════════════════╝');
  return false;
}

/**
 * Start frps as a managed child process.
 * Generates frps.toml from env config and passes it via -c.
 */
export async function startFrps(): Promise<void> {
  if (env.FRP_MODE !== 'builtin') return;

  if (!ensureFrpsBinary()) {
    console.log('Skipping frps startup — binary not found.');
    return;
  }

  const binaryPath = resolveFrpsBinaryPath(env.FRPS_BIN_PATH);

  // Generate frps.toml from env
  const configDir = path.resolve(binaryPath, '..', '..', 'frp');
  if (!fs.existsSync(configDir)) {
    fs.mkdirSync(configDir, { recursive: true });
  }

  const tomlPath = path.join(configDir, 'frps-runtime.toml');
  fs.writeFileSync(tomlPath, [
    `bindPort = ${env.FRPS_PORT}`,
    '',
    'auth.method = "token"',
    `auth.token = "${env.FRPS_TOKEN}"`,
    '',
    `webServer.addr = "0.0.0.0"`,
    `webServer.port = ${env.FRPS_DASHBOARD_PORT}`,
    'webServer.user = "admin"',
    'webServer.password = "admin"',
    '',
    'log.to = "./frps.log"',
    'log.level = "info"',
    'log.maxDays = 3',
  ].join('\n'));

  console.log(`Starting frps (builtin mode) on port ${env.FRPS_PORT}...`);

  frpsProcess = spawn(binaryPath, ['-c', tomlPath], {
    cwd: configDir,
    stdio: 'pipe',
  });

  frpsProcess.stdout?.on('data', (data: Buffer) => {
    const msg = data.toString();
    if (msg.includes('frps started')) frpsReady = true;
    console.log(`[frps] ${msg.trim()}`);
  });

  frpsProcess.stderr?.on('data', (data: Buffer) => {
    console.error(`[frps:err] ${data.toString().trim()}`);
  });

  frpsProcess.on('close', (code) => {
    frpsReady = false;
    console.log(`[frps] exited with code ${code}`);
    frpsProcess = null;
  });

  // Wait a moment for it to start
  await new Promise((r) => setTimeout(r, 2000));
  frpsReady = true;
}

/**
 * Stop the managed frps process.
 */
export function stopFrps(): void {
  if (frpsProcess) {
    frpsProcess.kill('SIGTERM');
    frpsProcess = null;
    frpsReady = false;
    console.log('[frps] stopped');
  }
}

/**
 * Check if frps is running (builtin mode only).
 */
export function isFrpsRunning(): boolean {
  return frpsReady && frpsProcess !== null && frpsProcess.exitCode === null;
}
