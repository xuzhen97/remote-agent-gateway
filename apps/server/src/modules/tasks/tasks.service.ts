import { getDb } from '../../db/index.js';
import type { TaskType, TaskStatus } from '@rag/shared';
import { v4 as uuid } from 'uuid';

export interface TaskRow {
  id: string;
  client_id: string;
  type: string;
  status: string;
  payload: string;
  result: string | null;
  error: string | null;
  created_by: string | null;
  created_at: number;
  started_at: number | null;
  finished_at: number | null;
}

export interface TaskLogRow {
  id: number;
  task_id: string;
  stream: string;
  content: string;
  created_at: number;
}

export class TasksService {
  createTask(params: {
    clientId: string;
    type: TaskType;
    payload: unknown;
    createdBy?: string;
  }): TaskRow {
    const db = getDb();
    const id = `task_${uuid().slice(0, 8)}`;
    const now = Date.now();

    db.run(
      `INSERT INTO tasks (id, client_id, type, status, payload, created_by, created_at) VALUES (?, ?, ?, 'pending', ?, ?, ?)`,
      [id, params.clientId, params.type, JSON.stringify(params.payload), params.createdBy ?? null, now],
    );

    return this.getTask(id)!;
  }

  getTask(taskId: string): TaskRow | undefined {
    const db = getDb();
    const stmt = db.prepare('SELECT * FROM tasks WHERE id = ?');
    stmt.bind([taskId]);
    if (stmt.step()) {
      const row = stmt.getAsObject() as unknown as TaskRow;
      stmt.free();
      return row;
    }
    stmt.free();
    return undefined;
  }

  listTasks(filters?: { clientId?: string; status?: TaskStatus; limit?: number }): TaskRow[] {
    const db = getDb();
    let sql = 'SELECT * FROM tasks WHERE 1=1';
    const params: unknown[] = [];

    if (filters?.clientId) {
      sql += ' AND client_id = ?';
      params.push(filters.clientId);
    }
    if (filters?.status) {
      sql += ' AND status = ?';
      params.push(filters.status);
    }

    sql += ' ORDER BY created_at DESC';
    if (filters?.limit) {
      sql += ' LIMIT ?';
      params.push(filters.limit);
    }

    const results: TaskRow[] = [];
    const stmt = db.prepare(sql);
    stmt.bind(params);
    while (stmt.step()) {
      results.push(stmt.getAsObject() as unknown as TaskRow);
    }
    stmt.free();
    return results;
  }

  updateTaskStatus(taskId: string, status: TaskStatus, updates?: { result?: unknown; error?: string; startedAt?: number; finishedAt?: number }): void {
    const db = getDb();
    const now = Date.now();
    db.run(
      `UPDATE tasks SET status = ?, result = ?, error = ?, started_at = ?, finished_at = ? WHERE id = ?`,
      [status, updates?.result ? JSON.stringify(updates.result) : null, updates?.error ?? null, updates?.startedAt ?? null, updates?.finishedAt ?? now, taskId],
    );
  }

  addLog(taskId: string, stream: 'stdout' | 'stderr', content: string): void {
    const db = getDb();
    db.run(
      `INSERT INTO task_logs (task_id, stream, content, created_at) VALUES (?, ?, ?, ?)`,
      [taskId, stream, content, Date.now()],
    );
  }

  getLogs(taskId: string): TaskLogRow[] {
    const db = getDb();
    const results: TaskLogRow[] = [];
    const stmt = db.prepare('SELECT * FROM task_logs WHERE task_id = ? ORDER BY created_at ASC');
    stmt.bind([taskId]);
    while (stmt.step()) {
      results.push(stmt.getAsObject() as unknown as TaskLogRow);
    }
    stmt.free();
    return results;
  }

  deleteTasksByClientId(clientId: string): { deletedTasks: number; deletedLogs: number } {
    const db = getDb();

    db.run(
      `DELETE FROM task_logs WHERE task_id IN (
        SELECT id FROM tasks WHERE client_id = ?
      )`,
      [clientId],
    );
    const deletedLogs = db.getRowsModified();

    db.run('DELETE FROM tasks WHERE client_id = ?', [clientId]);
    const deletedTasks = db.getRowsModified();

    return { deletedTasks, deletedLogs };
  }

  toApi(task: TaskRow): Record<string, unknown> {
    return {
      id: task.id,
      clientId: task.client_id,
      type: task.type,
      status: task.status,
      payload: JSON.parse(task.payload),
      result: task.result ? JSON.parse(task.result) : null,
      error: task.error,
      createdBy: task.created_by,
      createdAt: task.created_at,
      startedAt: task.started_at,
      finishedAt: task.finished_at,
    };
  }
}

export const tasksService = new TasksService();
