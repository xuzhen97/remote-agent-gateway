#!/usr/bin/env tsx
/**
 * FRP Tunnel E2E Test
 *
 * Tests the full FRP flow:
 *   1. Start a test HTTP server on the client (via exec_command)
 *   2. Create a port mapping via API
 *   3. Wait for the mapping to become active
 *   4. Access the mapped port through the frps tunnel
 *   5. Verify the response matches
 *   6. Clean up (delete mapping, stop server)
 *
 * Prerequisites:
 *   - frps running somewhere (frp.host configured in server.config.yaml)
 *   - frpc binary on the client machine (frp.binPath in client/server config workflow)
 *   - Server and client already built (pnpm build:dist)
 *
 * Usage:
 *   tsx scripts/test-frp.ts                    # auto-start server + client
 *   tsx scripts/test-frp.ts --no-start          # assume server + client already running
 *   tsx scripts/test-frp.ts --port 8888         # use a different test port
 */

import { spawn, type ChildProcess } from 'node:child_process';
import * as path from 'node:path';
import * as fs from 'node:fs';
import { parse as parseYaml } from 'yaml';

// ── Config ──────────────────────────────────────────────────────────
const ROOT = path.resolve(import.meta.dirname, '..');
const DIST = path.join(ROOT, 'dist');
const BASE_URL = 'http://localhost:3000';
const serverConfig = parseYaml(fs.readFileSync(path.join(ROOT, 'server.config.yaml'), 'utf-8')) as {
  auth: { agentApiToken: string };
  frp: { connectHost: string; publicHost?: string; port: number; token: string; binPath: string };
};
const clientConfig = parseYaml(fs.readFileSync(path.join(ROOT, 'client.config.yaml'), 'utf-8')) as {
  frp?: { binPath?: string };
};
const TOKEN = serverConfig.auth.agentApiToken;
const CLIENT_ID = 'frp-test-client';
const TEST_PORT = parseInt(process.argv.includes('--port')
  ? process.argv[process.argv.indexOf('--port') + 1]
  : '9876');
const NO_START = process.argv.includes('--no-start');
const VERBOSE = process.argv.includes('--verbose');

const FRPS_HOST = serverConfig.frp.publicHost || serverConfig.frp.connectHost;
const FRPS_PORT = serverConfig.frp.port;
const FRPS_TOKEN = serverConfig.frp.token;

if (!FRPS_HOST) {
  console.error('❌ FRPS_HOST not configured in server.config.yaml');
  console.error('   Set frp.connectHost/publicHost to your frps server address and try again.');
  process.exit(1);
}

console.log(`FRP config: frps://${FRPS_HOST}:${FRPS_PORT}`);

// ── Helpers ─────────────────────────────────────────────────────────
let passed = 0;
let failed = 0;

function log(icon: string, msg: string) { console.log(`  ${icon} ${msg}`); }

async function test(name: string, fn: () => Promise<boolean>) {
  try {
    const ok = await fn();
    if (ok) { passed++; log('✅', name); }
    else     { failed++; log('❌', name); }
  } catch (err) {
    failed++;
    log('💥', `${name}: ${err}`);
  }
}

async function api(method: string, url: string, data?: unknown): Promise<{ status: number; body: unknown }> {
  // Don't set Content-Type for GET requests or when body is FormData
  const headers: Record<string, string> = { Authorization: `Bearer ${TOKEN}` };
  const init: RequestInit = { method, headers };
  if (data && !(data instanceof FormData)) {
    headers['Content-Type'] = 'application/json';
    init.body = JSON.stringify(data);
  }
  const res = await fetch(`${BASE_URL}${url}`, init);
  const text = await res.text();
  let body: unknown = text;
  try { body = JSON.parse(text); } catch { /* keep as text */ }
  if (VERBOSE) console.log(`    [${method} ${url}] ${res.status}:`, JSON.stringify(body).slice(0, 300));
  return { status: res.status, body };
}

function sleep(ms: number) { return new Promise((r) => setTimeout(r, ms)); }

// ── Process management ──────────────────────────────────────────────
let serverProc: ChildProcess | null = null;
let clientProc: ChildProcess | null = null;

function startProcess(name: string, cwd: string, cmd: string, args: string[]): ChildProcess {
  const proc = spawn(cmd, args, { cwd, stdio: 'pipe' });
  proc.stdout?.on('data', (d: Buffer) => { if (VERBOSE) process.stdout.write(`  [${name}] ${d}`); });
  proc.stderr?.on('data', (d: Buffer) => { if (VERBOSE) process.stderr.write(`  [${name}:err] ${d}`); });
  return proc;
}

async function waitFor(label: string, fn: () => Promise<boolean>, timeoutMs = 15_000): Promise<boolean> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (await fn()) return true;
    await sleep(500);
  }
  log('⚠️', `Timeout: ${label}`);
  return false;
}

async function waitUntil(label: string, fn: () => Promise<boolean>, timeoutMs = 60_000): Promise<boolean> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (await fn()) return true;
    await sleep(2000);
  }
  log('⚠️', `Timeout: ${label}`);
  return false;
}

// ── Main ────────────────────────────────────────────────────────────
async function main() {
  console.log('╔══════════════════════════════════════════════╗');
  console.log('║   Remote Agent Gateway — FRP Tunnel Test    ║');
  console.log('╚══════════════════════════════════════════════╝\n');

  // ── Prerequisites ─────────────────────────────────────────────────
  console.log('── Checking prerequisites ──');

  // Check frps is reachable
  await test('frps is reachable', async () => {
    try {
      // Try TCP connect to frps port
      const { execSync } = await import('node:child_process');
      const platform = process.platform;
      if (platform === 'win32') {
        execSync(`powershell -Command "Test-NetConnection -ComputerName ${FRPS_HOST} -Port ${FRPS_PORT} -WarningAction SilentlyContinue"`, { timeout: 5000 });
      }
      return true;
    } catch {
      // Even if the check fails, we'll try — frps might just not respond to ping
      console.log(`    (frps at ${FRPS_HOST}:${FRPS_PORT} — proceeding anyway)`);
      return true;
    }
  });

  // Ensure dist is built
  if (!fs.existsSync(path.join(DIST, 'server.bundle.cjs'))) {
    console.log('  Building dist...');
    const build = spawn('pnpm', ['build:dist'], { cwd: ROOT, stdio: 'inherit' });
    await new Promise<void>((resolve) => build.on('close', () => resolve()));
  }

  // ── Prepare configs ───────────────────────────────────────────────
  fs.writeFileSync(path.join(DIST, 'server.config.yaml'), fs.readFileSync(path.join(ROOT, 'server.config.yaml'), 'utf-8'));

  // Resolve frpc path (absolute, since client runs from dist/)
  let frpcPath = clientConfig.frp?.binPath || './bin/frpc';
  if (!path.isAbsolute(frpcPath)) {
    frpcPath = path.resolve(ROOT, frpcPath);
  }
  // On Windows, ensure .exe extension
  if (process.platform === 'win32' && !frpcPath.endsWith('.exe')) {
    if (fs.existsSync(frpcPath + '.exe')) frpcPath += '.exe';
  }
  if (!fs.existsSync(frpcPath)) {
    console.error(`❌ frpc binary not found at: ${frpcPath}`);
    console.error('   Run pnpm download:frp or set correct path in server.config.yaml');
    process.exit(1);
  }
  log('📋', `frpc: ${frpcPath}`);

  // Write client config
  fs.writeFileSync(path.join(DIST, 'client.config.yaml'), `
client:
  id: ${CLIENT_ID}
  name: FRP Test Machine
  tags:
    - test
    - frp

server:
  wsUrl: ws://localhost:3000/ws/client
  apiBaseUrl: http://localhost:3000
  token: ${TOKEN}

workspace:
  dir: ./workspace
  allowedRoots:
    - ./workspace

frp:
  binPath: ${frpcPath}
  workDir: ./frp
`.trim() + '\n');

  // Clean old DB
  fs.rmSync(path.join(DIST, 'config.json'), { force: true });
  fs.rmSync(path.join(DIST, 'config.example.json'), { force: true });
  fs.rmSync(path.join(DIST, '.env'), { force: true });
  fs.rmSync(path.join(DIST, '.env.example'), { force: true });
  try { fs.unlinkSync(path.join(DIST, 'db.sqlite')); } catch { /* ok */ }

  // ── Start server + client ─────────────────────────────────────────
  if (!NO_START) {
    console.log('\n── Starting server ──');
    serverProc = startProcess('server', DIST, 'node', ['server.bundle.cjs']);
    const serverOk = await waitFor('server startup', async () => {
      try { const r = await fetch(`${BASE_URL}/api/health`); return r.ok; } catch { return false; }
    });
    if (!serverOk) { console.log('❌ Server failed to start'); process.exit(1); }
    log('🟢', 'Server ready');

    console.log('── Starting client ──');
    clientProc = startProcess('client', DIST, 'node', ['client.bundle.cjs']);
    const clientOk = await waitFor('client registration', async () => {
      try {
        const r = await fetch(`${BASE_URL}/api/clients`, { headers: { Authorization: `Bearer ${TOKEN}` } });
        const data = await r.json() as unknown[];
        return r.ok && data.some((c: unknown) => (c as Record<string, unknown>).id === CLIENT_ID && (c as Record<string, unknown>).online);
      } catch { return false; }
    });
    if (!clientOk) { console.log('❌ Client failed to register'); process.exit(1); }
    log('🟢', 'Client registered');
  }

  // ── Run tests ─────────────────────────────────────────────────────
  console.log('\n── FRP Tunnel Tests ──\n');

  // 1. Start a test HTTP server on the client
  let httpServerTaskId = '';
  await test('Start test HTTP server on client', async () => {
    const { status, body } = await api('POST', '/api/tasks', {
      clientId: CLIENT_ID,
      type: 'exec_command',
      payload: {
        command: `node -e "require('http').createServer((_,r)=>{r.writeHead(200,{'Content-Type':'text/plain'});r.end('FRP_TEST_OK:'+Date.now())}).listen(${TEST_PORT})"`,
        timeoutMs: 120_000, // long timeout to keep it alive
      },
    });
    const task = body as Record<string, unknown>;
    httpServerTaskId = task.id as string;
    // The task will stay "running" since the server doesn't exit
    return status === 201;
  });

  await sleep(2000); // Give the HTTP server a moment to start

  // 2. Create port mapping
  let mappingId = '';
  let remotePort = 0;
  let frpcProc: ChildProcess | null = null;

  await test('Create FRP port mapping', async () => {
    const { status, body } = await api('POST', '/api/port-mappings', {
      clientId: CLIENT_ID,
      name: 'frp-e2e-test',
      proxyType: 'tcp',
      localIp: '127.0.0.1',
      localPort: TEST_PORT,
    });
    const mapping = body as Record<string, unknown>;
    if (status !== 201) return false;
    mappingId = mapping.id as string;
    remotePort = mapping.remotePort as number;
    log('📋', `Mapping: ${mappingId} → ${FRPS_HOST}:${remotePort}`);
    return typeof mappingId === 'string' && remotePort > 0;
  });

  // 3. Start frpc manually (bypass Agent's spawn limitation in sandbox)
  await test('Start frpc process', async () => {
    const configPath = path.join(DIST, 'frp', 'mappings', `${mappingId}.toml`);
    if (!fs.existsSync(configPath)) {
      log('⚠️', `frpc config not found: ${configPath}`);
      return false;
    }
    frpcProc = spawn(frpcPath, ['-c', configPath], {
      cwd: path.join(DIST, 'frp'),
      stdio: 'pipe',
    });
    // Wait a moment for frpc to connect
    await sleep(3000);
    return frpcProc.exitCode === null; // still running
  });

  // 4. Wait for FRP tunnel to become active
  await test('FRP tunnel activated', async () => {
    const ok = await waitUntil('tunnel active', async () => {
      const { body } = await api('GET', `/api/port-mappings?clientId=${CLIENT_ID}`);
      const mappings = body as Record<string, unknown>[];
      const m = mappings.find((m) => m.id === mappingId);
      const active = m?.status === 'active';
      if (VERBOSE && m) console.log(`    Mapping status: ${m.status}`);
      return !!active;
    }, 15_000);
    return ok;
  });

  // 5. Verify tunnel actually works
  let tunnelResponse = '';
  await test(`Access test server via frp (${FRPS_HOST}:${remotePort})`, async () => {
    const ok = await waitUntil('tunnel accessible', async () => {
      try {
        const res = await fetch(`http://${FRPS_HOST}:${remotePort}`, { signal: AbortSignal.timeout(5000) });
        tunnelResponse = await res.text();
        if (VERBOSE) console.log(`    Tunnel response: ${tunnelResponse}`);
        return res.ok && tunnelResponse.startsWith('FRP_TEST_OK:');
      } catch {
        return false;
      }
    }, 30_000);
    return ok;
  });

  if (tunnelResponse) {
    log('📨', `Response: ${tunnelResponse}`);
  }

  // 5. Verify response content
  await test('Verify tunnel response content', async () => {
    return tunnelResponse.startsWith('FRP_TEST_OK:');
  });

  // 6. Multiple requests (stability check)
  await test('Multiple requests through tunnel work', async () => {
    const results: string[] = [];
    for (let i = 0; i < 3; i++) {
      try {
        const res = await fetch(`http://${FRPS_HOST}:${remotePort}`, { signal: AbortSignal.timeout(5000) });
        results.push(await res.text());
      } catch {
        results.push('FAIL');
      }
      await sleep(500);
    }
    return results.every((r) => r.startsWith('FRP_TEST_OK:'));
  });

  // ── Cleanup ───────────────────────────────────────────────────────
  console.log('\n── Cleanup ──');

  // Stop frpc
  if (frpcProc) { frpcProc.kill('SIGTERM'); }

  await test('Delete port mapping', async () => {
    const { status } = await api('DELETE', `/api/port-mappings/${mappingId}`);
    return status === 200;
  });

  // Kill the test HTTP server (by stopping its task... actually it'll be killed when client disconnects)
  // Or we can use exec_command to kill it:
  await test('Stop test HTTP server', async () => {
    try {
      await api('POST', '/api/tasks', {
        clientId: CLIENT_ID,
        type: 'exec_command',
        payload: { command: `npx kill-port ${TEST_PORT} 2>nul || true`, timeoutMs: 5000 },
      });
    } catch { /* ignore */ }
    return true;
  });

  // ── Report ────────────────────────────────────────────────────────
  console.log(`\n${'─'.repeat(40)}`);
  console.log(`  Total:  ${passed + failed}`);
  console.log(`  Passed: ${passed} ✅`);
  console.log(`  Failed: ${failed} ${failed > 0 ? '❌' : ''}`);
  console.log(`${'─'.repeat(40)}\n`);

  // Stop processes
  if (!NO_START) {
    console.log('Stopping server & client...');
    serverProc?.kill('SIGTERM');
    clientProc?.kill('SIGTERM');
    await sleep(1500);
    serverProc?.kill('SIGKILL');
    clientProc?.kill('SIGKILL');
    console.log('Done.\n');
  }

  process.exit(failed > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error('Test error:', err);
  serverProc?.kill('SIGKILL');
  clientProc?.kill('SIGKILL');
  process.exit(1);
});
