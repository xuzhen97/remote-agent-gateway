/**
 * FRP Client Daemon — manages a single frpc process that handles all port mappings.
 *
 * Started automatically when the client receives FRP config from server.
 * When a mapping is created/removed, rebuildFrpcDaemon() regenerates the
 * combined config and restarts frpc.
 */
import { execFileSync, spawn, type ChildProcess } from 'node:child_process';
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
  const configPath = path.join(workDir, 'frpc-combined.toml');
  cleanupOrphanFrpcProcess(workDir, configPath);

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
          const proxyContent = normalizeProxyContent(proxyMatch[1].trim(), file);
          if (proxyContent) proxies.push(`[[proxies]]\n${proxyContent}`);
        }
        continue;
      }
      const proxyContent = normalizeProxyContent(content, file);
      if (proxyContent) proxies.push(`[[proxies]]\n${proxyContent}`);
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
  writeDaemonConfig(workDir, frps, proxies);

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

function normalizeProxyContent(content: string, file: string): string | null {
  const typeMatch = content.match(/^\s*type\s*=\s*"([^"]+)"/m);
  const proxyType = typeMatch?.[1];

  if (proxyType === 'http' || proxyType === 'https') {
    const hasDomainRoute = /^\s*(customDomains|subdomain)\s*=/m.test(content);
    if (!hasDomainRoute) {
      console.log(`[frpc-daemon] dropping invalid ${proxyType} proxy config without domain route: ${file}`);
      return null;
    }
    return content.replace(/^\s*remotePort\s*=.*(?:\r?\n)?/gm, '').trim();
  }

  return content;
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

function cleanupOrphanFrpcProcess(workDir: string, configPath: string): void {
  cleanupFrpcProcessesUsingConfig(configPath);
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

function cleanupFrpcProcessesUsingConfig(configPath: string): void {
  const normalizedConfig = normalizePathForCompare(configPath);

  try {
    const rawOutput = execFileSync('wmic', ['process', 'where', "name='frpc.exe'", 'get', 'ProcessId,CommandLine', '/format:csv'], { encoding: 'utf-8' });
    const output = String(rawOutput);
    for (const line of output.split(/\r?\n/)) {
      if (!line.trim() || line.startsWith('Node,')) continue;
      const match = line.match(/^(.*),(\d+)$/);
      if (!match) continue;
      const commandLine = match[1];
      const pid = Number(match[2]);
      if (!Number.isFinite(pid) || pid <= 0 || pid === process.pid) continue;
      if (!normalizePathForCompare(commandLine).includes(normalizedConfig)) continue;
      try {
        process.kill(pid, 'SIGTERM');
        console.log(`[frpc-daemon] cleaned up orphan process ${pid} for ${configPath}`);
      } catch {
        // ignore missing process or permission issues
      }
    }
  } catch {
    // WMIC may be unavailable on some systems; pid-file cleanup still applies.
  }
}

function normalizePathForCompare(value: string): string {
  return value.replace(/\\/g, '/').replace(/"/g, '').toLowerCase();
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
