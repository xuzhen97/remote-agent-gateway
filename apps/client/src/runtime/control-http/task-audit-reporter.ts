import type { ClientTaskAuditLocalRecord } from '@rag/shared';
import type { TaskAuditStore } from './task-audit-store.js';

export function createTaskAuditReporter(options: {
  apiBaseUrl?: string;
  serverToken?: string;
  clientName: string;
  store: TaskAuditStore;
  fetchImpl?: typeof fetch;
}) {
  const fetcher = options.fetchImpl ?? fetch;

  return {
    async report(record: ClientTaskAuditLocalRecord): Promise<void> {
      if (!options.apiBaseUrl || !options.serverToken) return;
      try {
        const response = await fetcher(`${options.apiBaseUrl}/api/client-audit/records`, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${options.serverToken}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ ...record, clientNameSnapshot: options.clientName }),
        });
        if (!response.ok) throw new Error(`Mirror upload failed: ${response.status}`);
        await options.store.updateSync(record.recordId, { syncStatus: 'synced', syncedAt: Date.now(), syncError: null });
      } catch (error) {
        await options.store.updateSync(record.recordId, {
          syncStatus: 'sync_failed', syncedAt: null,
          syncError: error instanceof Error ? error.message : String(error),
        });
      }
    },
  };
}
