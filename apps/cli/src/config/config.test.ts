import { mkdtempSync, writeFileSync } from 'node:fs';
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
    expect(maskToken('')).toBe('(空)');
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

  it('does not read .ragrc or .env files', () => {
    const dir = tempDir();
    writeFileSync(join(dir, '.ragrc'), 'RAG_SERVER_URL=http://ragrc:3000\nRAG_AGENT_TOKEN=ragrc-token\n');
    writeFileSync(join(dir, '.env'), 'RAG_SERVER_URL=http://envfile:3000\nRAG_AGENT_TOKEN=envfile-token\n');

    const config = resolveConfig({ cwd: dir, argv: ['doctor'], env: {} });

    expect(config.serverUrl).toBe('');
    expect(config.token).toBe('');
  });

  it('does not read server.config.yaml for CLI defaults', () => {
    const dir = tempDir();
    writeFileSync(join(dir, 'server.config.yaml'), 'server:\n  host: 0.0.0.0\n  port: 3333\nauth:\n  agentApiToken: yaml-agent-token\n');

    const config = resolveConfig({ cwd: dir, argv: ['doctor'], env: {} });

    expect(config.serverUrl).toBe('');
    expect(config.token).toBe('');
  });
});
