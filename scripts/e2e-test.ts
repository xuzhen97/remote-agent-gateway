#!/usr/bin/env tsx
/**
 * E2E Test Suite — Remote Agent Gateway
 *
 * Starts server + client, runs all API tests, reports results, cleans up.
 *
 * Usage:
 *   tsx scripts/e2e-test.ts              # run all tests
 *   tsx scripts/e2e-test.ts --keep       # keep server/client running after tests
 *   tsx scripts/e2e-test.ts --verbose    # show full response bodies
 *
 * Prerequisites:
 *   - dist/ built (pnpm build:dist)
 *   - Node.js 22+
 */

import { spawn, type ChildProcess } from 'node:child_process';
import * as path from 'node:path';
import * as fs from 'node:fs';

// ── Config ──────────────────────────────────────────────────────────
const ROOT = path.resolve(import.meta.dirname, '..');
const DIST = path.join(ROOT, 'dist');
const BASE_URL = 'http://localhost:3000';
const TOKEN = 'test_agent_token';
const CLIENT_ID = 'e2e-test-client';

const KEEP_ALIVE = process.argv.includes('--keep');
const VERBOSE = process.argv.includes('--verbose');

// ── Helpers ─────────────────────────────────────────────────────────
let passed = 0;
let failed = 0;

function log(icon: string, label: string, detail?: string) {
  const line = detail ? `${icon} ${label}: ${detail}` : `${icon} ${label}`;
  console.log(`  ${line}`);
}

async function test(name: string, fn: () => Promise<boolean>) {
  try {
    const ok = await fn();
    if (ok) { passed++; log('✅', name); }
    else     { failed++; log('❌', name, 'assertion failed'); }
  } catch (err) {
    failed++;
    log('💥', name, String(err));
  }
}

async function api(method: string, url: string, init?: RequestInit): Promise<{ status: number; body: unknown }> {
  const hasBody = !!init?.body;
  const customHeaders = init?.headers ? { ...init.headers } : {};
  // Build headers: always include auth, add Content-Type for JSON bodies
  const headers: Record<string, string> = { Authorization: `Bearer ${TOKEN}` };
  if (!init?.headers && hasBody) {
    headers['Content-Type'] = 'application/json';
  }
  // Merge custom headers (except we keep our Authorization)
  Object.assign(headers, customHeaders);

  const res = await fetch(url, {
    method,
    headers,
    body: init?.body,
  });
  const text = await res.text();
  let body: unknown = text;
  try { body = JSON.parse(text); } catch { /* keep as text */ }
  if (VERBOSE) console.log(`    [${method} ${url}] ${res.status}:`, JSON.stringify(body).slice(0, 200));
  return { status: res.status, body };
}

async function apiJson(method: string, url: string, data?: unknown) {
  return api(method, url, data ? { body: JSON.stringify(data) } : undefined);
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

async function waitFor(fn: () => Promise<boolean>, timeoutMs = 15_000, label = ''): Promise<boolean> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (await fn()) return true;
    await sleep(500);
  }
  log('⚠️', `Timeout waiting: ${label}`);
  return false;
}

// ── Main ────────────────────────────────────────────────────────────
async function main() {
  console.log('╔══════════════════════════════════════════╗');
  console.log('║  Remote Agent Gateway — E2E Test Suite  ║');
  console.log('╚══════════════════════════════════════════╝\n');

  // Ensure dist is built
  if (!fs.existsSync(path.join(DIST, 'server.bundle.cjs'))) {
    console.log('Building dist...');
    const build = spawn('pnpm', ['build:dist'], { cwd: ROOT, stdio: 'inherit' });
    await new Promise<void>((resolve) => build.on('close', () => resolve()));
  }

  // Prepare configs
  fs.writeFileSync(path.join(DIST, '.env'), [
    'SERVER_PORT=3000', 'SERVER_HOST=0.0.0.0',
    'ADMIN_TOKEN=test_admin_token', 'AGENT_API_TOKEN=test_agent_token',
    'FRP_TOKEN=test_frp_token', 'DB_PATH=./db.sqlite', 'STORAGE_DIR=./files',
    'FRP_PORT_RANGE_START=20000', 'FRP_PORT_RANGE_END=25000',
  ].join('\n'));

  fs.writeFileSync(path.join(DIST, 'config.json'), JSON.stringify({
    clientId: CLIENT_ID, clientName: 'E2E Test Machine',
    serverUrl: 'ws://localhost:3000/ws/client', apiBaseUrl: 'http://localhost:3000',
    token: TOKEN, workspaceDir: './workspace', tags: ['test', 'e2e'],
  }));

  // Clean DB
  try { fs.unlinkSync(path.join(DIST, 'db.sqlite')); } catch { /* ok */ }

  // ── Start server ──────────────────────────────────────────────────
  console.log('── Starting server ──');
  serverProc = startProcess('server', DIST, 'node', ['server.bundle.cjs']);
  const serverReady = await waitFor(async () => {
    try { const r = await fetch(`${BASE_URL}/api/health`); return r.ok; } catch { return false; }
  }, 10_000, 'server startup');
  if (!serverReady) { console.log('Server failed to start'); process.exit(1); }
  log('🟢', 'Server ready');

  // ── Start client ──────────────────────────────────────────────────
  console.log('── Starting client ──');
  clientProc = startProcess('client', DIST, 'node', ['client.bundle.cjs']);
  const clientReady = await waitFor(async () => {
    try {
      const r = await fetch(`${BASE_URL}/api/clients`, { headers: { Authorization: `Bearer ${TOKEN}` } });
      const data = await r.json() as unknown[];
      return r.ok && data.length > 0 && (data[0] as Record<string, unknown>).status === 'online';
    } catch { return false; }
  }, 10_000, 'client registration');
  if (!clientReady) { console.log('Client failed to register'); process.exit(1); }
  log('🟢', 'Client registered');

  // ── Run tests ─────────────────────────────────────────────────────
  console.log('\n── Running tests ──\n');

  // 1. Health check
  await test('GET /api/health returns ok', async () => {
    const r = await fetch(`${BASE_URL}/api/health`);
    const body = await r.json() as Record<string, unknown>;
    return r.status === 200 && body.status === 'ok';
  });

  // 2. Auth required
  await test('GET /api/clients (no auth) returns 401', async () => {
    const r = await fetch(`${BASE_URL}/api/clients`);
    return r.status === 401;
  });

  // 3. Client listing
  await test('GET /api/clients lists online client', async () => {
    const { status, body } = await api('GET', `${BASE_URL}/api/clients`);
    const clients = body as Record<string, unknown>[];
    return status === 200 && clients.length >= 1 && clients[0].id === CLIENT_ID && clients[0].online === true;
  });

  // 4. Health check task
  let healthTaskId = '';
  await test('POST /api/tasks health_check', async () => {
    const { status, body } = await apiJson('POST', `${BASE_URL}/api/tasks`, {
      clientId: CLIENT_ID, type: 'health_check', payload: {},
    });
    const task = body as Record<string, unknown>;
    healthTaskId = task.id as string;
    return status === 201 && task.type === 'health_check';
  });

  await test('health_check completes with success', async () => {
    await sleep(1500);
    const { body } = await api('GET', `${BASE_URL}/api/tasks/${healthTaskId}`);
    const task = body as Record<string, unknown>;
    return task.status === 'success' && (task.result as Record<string, unknown>)?.exitCode === 0;
  });

  // 5. Script execution
  let scriptTaskId = '';
  await test('exec_script runs Node.js code', async () => {
    const { status, body } = await apiJson('POST', `${BASE_URL}/api/tasks`, {
      clientId: CLIENT_ID, type: 'exec_script', payload: {
        runtime: 'node', script: "console.log('E2E:' + (1+1)); console.error('err test');",
        timeoutMs: 10_000,
      },
    });
    scriptTaskId = (body as Record<string, unknown>).id as string;
    return status === 201;
  });

  await test('exec_script returns stdout + stderr logs', async () => {
    await sleep(1500);
    const { body } = await api('GET', `${BASE_URL}/api/tasks/${scriptTaskId}/logs`);
    const logs = body as { stream: string; content: string }[];
    const hasStdout = logs.some((l) => l.stream === 'stdout' && l.content.includes('E2E:2'));
    const hasStderr = logs.some((l) => l.stream === 'stderr' && l.content.includes('err test'));
    return hasStdout && hasStderr;
  });

  await test('exec_script status is success', async () => {
    const { body } = await api('GET', `${BASE_URL}/api/tasks/${scriptTaskId}`);
    return (body as Record<string, unknown>).status === 'success';
  });

  // 6. Command execution
  let cmdTaskId = '';
  await test('exec_command runs shell command', async () => {
    const { status, body } = await apiJson('POST', `${BASE_URL}/api/tasks`, {
      clientId: CLIENT_ID, type: 'exec_command', payload: {
        command: 'echo CMD_TEST_PASS', timeoutMs: 10_000,
      },
    });
    cmdTaskId = (body as Record<string, unknown>).id as string;
    return status === 201;
  });

  await test('exec_command output captured', async () => {
    await sleep(1500);
    const { body } = await api('GET', `${BASE_URL}/api/tasks/${cmdTaskId}/logs`);
    const logs = body as { content: string }[];
    return logs.some((l) => l.content.includes('CMD_TEST_PASS'));
  });

  // 7. File upload
  let fileId = '';
  let fileSize = 0;
  await test('POST /api/files uploads file', async () => {
    // Write a temp file first (FormData from file is more reliable than Blob)
    const tmpPath = path.join(DIST, '_e2e_upload.json');
    fs.writeFileSync(tmpPath, '{"e2e":true,"msg":"hello from test"}');
    fileSize = fs.statSync(tmpPath).size;

    const fileBuf = await fs.promises.readFile(tmpPath);
    const blob = new Blob([fileBuf], { type: 'application/json' });
    const form = new FormData();
    form.append('file', blob, 'e2e-test.json');

    const { status, body } = await api('POST', `${BASE_URL}/api/files`, { body: form, headers: {} });
    fileId = (body as Record<string, unknown>).id as string;
    fs.unlinkSync(tmpPath);
    return status === 201 && typeof fileId === 'string' && fileId.startsWith('file_');
  });

  // 8. File push
  let pushTaskId = '';
  await test('push_file delivers to client', async () => {
    const { status, body } = await apiJson('POST', `${BASE_URL}/api/tasks`, {
      clientId: CLIENT_ID, type: 'push_file', payload: {
        fileId, targetPath: 'downloads', fileName: 'received-e2e.json',
      },
    });
    pushTaskId = (body as Record<string, unknown>).id as string;
    return status === 201;
  });

  await test('push_file completes', async () => {
    await sleep(1500);
    const { body } = await api('GET', `${BASE_URL}/api/tasks/${pushTaskId}`);
    const task = body as Record<string, unknown>;
    const resultSize = (task.result as Record<string, unknown>)?.size;
    return task.status === 'success' && typeof resultSize === 'number' && resultSize > 0;
  });

  // 9. Agent API — run script that reads pushed file
  await test('Agent run-script reads pushed file', async () => {
    const { status, body } = await apiJson('POST', `${BASE_URL}/api/agent/run-script`, {
      target: { clientId: CLIENT_ID },
      script: "import { readFileSync } from 'fs'; const c = readFileSync('../../downloads/received-e2e.json','utf-8'); console.log('PUSHED:'+c);",
      timeoutMs: 10_000,
    });
    return status === 201;
  });

  // 10. Agent task query
  let agentTaskId = '';
  await test('Agent run-script with file listing', async () => {
    const { status, body } = await apiJson('POST', `${BASE_URL}/api/agent/run-script`, {
      target: { clientId: CLIENT_ID },
      script: "import { readdirSync } from 'fs'; console.log('FILES:'+readdirSync('../../downloads').join(','));",
      timeoutMs: 10_000,
    });
    agentTaskId = (body as Record<string, unknown>).id as string;
    return status === 201;
  });

  await test('Agent GET /api/agent/tasks/:id returns logs inline', async () => {
    await sleep(1500);
    const { status, body } = await api('GET', `${BASE_URL}/api/agent/tasks/${agentTaskId}`);
    const data = body as Record<string, unknown>;
    return status === 200 && Array.isArray(data.logs) && data.logs.length > 0
      && (data.logs as { content: string }[]).some((l) => l.content.includes('FILES:'));
  });

  // 11. Task history
  await test('Task history accessible via API', async () => {
    const { status, body } = await api('GET', `${BASE_URL}/api/tasks?limit=20`);
    return status === 200 && Array.isArray(body) && (body as unknown[]).length >= 5;
  });

  // ── Report ────────────────────────────────────────────────────────
  console.log(`\n${'─'.repeat(40)}`);
  console.log(`  Total:  ${passed + failed}`);
  console.log(`  Passed: ${passed} ✅`);
  console.log(`  Failed: ${failed} ${failed > 0 ? '❌' : ''}`);
  console.log(`${'─'.repeat(40)}\n`);

  // ── Cleanup ───────────────────────────────────────────────────────
  if (KEEP_ALIVE) {
    console.log('Keeping server & client alive (--keep).');
    console.log(`  Server: ${BASE_URL}`);
    console.log('  Press Ctrl+C to stop.\n');
    process.stdin.resume();
  } else {
    console.log('Stopping server & client...');
    serverProc?.kill('SIGTERM');
    clientProc?.kill('SIGTERM');
    await sleep(1000);
    serverProc?.kill('SIGKILL');
    clientProc?.kill('SIGKILL');
    console.log('Done.\n');
  }

  process.exit(failed > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error('Test suite error:', err);
  serverProc?.kill('SIGKILL');
  clientProc?.kill('SIGKILL');
  process.exit(1);
});
