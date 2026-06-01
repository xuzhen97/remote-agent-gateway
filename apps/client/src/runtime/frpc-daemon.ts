/**
 * FRP Client Daemon — manages a single frpc process that handles all port mappings.
 *
 * Started automatically when the client receives FRP config from server.
 * When a mapping is created/removed, rebuildFrpcDaemon() regenerates the
 * combined config and restarts frpc.
 */
import { spawn, type ChildProcess } from 'node:child_process';
import * as path from 'node:path';
import * as fs from 'node:fs';
import type { ClientConfig } from '../config/client.config.js';

let daemonProcess: ChildProcess | null = null;
let lastFrpsInfo: { serverAddr: string; serverPort: number; authToken: string } | null = null;
const PID_FILE_NAME = 'frpc-daemon.pid';

export function setFrpsInfo(info: { serverAddr: string; serverPort: number; authToken: string }): void {
  lastFrpsInfo = info;
}

function getFrpsInfo() {
  if (lastFrpsInfo) return lastFrpsInfo;
  throw new Error('FRP connection info not initialized');
}

export function startFrpcDaemon(config: ClientConfig): void {
  rebuildFrpcDaemon(config);
}

export function stopFrpcDaemon(): void {
  if (daemonProcess) {
    daemonProcess.kill('SIGTERM');
    daemonProcess = null;
    console.log('[frpc-daemon] stopped');
    return;
  }
}

export function isFrpcRunning(): boolean {
  return daemonProcess !== null && daemonProcess.exitCode === null;
}

/**
 * Read all saved mapping configs, generate a combined frpc config,
 * restart frpc with it.
 */
export function rebuildFrpcDaemon(config: ClientConfig): { proxyCount: number } | null {
  const frps = getFrpsInfo();
  const workDir = path.resolve(config.frpcWorkDir ?? path.join(config.workspaceDir, 'frp'));
  fs.mkdirSync(workDir, { recursive: true });
  cleanupOrphanFrpcProcess(workDir);

  // Collect all mapping configs
  const mappingsDir = path.join(workDir, 'mappings');
  fs.mkdirSync(mappingsDir, { recursive: true });
  const proxies: string[] = [];

  // Clean up old-format full-config files on each rebuild
  if (fs.existsSync(mappingsDir)) {
    for (const file of fs.readdirSync(mappingsDir)) {
      if (!file.endsWith('.toml')) continue;
      const content = fs.readFileSync(path.join(mappingsDir, file), 'utf-8');
      if (content.includes('serverAddr')) {
        console.log(`[frpc-daemon] removing old-format config: ${file}`);
        try { fs.unlinkSync(path.join(mappingsDir, file)); } catch { /* ok */ }
      }
    }
  }

  if (fs.existsSync(mappingsDir)) {
    for (const file of fs.readdirSync(mappingsDir)) {
      if (!file.endsWith('.toml')) continue;
      const content = fs.readFileSync(path.join(mappingsDir, file), 'utf-8').trim();
      if (!content) continue;
      // Skip old-format files that already contain full frpc config headers
      if (content.includes('serverAddr') || content.includes('auth.token')) {
        console.log(`[frpc-daemon] skipping old-format config: ${file}`);
        // Extract just the [[proxies]] section if present
        const proxyMatch = content.match(/\[\[proxies\]\]\s*\n([\s\S]*)/);
        if (proxyMatch) {
          proxies.push(`[[proxies]]\n${proxyMatch[1].trim()}`);
        }
        continue;
      }
      proxies.push(`[[proxies]]\n${content}`);
    }
  }

  // Kill existing daemon
  if (daemonProcess) {
    daemonProcess.kill('SIGTERM');
    daemonProcess = null;
  }

  if (proxies.length === 0) {
    console.log('[frpc-daemon] no proxies — skipping start');
    // Write an empty daemon config anyway for manual start
    writeDaemonConfig(workDir, frps, []);
    return null;
  }

  // Write combined config
  const configPath = writeDaemonConfig(workDir, frps, proxies);

  // Start frpc
  try {
    daemonProcess = spawn(config.frpcPath!, ['-c', configPath], {
      cwd: workDir,
      stdio: 'pipe',
    });

    if (typeof daemonProcess.pid === 'number') {
      writePidFile(workDir, daemonProcess.pid);
    }

    daemonProcess.stderr?.on('data', (d: Buffer) => {
      const msg = d.toString().trim();
      if (msg) console.log(`[frpc-daemon] ${msg}`);
    });

    daemonProcess.on('error', (err) => {
      console.error(`[frpc-daemon] error: ${err.message}`);
      removePidFile(workDir);
      daemonProcess = null;
    });

    daemonProcess.on('exit', (code) => {
      console.log(`[frpc-daemon] exited (code ${code})`);
      removePidFile(workDir);
      daemonProcess = null;
    });

    console.log(`[frpc-daemon] started with ${proxies.length} proxies → ${frps.serverAddr}:${frps.serverPort}`);
    return { proxyCount: proxies.length };
  } catch (err) {
    console.error('[frpc-daemon] spawn failed:', err);
    return null;
  }
}

function getPidFilePath(workDir: string): string {
  return path.join(workDir, PID_FILE_NAME);
}

function writePidFile(workDir: string, pid: number): void {
  fs.writeFileSync(getPidFilePath(workDir), String(pid));
}

function removePidFile(workDir: string): void {
  try { fs.unlinkSync(getPidFilePath(workDir)); } catch { /* ignore */ }
}

function cleanupOrphanFrpcProcess(workDir: string): void {
  if (daemonProcess) return;
  const pidFile = getPidFilePath(workDir);
  if (!fs.existsSync(pidFile)) return;

  const raw = fs.readFileSync(pidFile, 'utf-8').trim();
  const pid = Number(raw);
  if (!Number.isFinite(pid) || pid <= 0) {
    removePidFile(workDir);
    return;
  }

  try {
    process.kill(pid, 'SIGTERM');
    console.log(`[frpc-daemon] cleaned up orphan process ${pid}`);
  } catch {
    // ignore missing process or permission issues; pid file is stale either way
  }
  removePidFile(workDir);
}

function writeDaemonConfig(
  workDir: string,
  frps: { serverAddr: string; serverPort: number; authToken: string },
  proxies: string[],
): string {
  const configPath = path.join(workDir, 'frpc-combined.toml');
  const lines = [
    `serverAddr = "${frps.serverAddr}"`,
    `serverPort = ${frps.serverPort}`,
    '',
    'auth.method = "token"',
    `auth.token = "${frps.authToken}"`,
    '',
    proxies.join('\n\n'),
  ];
  fs.writeFileSync(configPath, lines.join('\n').trim() + '\n');
  return configPath;
}
