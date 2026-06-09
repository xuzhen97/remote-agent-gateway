/** @file FRP 客户端守护进程
 *
 * 管理单个 frpc 进程，该进程包含所有端口映射。
 *
 * 工作流程：
 * 1. 客户端收到服务端 ACK 后，调用 startFrpcDaemon() 启动保护隧道
 * 2. 用户创建/删除业务映射时，调用 rebuildFrpcDaemon() 重新生成合并配置
 * 3. frpc 启动后持续运行，处理所有代理连接
 *
 * 文件布局：
 * - frpc-combined.toml: 合并后的完整 frpc 配置
 * - mappings/xxx.toml: 每个业务映射一个 .toml 文件
 * - frp-mappings.json: 映射元数据存储（JSON 格式）
 * - frpc-daemon.pid: PID 文件，用于清理孤儿进程
 */
import { execFileSync, spawn, type ChildProcess } from 'node:child_process';
import * as path from 'node:path';
import * as fs from 'node:fs';
import type { ClientConfig } from '../config/client.config.js';

/** 当前 frpc 守护进程实例 */
let daemonProcess: ChildProcess | null = null;
/** 最后收到的 FRPS 连接信息 */
let lastFrpsInfo: { serverAddr: string; serverPort: number; authToken: string } | null = null;
/** 最后设置的保护隧道（不会被用户通过 API 删除） */
let lastProtectedProxy: FrpcProxyConfig | undefined;
/** PID 文件名 */
const PID_FILE_NAME = 'frpc-daemon.pid';

/** FRPC 代理配置接口 */
export interface FrpcProxyConfig {
  /** 代理名称 */
  name: string;
  /** 代理类型 */
  type: 'tcp' | 'http' | 'https';
  /** 本地 IP */
  localIP: string;
  /** 本地端口 */
  localPort: number;
  /** 远程端口（仅 TCP 类型需要） */
  remotePort?: number;
  /** 自定义域名列表 */
  customDomains?: string[];
  /** 子域名 */
  subdomain?: string;
  /** 是否受保护（不可被用户 API 删除） */
  protected?: boolean;
}

/** 设置 FRPS 连接信息（从服务端 ACK 中获取） */
export function setFrpsInfo(info: { serverAddr: string; serverPort: number; authToken: string }): void {
  lastFrpsInfo = info;
}

/** 获取 FRPS 连接信息（如果未初始化则报错） */
function getFrpsInfo() {
  if (lastFrpsInfo) return lastFrpsInfo;
  throw new Error('FRP 连接信息未初始化');
}

/** 启动 frpc 守护进程 */
export function startFrpcDaemon(config: ClientConfig, protectedProxy?: FrpcProxyConfig): void {
  rebuildFrpcDaemon(config, protectedProxy);
}

/** 停止 frpc 守护进程 */
export function stopFrpcDaemon(): void {
  if (daemonProcess) {
    terminateTrackedDaemonProcess(daemonProcess);
    daemonProcess = null;
    console.log('[frpc-daemon] 已停止');
    return;
  }
}

/** 检查 frpc 是否正在运行 */
export function isFrpcRunning(): boolean {
  return daemonProcess !== null && daemonProcess.exitCode === null;
}

/**
 * 重建 frpc 守护进程
 * 读取所有保存的映射配置，生成合并的 frpc 配置，重启 frpc
 */
export function rebuildFrpcDaemon(config: ClientConfig, protectedProxy?: FrpcProxyConfig): { proxyCount: number } | null {
  const frps = getFrpsInfo();
  const workDir = path.resolve(config.frpcWorkDir ?? path.join(config.workspaceDir, 'frp'));
  fs.mkdirSync(workDir, { recursive: true });
  const configPath = path.join(workDir, 'frpc-combined.toml');
  cleanupOrphanFrpcProcess(workDir, configPath, daemonProcess?.pid);

  // ======== 收集所有代理配置 ========
  const mappingsDir = path.join(workDir, 'mappings');
  const proxies: string[] = [];

  // 保护隧道总是排在最前面
  const effectiveProtected = protectedProxy ?? lastProtectedProxy;
  if (effectiveProtected) {
    proxies.unshift(serializeProxy(effectiveProtected));
    lastProtectedProxy = effectiveProtected;
  }

  fs.mkdirSync(mappingsDir, { recursive: true });

  // 与 JSON 存储同步：删除不匹配的 .toml 文件
  syncMappingsFromStore(workDir, mappingsDir);

  // 清理旧格式的完整配置文件
  if (fs.existsSync(mappingsDir)) {
    for (const file of fs.readdirSync(mappingsDir)) {
      if (!file.endsWith('.toml')) continue;
      const content = fs.readFileSync(path.join(mappingsDir, file), 'utf-8');
      if (content.includes('serverAddr')) {
        console.log(`[frpc-daemon] 删除旧格式配置: ${file}`);
        try { fs.unlinkSync(path.join(mappingsDir, file)); } catch { /* 忽略 */ }
      }
    }
  }

  // 读取所有业务映射的 .toml 文件
  if (fs.existsSync(mappingsDir)) {
    for (const file of fs.readdirSync(mappingsDir)) {
      if (!file.endsWith('.toml')) continue;
      const content = fs.readFileSync(path.join(mappingsDir, file), 'utf-8').trim();
      if (!content) continue;
      // 跳过旧格式文件
      if (content.includes('serverAddr') || content.includes('auth.token')) {
        console.log(`[frpc-daemon] 跳过旧格式配置: ${file}`);
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

  // ======== 重启 frpc ========
  // 先杀掉现有进程
  if (daemonProcess) {
    terminateTrackedDaemonProcess(daemonProcess);
    daemonProcess = null;
  }

  if (proxies.length === 0) {
    console.log('[frpc-daemon] 没有代理，跳过启动');
    writeDaemonConfig(workDir, frps, []);  // 写入空配置以备手动启动
    return null;
  }

  // 写入合并后的配置
  writeDaemonConfig(workDir, frps, proxies);

  // 启动 frpc
  try {
    daemonProcess = spawn(config.frpcPath!, ['-c', configPath], {
      cwd: workDir,
      stdio: 'pipe',
    });

    if (typeof daemonProcess.pid === 'number') {
      writePidFile(workDir, daemonProcess.pid);
    }

    const trackedProcess = daemonProcess;

    daemonProcess.stderr?.on('data', (d: Buffer) => {
      const msg = d.toString().trim();
      if (msg) console.log(`[frpc-daemon] ${msg}`);
    });

    daemonProcess.on('error', (err) => {
      console.error(`[frpc-daemon] 错误: ${err.message}`);
      if (daemonProcess === trackedProcess) {
        removePidFile(workDir);
        daemonProcess = null;
      }
    });

    daemonProcess.on('exit', (code) => {
      console.log(`[frpc-daemon] 已退出 (code ${code})`);
      if (daemonProcess === trackedProcess) {
        removePidFile(workDir);
        daemonProcess = null;
      }
    });

    console.log(`[frpc-daemon] 已启动，${proxies.length} 个代理 → ${frps.serverAddr}:${frps.serverPort}`);
    return { proxyCount: proxies.length };
  } catch (err) {
    console.error('[frpc-daemon] 启动失败:', err);
    return null;
  }
}

/** 终止受追踪的 frpc 进程（先 SIGTERM，再 SIGKILL） */
function terminateTrackedDaemonProcess(proc: ChildProcess): void {
  const pid = proc.pid;
  try {
    proc.kill('SIGTERM');
  } catch {
    return;
  }

  if (typeof pid !== 'number' || pid <= 0) {
    return;
  }

  try {
    process.kill(pid, 0);  // 检查进程是否存活
    process.kill(pid, 'SIGKILL');  // 强制杀掉
    console.log(`[frpc-daemon] 强制终止追踪进程 ${pid}`);
  } catch {
    // 进程已退出
  }
}

/**
 * 与 JSON 映射存储同步
 * 删除 JSON store 中不存在的 .toml 文件，
 * 为每个业务映射写入新的 .toml 文件。
 */
function syncMappingsFromStore(workDir: string, mappingsDir: string): void {
  const storePath = path.join(workDir, 'frp-mappings.json');
  if (!fs.existsSync(storePath)) {
    // 没有 JSON store，删除所有 .toml 文件
    for (const file of fs.readdirSync(mappingsDir)) {
      if (!file.endsWith('.toml')) continue;
      console.log(`[frpc-daemon] 删除无存储的过期映射文件: ${file}`);
      try { fs.unlinkSync(path.join(mappingsDir, file)); } catch { /* 忽略 */ }
    }
    return;
  }

  let store: { id: string; name: string; type: string; localHost: string; localPort: number; remotePort?: number; customDomain?: string }[] = [];
  try {
    store = JSON.parse(fs.readFileSync(storePath, 'utf-8'));
  } catch {
    return;
  }

  const validIds = new Set(store.map((mapping) => mapping.id));

  // 删除 JSON store 中没有对应记录的 .toml 文件
  for (const file of fs.readdirSync(mappingsDir)) {
    if (!file.endsWith('.toml')) continue;
    const mappingId = file.replace(/\.toml$/, '');
    if (!validIds.has(mappingId)) {
      console.log(`[frpc-daemon] 删除过期映射文件: ${file}`);
      try { fs.unlinkSync(path.join(mappingsDir, file)); } catch { /* 忽略 */ }
    }
  }

  // 为每个业务映射写入新的 .toml 文件
  for (const mapping of store) {
    const filePath = path.join(mappingsDir, `${mapping.id}.toml`);
    const lines = [
      `name = "${mapping.name}"`,
      `type = "${mapping.type}"`,
      `localIP = "${mapping.localHost}"`,
      `localPort = ${mapping.localPort}`,
    ];
    if (typeof mapping.remotePort === 'number' && mapping.type === 'tcp') {
      lines.push(`remotePort = ${mapping.remotePort}`);
    }
    if (mapping.customDomain) {
      lines.push(`customDomains = ["${mapping.customDomain}"]`);
    }
    fs.writeFileSync(filePath, lines.join('\n') + '\n');
  }
}

/** 将 FrpcProxyConfig 序列化为 TOML 格式的 [[proxies]] 块 */
function serializeProxy(proxy: FrpcProxyConfig): string {
  const lines = [
    '[[proxies]]',
    `name = "${proxy.name}"`,
    `type = "${proxy.type}"`,
    `localIP = "${proxy.localIP}"`,
    `localPort = ${proxy.localPort}`,
  ];
  if (typeof proxy.remotePort === 'number' && proxy.type === 'tcp') {
    lines.push(`remotePort = ${proxy.remotePort}`);
  }
  if (proxy.customDomains?.length) {
    lines.push(`customDomains = ${JSON.stringify(proxy.customDomains)}`);
  }
  if (proxy.subdomain) {
    lines.push(`subdomain = "${proxy.subdomain}"`);
  }
  return lines.join('\n');
}

/**
 * 规范化代理配置内容
 * HTTP/HTTPS 类型必须包含 customDomains 或 subdomain，否则无效
 */
function normalizeProxyContent(content: string, file: string): string | null {
  const typeMatch = content.match(/^\s*type\s*=\s*"([^"]+)"/m);
  const proxyType = typeMatch?.[1];

  if (proxyType === 'http' || proxyType === 'https') {
    const hasDomainRoute = /^\s*(customDomains|subdomain)\s*=/m.test(content);
    if (!hasDomainRoute) {
      console.log(`[frpc-daemon] 丢弃无效的 ${proxyType} 代理配置（缺少域名路由）: ${file}`);
      return null;
    }
    return content.replace(/^\s*remotePort\s*=.*(?:\r?\n)?/gm, '').trim();
  }

  return content;
}

/** 获取 PID 文件路径 */
function getPidFilePath(workDir: string): string {
  return path.join(workDir, PID_FILE_NAME);
}

/** 写入 PID 文件 */
function writePidFile(workDir: string, pid: number): void {
  fs.writeFileSync(getPidFilePath(workDir), String(pid));
}

/** 删除 PID 文件 */
function removePidFile(workDir: string): void {
  try { fs.unlinkSync(getPidFilePath(workDir)); } catch { /* 忽略 */ }
}

/** 清理孤儿 frpc 进程（基于 PID 文件和命令行匹配） */
function cleanupOrphanFrpcProcess(workDir: string, configPath: string, trackedPid?: number): void {
  cleanupFrpcProcessesUsingConfig(configPath, trackedPid);
  const pidFile = getPidFilePath(workDir);
  if (!fs.existsSync(pidFile)) return;

  const raw = fs.readFileSync(pidFile, 'utf-8').trim();
  const pid = Number(raw);
  if (!Number.isFinite(pid) || pid <= 0 || pid === trackedPid) {
    removePidFile(workDir);
    return;
  }

  try {
    process.kill(pid, 'SIGTERM');
    console.log(`[frpc-daemon] 已清理孤儿进程 ${pid}`);
  } catch {
    // PID 文件已过期
  }
  removePidFile(workDir);
}

/** 通过 WMIC 查找使用同一配置文件的 frpc 进程并清理 */
function cleanupFrpcProcessesUsingConfig(configPath: string, trackedPid?: number): void {
  const normalizedConfig = normalizePathForCompare(configPath);

  try {
    const rawOutput = execFileSync('wmic', ['process', 'where', "name='frpc.exe'", 'get', 'ProcessId,CommandLine', '/format:csv'], { encoding: 'utf-8' });
    const output = String(rawOutput);
    for (const line of output.split(/\r?\n/)) {
      const processInfo = parseWmicProcessLine(line);
      if (!processInfo) continue;
      const { commandLine, pid } = processInfo;
      if (pid === process.pid || pid === trackedPid) continue;
      if (!normalizePathForCompare(commandLine).includes(normalizedConfig)) continue;
      try {
        process.kill(pid, 'SIGTERM');
        console.log(`[frpc-daemon] 已清理使用 ${configPath} 的孤儿进程 ${pid}`);
      } catch {
        // 忽略权限或进程不存在错误
      }
    }
  } catch {
    // WMIC 可能不可用；PID 文件清理仍然有效
  }
}

/** 解析 WMIC CSV 输出中的进程行 */
function parseWmicProcessLine(line: string): { commandLine: string; pid: number } | null {
  if (!line.trim() || line.startsWith('Node,')) return null;
  const match = line.match(/^(.*),(\d+)$/);
  if (!match) return null;
  const pid = Number(match[2]);
  if (!Number.isFinite(pid) || pid <= 0) return null;
  return { commandLine: match[1], pid };
}

/** 规范化路径用于比较（去斜杠、去引号、转小写） */
function normalizePathForCompare(value: string): string {
  return value.replace(/\\/g, '/').replace(/"/g, '').toLowerCase();
}

/** 写入 daemon 配置文件 */
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
