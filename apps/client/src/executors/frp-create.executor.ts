import * as path from 'node:path';
import * as fs from 'node:fs';
import { spawn } from 'node:child_process';
import type { ConnectionManager } from '../core/connection.js';
import type { ClientConfig } from '../config/client.config.js';
import type { FrpCreateProxyPayload } from '@rag/shared';

interface FrpProcess {
  pid: number;
  mappingId: string;
}

const runningProcesses = new Map<string, FrpProcess>();

export async function executeFrpCreate(
  conn: ConnectionManager,
  config: ClientConfig,
  taskId: string,
  payload: FrpCreateProxyPayload,
): Promise<unknown> {
  if (!config.frpcPath) {
    throw new Error('frpcPath not configured');
  }

  const { mappingId, name, proxyType, localIp, localPort, remotePort, customDomain } = payload;
  const frpcWorkDir = config.frpcWorkDir ?? path.join(config.workspaceDir, 'frp');

  // Generate frpc config
  const configContent = generateFrpcConfig({
    serverAddr: new URL(config.apiBaseUrl).hostname,
    serverPort: 7000,
    authToken: config.token,
    name,
    proxyType,
    localIp,
    localPort,
    remotePort,
    customDomain,
  });

  // Ensure directories exist
  const mappingsDir = path.join(frpcWorkDir, 'mappings');
  const pidsDir = path.join(frpcWorkDir, 'pids');
  fs.mkdirSync(mappingsDir, { recursive: true });
  fs.mkdirSync(pidsDir, { recursive: true });

  // Write config file
  const configPath = path.join(mappingsDir, `${mappingId}.toml`);
  fs.writeFileSync(configPath, configContent);

  conn.send({
    type: 'task.log',
    payload: { taskId, stream: 'stdout', content: `Starting frpc for mapping ${mappingId}\n` },
  });

  // Start frpc
  const child = spawn(config.frpcPath, ['-c', configPath], {
    cwd: frpcWorkDir,
    detached: false,
  });

  // Write PID file
  fs.writeFileSync(path.join(pidsDir, `${mappingId}.pid`), String(child.pid ?? 0));

  runningProcesses.set(mappingId, { pid: child.pid ?? 0, mappingId });

  child.stdout?.on('data', (data: Buffer) => {
    conn.send({
      type: 'task.log',
      payload: { taskId, stream: 'stdout', content: `[frpc] ${data.toString()}` },
    });
  });

  child.stderr?.on('data', (data: Buffer) => {
    conn.send({
      type: 'task.log',
      payload: { taskId, stream: 'stderr', content: `[frpc] ${data.toString()}` },
    });
  });

  child.on('error', (err) => {
    conn.send({
      type: 'task.log',
      payload: { taskId, stream: 'stderr', content: `frpc error: ${err.message}\n` },
    });
  });

  return { mappingId, configPath, pid: child.pid };
}

function generateFrpcConfig(params: {
  serverAddr: string;
  serverPort: number;
  authToken: string;
  name: string;
  proxyType: string;
  localIp: string;
  localPort: number;
  remotePort: number;
  customDomain?: string;
}): string {
  const lines = [
    `serverAddr = "${params.serverAddr}"`,
    `serverPort = ${params.serverPort}`,
    '',
    'auth.method = "token"',
    `auth.token = "${params.authToken}"`,
    '',
    '[[proxies]]',
    `name = "${params.name}"`,
    `type = "${params.proxyType}"`,
    `localIP = "${params.localIp}"`,
    `localPort = ${params.localPort}`,
    `remotePort = ${params.remotePort}`,
  ];

  if (params.customDomain) {
    lines.push(`customDomains = ["${params.customDomain}"]`);
  }

  return lines.join('\n') + '\n';
}

export { runningProcesses };
