import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { maskToken, parseKeyValueConfig, resolveConfig } from './config.js';

function tempDir(): string {
  return mkdtempSync(join(tmpdir(), 'rag-cli-config-'));
}

describe('parseKeyValueConfig', () => {
  it('parses env-style key value files and strips quotes', () => {
    expect(parseKeyValueConfig('RAG_SERVER_URL="http://localhost:3000"\nRAG_AGENT_TOKEN=abc\n# ignored')).toEqual({
      RAG_SERVER_URL: 'http://localhost:3000',
      RAG_AGENT_TOKEN: 'abc',
    });
  });
});

describe('maskToken', () => {
  it('does not reveal full tokens', () => {
    expect(maskToken('')).toBe('(empty)');
    expect(maskToken('short')).toBe('sho...');
    expect(maskToken('test_agent_token_123456')).toBe('test_age...3456');
  });
});

describe('resolveConfig', () => {
  it('uses CLI flags before environment variables', () => {
    const config = resolveConfig({
      cwd: tempDir(),
      argv: ['--server', 'http://flag:3000', '--token', 'flag-token', 'clients', 'list'],
      env: { RAG_SERVER_URL: 'http://env:3000', RAG_AGENT_TOKEN: 'env-token' },
    });

    expect(config.serverUrl).toBe('http://flag:3000');
    expect(config.token).toBe('flag-token');
    expect(config.commandArgs).toEqual(['clients', 'list']);
  });

  it('uses environment variables for server URL and token', () => {
    const config = resolveConfig({
      cwd: tempDir(),
      argv: ['doctor'],
      env: { RAG_SERVER_URL: 'http://env:3000/', RAG_AGENT_TOKEN: 'env-token' },
    });

    expect(config.serverUrl).toBe('http://env:3000');
    expect(config.token).toBe('env-token');
  });

  it('supports alternate token environment variables', () => {
    const config = resolveConfig({
      cwd: tempDir(),
      argv: ['doctor'],
      env: { RAG_SERVER_URL: 'http://env:3000', AGENT_API_TOKEN: 'agent-api-token' },
    });

    expect(config.token).toBe('agent-api-token');
  });

  it('uses .ragrc before .env', () => {
    const dir = tempDir();
    writeFileSync(join(dir, '.ragrc'), 'RAG_SERVER_URL=http://ragrc:3000\nRAG_AGENT_TOKEN=ragrc-token\n');
    writeFileSync(join(dir, '.env'), 'RAG_SERVER_URL=http://envfile:3000\nRAG_AGENT_TOKEN=envfile-token\n');

    const config = resolveConfig({ cwd: dir, argv: ['doctor'], env: {} });

    expect(config.serverUrl).toBe('http://ragrc:3000');
    expect(config.token).toBe('ragrc-token');
  });

  it('uses server.config.yaml when no higher priority config exists', () => {
    const dir = tempDir();
    writeFileSync(join(dir, 'server.config.yaml'), 'server:\n  host: 0.0.0.0\n  port: 3333\nauth:\n  agentApiToken: yaml-agent-token\n');

    const config = resolveConfig({ cwd: dir, argv: ['doctor'], env: {} });

    expect(config.serverUrl).toBe('http://localhost:3333');
    expect(config.token).toBe('yaml-agent-token');
  });

  it('finds config files in ancestor directories', () => {
    const dir = tempDir();
    const child = join(dir, 'nested', 'project');
    mkdirSync(child, { recursive: true });
    writeFileSync(join(dir, '.ragrc'), 'RAG_SERVER_URL=http://parent:3000\nRAG_AGENT_TOKEN=parent-token\n');

    const config = resolveConfig({ cwd: child, argv: ['doctor'], env: {} });

    expect(config.serverUrl).toBe('http://parent:3000');
    expect(config.token).toBe('parent-token');
  });
});
