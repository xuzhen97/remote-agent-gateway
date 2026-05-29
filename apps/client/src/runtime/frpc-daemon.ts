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

export function setFrpsInfo(info: { serverAddr: string; serverPort: number; authToken: string }): void {
  lastFrpsInfo = info;
}

function getFrpsInfo(config: ClientConfig) {
  if (lastFrpsInfo) return lastFrpsInfo;
  return {
    serverAddr: new URL(config.apiBaseUrl).hostname,
    serverPort: 7000,
    authToken: config.token,
  };
}

export function startFrpcDaemon(config: ClientConfig): void {
  rebuildFrpcDaemon(config);
}

export function stopFrpcDaemon(): void {
  if (daemonProcess) {
    daemonProcess.kill('SIGTERM');
    daemonProcess = null;
    console.log('[frpc-daemon] stopped');
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
  const frps = getFrpsInfo(config);
  const workDir = path.resolve(config.frpcWorkDir ?? path.join(config.workspaceDir, 'frp'));
  fs.mkdirSync(workDir, { recursive: true });

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

    daemonProcess.stderr?.on('data', (d: Buffer) => {
      const msg = d.toString().trim();
      if (msg) console.log(`[frpc-daemon] ${msg}`);
    });

    daemonProcess.on('error', (err) => {
      console.error(`[frpc-daemon] error: ${err.message}`);
      daemonProcess = null;
    });

    daemonProcess.on('exit', (code) => {
      console.log(`[frpc-daemon] exited (code ${code})`);
      daemonProcess = null;
    });

    console.log(`[frpc-daemon] started with ${proxies.length} proxies → ${frps.serverAddr}:${frps.serverPort}`);
    return { proxyCount: proxies.length };
  } catch (err) {
    console.error('[frpc-daemon] spawn failed:', err);
    return null;
  }
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
