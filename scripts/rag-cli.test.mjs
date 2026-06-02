import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, mkdir } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const mod = await import('./rag.mjs');
const { resolveConfig, parseKeyValueConfig, parseYamlLikeConfig, runCli } = mod;

async function tempProject() {
  return mkdtemp(join(tmpdir(), 'rag-cli-'));
}

test('parseKeyValueConfig reads rag env keys and ignores comments', () => {
  const config = parseKeyValueConfig(`
# comment
RAG_SERVER_URL=http://gateway:3000
RAG_AGENT_TOKEN="agent-token"
OTHER=value
`);
  assert.deepEqual(config, {
    RAG_SERVER_URL: 'http://gateway:3000',
    RAG_AGENT_TOKEN: 'agent-token',
    OTHER: 'value',
  });
});

test('resolveConfig prefers CLI flags over env and files', async () => {
  const cwd = await tempProject();
  await writeFile(join(cwd, '.ragrc'), 'RAG_SERVER_URL=http://file:3000\nRAG_AGENT_TOKEN=file-token\n');

  const config = resolveConfig({
    cwd,
    argv: ['--server', 'http://flag:3000', '--token', 'flag-token', 'clients'],
    env: {
      RAG_SERVER_URL: 'http://env:3000',
      RAG_AGENT_TOKEN: 'env-token',
    },
  });

  assert.equal(config.serverUrl, 'http://flag:3000');
  assert.equal(config.agentToken, 'flag-token');
  assert.equal(config.commandArgs[0], 'clients');
});

test('resolveConfig supports recommended user env vars with test_agent_token', async () => {
  const cwd = await tempProject();

  const config = resolveConfig({
    cwd,
    argv: ['clients'],
    env: {
      RAG_SERVER_URL: 'http://your-server:3000',
      RAG_AGENT_TOKEN: 'test_agent_token',
    },
  });

  assert.equal(config.serverUrl, 'http://your-server:3000');
  assert.equal(config.agentToken, 'test_agent_token');
});

test('resolveConfig reads .ragrc by walking up parent directories', async () => {
  const root = await tempProject();
  const nested = join(root, 'a', 'b');
  await mkdir(nested, { recursive: true });
  await writeFile(join(root, '.ragrc'), 'RAG_SERVER_URL=http://root:3000\nRAG_AGENT_TOKEN=root-token\n');

  const config = resolveConfig({ cwd: nested, argv: ['clients'], env: {} });

  assert.equal(config.serverUrl, 'http://root:3000');
  assert.equal(config.agentToken, 'root-token');
});

test('resolveConfig prefers .ragrc over .env but real env vars over .ragrc', async () => {
  const cwd = await tempProject();
  await writeFile(join(cwd, '.env'), 'SERVER_PORT=3999\nAGENT_API_TOKEN=env-file-token\n');
  await writeFile(join(cwd, '.ragrc'), 'RAG_SERVER_URL=http://ragrc:3000\nRAG_AGENT_TOKEN=ragrc-token\n');

  const fileConfig = resolveConfig({ cwd, argv: ['clients'], env: {} });
  assert.equal(fileConfig.serverUrl, 'http://ragrc:3000');
  assert.equal(fileConfig.agentToken, 'ragrc-token');

  const envConfig = resolveConfig({ cwd, argv: ['clients'], env: {
    RAG_SERVER_URL: 'http://real-env:3000',
    RAG_AGENT_TOKEN: 'real-env-token',
  } });
  assert.equal(envConfig.serverUrl, 'http://real-env:3000');
  assert.equal(envConfig.agentToken, 'real-env-token');
});

test('resolveConfig can derive config from existing client.config.yaml', async () => {
  const cwd = await tempProject();
  await writeFile(join(cwd, 'client.config.yaml'), `
client:
  id: dev-client-01
server:
  wsUrl: ws://localhost:3000/ws/client
  apiBaseUrl: http://localhost:3000
  token: yaml-token
`);

  const config = resolveConfig({ cwd, argv: ['clients'], env: {} });

  assert.equal(config.serverUrl, 'http://localhost:3000');
  assert.equal(config.agentToken, 'yaml-token');
});

test('resolveConfig can derive config from existing server.config.yaml', async () => {
  const cwd = await tempProject();
  await writeFile(join(cwd, 'server.config.yaml'), `
server:
  host: 0.0.0.0
  port: 3010
auth:
  adminToken: admin
  agentApiToken: server-token
`);

  const config = resolveConfig({ cwd, argv: ['clients'], env: {} });

  assert.equal(config.serverUrl, 'http://localhost:3010');
  assert.equal(config.agentToken, 'server-token');
});

test('write accepts rootId after inline content', async () => {
  const calls = [];
  globalThis.fetch = async (url, init = {}) => {
    calls.push({ url: String(url), init });
    if (String(url).endsWith('/api/agent/file-session')) {
      return new Response(JSON.stringify({ clientId: 'client-1', publicUrl: 'http://file.example', token: 'file-token' }), { status: 200 });
    }
    if (String(url).endsWith('/api/agent/file-session') && init.method === 'DELETE') {
      return new Response(JSON.stringify({ stopped: true }), { status: 200 });
    }
    if (String(url).startsWith('http://file.example/v1/write')) {
      return new Response(JSON.stringify({ ok: true }), { status: 200 });
    }
    return new Response(JSON.stringify({ ok: true }), { status: 200 });
  };

  await runCli({
    cwd: await tempProject(),
    argv: ['--server', 'http://gateway:3000', '--token', 'agent-token', 'write', 'client-1', 'D:/apps/app.jar', 'hello world', 'root-1'],
    env: {},
  });

  const writeCall = calls.find((call) => call.url.startsWith('http://file.example/v1/write'));
  assert.ok(writeCall);
  assert.match(writeCall.url, /rootId=root-1/);
  assert.match(writeCall.url, /path=D%3A%2Fapps%2Fapp\.jar/);
  assert.equal(writeCall.init.body, 'hello world');
});

test('write preserves binary stdin bytes', async () => {
  const cwd = await tempProject();
  const server = await new Promise((resolveServer) => {
    import('node:http').then(({ default: http }) => {
      const requests = [];
      const s = http.createServer((req, res) => {
        const chunks = [];
        req.on('data', (chunk) => chunks.push(chunk));
        req.on('end', () => {
          const body = Buffer.concat(chunks);
          requests.push({ method: req.method, url: req.url, body });
          if (req.url === '/api/agent/file-session' && req.method === 'POST') {
            res.setHeader('Content-Type', 'application/json');
            res.end(JSON.stringify({ clientId: 'client-1', publicUrl: `http://127.0.0.1:${s.address().port}`, token: 'file-token' }));
          } else if (req.url === '/api/agent/file-session' && req.method === 'DELETE') {
            res.setHeader('Content-Type', 'application/json');
            res.end(JSON.stringify({ stopped: true }));
          } else if (req.url?.startsWith('/v1/write')) {
            res.setHeader('Content-Type', 'application/json');
            res.end(JSON.stringify({ ok: true }));
          } else {
            res.statusCode = 404;
            res.end('not found');
          }
        });
      });
      s.listen(0, '127.0.0.1', () => resolveServer({ server: s, requests }));
    });
  });

  try {
    const input = Buffer.from([0x50, 0x4b, 0x03, 0x04, 0xff, 0x00, 0x80]);
    const child = spawn(process.execPath, [resolve('scripts/rag.mjs'), '--server', `http://127.0.0.1:${server.server.address().port}`, '--token', 'agent-token', 'write', 'client-1', 'D:/apps/app.jar', 'root-1'], { cwd });
    child.stdin.end(input);
    const exitCode = await new Promise((resolveExit) => child.on('close', resolveExit));
    assert.equal(exitCode, 0);

    const writeRequest = server.requests.find((request) => request.url?.startsWith('/v1/write'));
    assert.ok(writeRequest);
    assert.match(writeRequest.url, /rootId=root-1/);
    assert.deepEqual(writeRequest.body, input);
  } finally {
    await new Promise((resolveClose) => server.server.close(resolveClose));
  }
});

test('parseYamlLikeConfig handles the simple nested YAML used by RAG configs', () => {
  const parsed = parseYamlLikeConfig(`
server:
  apiBaseUrl: http://localhost:3000
  token: abc
frp:
  port: 7000
`);

  assert.equal(parsed.server.apiBaseUrl, 'http://localhost:3000');
  assert.equal(parsed.server.token, 'abc');
  assert.equal(parsed.frp.port, 7000);
});
