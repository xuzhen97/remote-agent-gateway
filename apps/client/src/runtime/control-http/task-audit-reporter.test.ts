import { describe, expect, it, vi } from 'vitest';
import { createTaskAuditReporter } from './task-audit-reporter.js';

describe('task audit reporter', () => {
  const baseRecord = {
    recordId: 'rec_01', clientId: 'client-1', requestId: 'req_01',
    resourceType: 'file' as const, actionType: 'file.write' as const,
    method: 'PUT', path: '/files/write',
    targetId: 'workspace:src/index.ts', sourceType: 'web-console' as const,
    actorType: 'admin-token' as const,
    actorLabel: 'web-console/admin-token', querySummary: {}, requestSummary: {},
    resultSummary: {}, status: 'success' as const, httpStatus: 200,
    startedAt: 1, finishedAt: 2, durationMs: 1,
    syncStatus: 'pending' as const, reportedAt: 2,
  };

  it('marks synced when mirror upload succeeds', async () => {
    const store = { updateSync: vi.fn(async () => undefined) };
    const fetchImpl = vi.fn().mockResolvedValue(new Response(JSON.stringify({ ok: true }), { status: 200 }));
    const reporter = createTaskAuditReporter({
      apiBaseUrl: 'http://server',
      serverToken: 'agent-token',
      clientName: 'Client One',
      store: store as any,
      fetchImpl: fetchImpl as any,
    });

    await reporter.report(baseRecord);

    expect(store.updateSync).toHaveBeenCalledWith('rec_01', expect.objectContaining({ syncStatus: 'synced' }));
  });

  it('marks sync_failed when mirror upload fails', async () => {
    const store = { updateSync: vi.fn(async () => undefined) };
    const fetchImpl = vi.fn().mockResolvedValue(new Response('boom', { status: 500 }));
    const reporter = createTaskAuditReporter({
      apiBaseUrl: 'http://server',
      serverToken: 'agent-token',
      clientName: 'Client One',
      store: store as any,
      fetchImpl: fetchImpl as any,
    });

    await reporter.report(baseRecord);

    expect(store.updateSync).toHaveBeenCalledWith('rec_01', expect.objectContaining({ syncStatus: 'sync_failed' }));
  });

  it('marks sync_failed on network error', async () => {
    const store = { updateSync: vi.fn(async () => undefined) };
    const fetchImpl = vi.fn().mockRejectedValue(new Error('Network error'));
    const reporter = createTaskAuditReporter({
      apiBaseUrl: 'http://server',
      serverToken: 'agent-token',
      clientName: 'Client One',
      store: store as any,
      fetchImpl: fetchImpl as any,
    });

    await reporter.report(baseRecord);

    expect(store.updateSync).toHaveBeenCalledWith('rec_01', expect.objectContaining({
      syncStatus: 'sync_failed',
      syncError: 'Network error',
    }));
  });

  it('skips report when apiBaseUrl is missing', async () => {
    const store = { updateSync: vi.fn(async () => undefined) };
    const reporter = createTaskAuditReporter({
      apiBaseUrl: undefined,
      serverToken: undefined,
      clientName: 'Client One',
      store: store as any,
      fetchImpl: undefined as any,
    });

    await reporter.report(baseRecord);

    expect(store.updateSync).not.toHaveBeenCalled();
  });

  it('skips report when serverToken is missing', async () => {
    const store = { updateSync: vi.fn(async () => undefined) };
    const reporter = createTaskAuditReporter({
      apiBaseUrl: 'http://server',
      serverToken: undefined,
      clientName: 'Client One',
      store: store as any,
      fetchImpl: undefined as any,
    });

    await reporter.report(baseRecord);

    expect(store.updateSync).not.toHaveBeenCalled();
  });
});
