import { beforeEach, describe, expect, it, vi } from 'vitest';
import initSqlJs, { type Database } from 'sql.js';
import { migrate } from '../../db/migrate.js';

const state = vi.hoisted(() => ({
  db: null as Database | null,
}));

vi.mock('../../db/index.js', () => ({
  getDb: () => {
    if (!state.db) throw new Error('test database not initialized');
    return state.db;
  },
}));

import { TasksService } from './tasks.service.js';

function insertTask(params: { id: string; clientId: string; status?: string; result?: string | null; error?: string | null }): void {
  const now = 1_000_000;
  state.db!.run(
    `INSERT INTO tasks (id, client_id, type, status, payload, result, error, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [params.id, params.clientId, 'exec_script', params.status ?? 'pending', '{"runtime":"node"}', params.result ?? null, params.error ?? null, now],
  );
}

function insertTaskLog(params: { taskId: string; content: string }): void {
  state.db!.run(
    `INSERT INTO task_logs (task_id, stream, content, created_at) VALUES (?, ?, ?, ?)`,
    [params.taskId, 'stdout', params.content, 1_000_000],
  );
}

describe('TasksService delete operations', () => {
  let service: TasksService;

  beforeEach(async () => {
    const SQL = await initSqlJs();
    state.db = new SQL.Database();
    migrate(state.db);
    service = new TasksService();
  });

  it('deletes a single task together with its logs while preserving other tasks', () => {
    insertTask({ id: 'task_delete_me', clientId: 'client-1', result: '{"ok":true}' });
    insertTask({ id: 'task_keep_me', clientId: 'client-2', error: 'boom' });
    insertTaskLog({ taskId: 'task_delete_me', content: 'delete-log-1' });
    insertTaskLog({ taskId: 'task_delete_me', content: 'delete-log-2' });
    insertTaskLog({ taskId: 'task_keep_me', content: 'keep-log' });

    const summary = service.deleteTaskById('task_delete_me');

    expect(summary).toEqual({ deletedTask: true, deletedLogs: 2 });
    expect(service.getTask('task_delete_me')).toBeUndefined();
    expect(service.getTask('task_keep_me')).toBeDefined();

    const deletedLogs = state.db!.exec("SELECT id FROM task_logs WHERE task_id = 'task_delete_me'");
    expect(deletedLogs.length).toBe(0);

    const keptLogs = state.db!.exec("SELECT content FROM task_logs WHERE task_id = 'task_keep_me'");
    expect(keptLogs[0].values).toEqual([['keep-log']]);
  });

  it('returns zero counts when deleting a missing task', () => {
    insertTask({ id: 'task_keep_me', clientId: 'client-2' });
    insertTaskLog({ taskId: 'task_keep_me', content: 'keep-log' });

    const summary = service.deleteTaskById('task_missing');

    expect(summary).toEqual({ deletedTask: false, deletedLogs: 0 });
    expect(service.getTask('task_keep_me')).toBeDefined();
  });

  it('bulk deletes multiple tasks, deduplicates ids, and preserves unrelated rows', () => {
    insertTask({ id: 'task_a', clientId: 'client-1' });
    insertTask({ id: 'task_b', clientId: 'client-1' });
    insertTask({ id: 'task_c', clientId: 'client-2' });
    insertTaskLog({ taskId: 'task_a', content: 'a-1' });
    insertTaskLog({ taskId: 'task_a', content: 'a-2' });
    insertTaskLog({ taskId: 'task_b', content: 'b-1' });
    insertTaskLog({ taskId: 'task_c', content: 'c-1' });

    const summary = service.deleteTasksByIds(['task_a', 'task_b', 'task_a', 'task_missing']);

    expect(summary).toEqual({ deletedTasks: 2, deletedLogs: 3 });
    expect(service.getTask('task_a')).toBeUndefined();
    expect(service.getTask('task_b')).toBeUndefined();
    expect(service.getTask('task_c')).toBeDefined();

    const remainingLogs = state.db!.exec('SELECT task_id, content FROM task_logs ORDER BY task_id, content');
    expect(remainingLogs[0].values).toEqual([['task_c', 'c-1']]);
  });
});
