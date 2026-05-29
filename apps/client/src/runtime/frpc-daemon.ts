/**
 * FRP Client Daemon — manages frpc lifecycle.
 *
 * Started/stopped via frpc_start / frpc_stop tasks from the server.
 * FRP connection info (serverAddr, serverPort, authToken) is:
 *  1. Extracted from the last frp_create_proxy task payload
 *  2. Fallback: inferred from apiBaseUrl
 */
import { spawn, type ChildProcess } from 'node:child_process';
import * as path from 'node:path';
import * as fs from 'node:fs';
import type { ClientConfig } from '../config/client.config.js';

let daemonProcess: ChildProcess | null = null;

/** Last known frps connection info (updated by frp_create_proxy executor) */
let lastFrpsInfo: { serverAddr: string; serverPort: number; authToken: string } | null = null;

export function setFrpsInfo(info: { serverAddr: string; serverPort: number; authToken: string }): void {
  lastFrpsInfo = info;
}

function getFrpsInfo(config: ClientConfig) {
  if (lastFrpsInfo) return lastFrpsInfo;
  // Fallback: assume frps is on the same host as the server
  return {
    serverAddr: new URL(config.apiBaseUrl).hostname,
    serverPort: 7000,
    authToken: config.token,
  };
}

export function startFrpcDaemon(config: ClientConfig): void {
  if (!config.frpcPath) return;
  if (daemonProcess && daemonProcess.exitCode === null) return; // already running

  const frps = getFrpsInfo(config);
  const workDir = path.resolve(config.frpcWorkDir ?? path.join(config.workspaceDir, 'frp'));
  fs.mkdirSync(workDir, { recursive: true });

  const daemonConfigPath = path.resolve(workDir, 'frpc-daemon.toml');
  fs.writeFileSync(daemonConfigPath, [
    `serverAddr = "${frps.serverAddr}"`,
    `serverPort = ${frps.serverPort}`,
    '',
    'auth.method = "token"',
    `auth.token = "${frps.authToken}"`,
  ].join('\n'));

  console.log(`[frpc-daemon] config: ${daemonConfigPath}`);

  try {
    daemonProcess = spawn(config.frpcPath, ['-c', daemonConfigPath], {
      cwd: workDir,
      stdio: 'pipe',
    });

    daemonProcess.stderr?.on('data', (d: Buffer) => {
      console.error(`[frpc-daemon] ${d.toString().trim()}`);
    });

    daemonProcess.on('error', (err) => {
      console.error(`[frpc-daemon] error: ${err.message}`);
      daemonProcess = null;
    });

    daemonProcess.on('exit', (code) => {
      console.log(`[frpc-daemon] exited with code ${code}`);
      daemonProcess = null;
    });

    console.log(`[frpc-daemon] started (PID ${daemonProcess.pid}) → ${frps.serverAddr}:${frps.serverPort}`);
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
