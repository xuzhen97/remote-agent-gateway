/**
 * FRP Client Daemon — auto-starts frpc on client startup
 * and keeps it running as a background process.
 */
import { spawn, type ChildProcess } from 'node:child_process';
import * as path from 'node:path';
import * as fs from 'node:fs';
import type { ClientConfig } from '../config/client.config.js';

let daemonProcess: ChildProcess | null = null;

export function startFrpcDaemon(config: ClientConfig): void {
  if (!config.frpcPath) return;
  if (daemonProcess) return; // already running

  const workDir = config.frpcWorkDir ?? path.join(config.workspaceDir, 'frp');
  fs.mkdirSync(workDir, { recursive: true });

  // Generate minimal frpc config — just connects to frps, no proxies yet
  const daemonConfigPath = path.join(workDir, 'frpc-daemon.toml');
  fs.writeFileSync(daemonConfigPath, [
    `serverAddr = "${new URL(config.apiBaseUrl).hostname}"`,
    'serverPort = 7000',
    '',
    'auth.method = "token"',
    `auth.token = "${config.token}"`,
    '',
    '# Daemon mode: connects to frps and waits for proxy configs.',
    '# Individual mappings are added via separate frpc processes.',
  ].join('\n'));

  try {
    daemonProcess = spawn(config.frpcPath, ['-c', daemonConfigPath], {
      cwd: workDir,
      stdio: 'pipe',
    });

    daemonProcess.on('error', (err) => {
      console.error(`[frpc-daemon] error: ${err.message}`);
      daemonProcess = null;
    });

    daemonProcess.on('exit', (code) => {
      console.log(`[frpc-daemon] exited with code ${code}`);
      daemonProcess = null;
    });

    console.log(`[frpc-daemon] started (PID ${daemonProcess.pid})`);
  } catch (err) {
    console.error('[frpc-daemon] failed to start:', err);
  }
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
