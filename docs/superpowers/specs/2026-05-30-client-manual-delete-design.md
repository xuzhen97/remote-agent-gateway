# Client Manual Delete Design

**Date:** 2026-05-30

## Goal

Add a manual delete mechanism for stale client records in the server web console so operators can remove offline test clients such as `e2e-test-client`.

This feature is intentionally narrow:
- Only manual deletion is supported.
- Only offline clients can be deleted.
- Deleting a client also removes its related port mappings, tasks, and task logs.
- No automatic cleanup is introduced.

## Context

The current server persists client records in SQLite. When a client disconnects, the WebSocket close handler marks it as `offline`, but the record remains in the `clients` table indefinitely. The web console currently exposes no deletion action for clients, so stale test clients accumulate.

The codebase already separates concerns cleanly enough for a narrow change:
- `ClientsService` owns client persistence and API serialization.
- `FrpService` owns port mapping persistence.
- `TasksService` owns task and task log persistence.
- `clients.routes.ts` exposes client-facing management APIs.
- `apps/server/src/web/index.html` renders the admin UI and currently lists clients without a delete action.

## Requirements

### Functional Requirements

1. Operators can delete a client from the web console.
2. The delete action is available only for offline clients.
3. Deleting a client removes:
   - the client record,
   - all port mappings belonging to that client,
   - all tasks belonging to that client,
   - all task logs for those tasks.
4. Deleting an online client must be rejected by the server, even if the UI attempted it.
5. Attempting to delete a missing client must return a not-found response.
6. Successful deletions must be recorded in the audit log.

### Non-Requirements

1. No automatic retention cleanup.
2. No support for deleting online clients.
3. No soft-delete or recycle bin.
4. No database schema migration to add foreign key cascades.
5. No task-level or mapping-level archival before deletion.

## Approach Options

### Option 1: Backend delete endpoint with service-level cascade cleanup

Add a `DELETE /api/clients/:clientId` endpoint. The route validates the target, enforces the offline-only rule, performs application-level cascade cleanup across related tables, writes an audit log entry, and returns success.

Pros:
- Centralizes safety checks in the backend.
- Works for both current web UI and future API consumers.
- Keeps the change small and aligned with existing service boundaries.
- Avoids a risky schema migration.

Cons:
- Requires a small amount of explicit cascade logic in application code.

### Option 2: UI-only hiding or filtering of stale clients

Hide test clients in the web console rather than deleting them.

Pros:
- Minimal UI-only change.

Cons:
- Does not solve data accumulation.
- Leaves stale records and related artifacts in the database.
- Fails the user requirement.

### Option 3: Database-level foreign keys with `ON DELETE CASCADE`

Add relational constraints and rely on the database to cascade deletes.

Pros:
- Long-term strong data integrity.

Cons:
- Heavier migration and compatibility work for an otherwise small feature.
- Requires touching migration behavior and existing database assumptions.
- Larger blast radius than necessary.

## Recommended Design

Use Option 1.

This is the smallest correct fix. The backend remains the source of truth for deletion safety, the UI becomes a thin trigger, and the database stays consistent without introducing a broader schema change.

## Architecture

### Backend API

Add `DELETE /api/clients/:clientId` to `apps/server/src/modules/clients/clients.routes.ts`.

Behavior:
- Look up the client.
- Return `404` if it does not exist.
- Reject with `400` if the client is online according to `connectionManager.isOnline(clientId)`.
- Call a new service-level deletion method that removes related port mappings, tasks, task logs, and finally the client row.
- Write an audit log entry describing the manual delete operation.
- Return `{ success: true }` on success.

The route must enforce the offline-only rule even if the frontend hides the action for online clients. This prevents accidental or malicious bypasses.

### Service Responsibilities

Keep the deletion orchestration in `ClientsService`, since the user-facing operation is “delete client.” The service will own a new method for cascade removal, while `TasksService` and `FrpService` can expose narrowly scoped helper methods if needed.

Recommended shape:
- `ClientsService.deleteClientCascade(clientId: string): { deletedMappings: number; deletedTasks: number; deletedLogs: number }`
- `TasksService.deleteTasksByClientId(clientId: string): { deletedTasks: number; deletedLogs: number }`
- `FrpService.deleteMappingsByClientId(clientId: string): number`

The exact signatures can vary, but the intent is fixed: keep table-specific deletion logic near the owning service, and keep the route handler thin.

### Cascade Rules

Deletion order should be:
1. Delete port mappings for the client.
2. Delete task logs for tasks owned by the client.
3. Delete tasks for the client.
4. Delete the client row.

This order avoids orphaned rows and is explicit about cross-table cleanup.

Because the client is offline, there is no attempt to dispatch FRP removal tasks to the agent. This is purely persistence cleanup for stale records.

### Frontend UI

Update `apps/server/src/web/index.html` client list behavior.

Changes:
- Keep the existing refresh action.
- Add a delete button for offline clients only.
- Do not render the delete action for online clients.
- On click, show a confirmation prompt that states deletion is irreversible and will also remove related port mappings, tasks, and task logs.
- After success, refresh the client list and show a toast.
- On API failure, surface the backend error in a toast.

This keeps the UX minimal and matches the existing style of the admin console.

## Data Flow

1. Operator opens the Clients page.
2. UI fetches `/api/clients` and renders each client.
3. For offline clients, UI renders a delete button.
4. Operator confirms deletion.
5. UI sends `DELETE /api/clients/:clientId`.
6. Server validates existence and offline status.
7. Server deletes related mappings, task logs, tasks, and the client record.
8. Server writes an audit log entry.
9. UI shows success and reloads the client list.

## Error Handling

### Missing Client

Return `404` with `{ error: 'Client not found' }`.

### Online Client

Return `400` with a clear message such as `{ error: 'Only offline clients can be deleted' }`.

### Partial Delete Risk

To reduce the chance of inconsistent cleanup, the backend should keep all delete steps close together in one control flow and save the database after the operation completes. If a transaction helper already exists in the current database layer, use it. If not, keep the implementation narrow and synchronous, consistent with the current sql.js usage.

### Frontend Failure Reporting

The UI should not guess the reason for failure. It should display the backend-provided error message when available.

## Testing Strategy

### Backend Tests

Add or extend service-level tests to cover:
- deleting an offline client removes the client row, related mappings, related tasks, and related task logs;
- deleting an online client is rejected at the route or service guard level;
- deleting a missing client returns not found.

The most important regression test is the cascade-delete case, because that is where stale associated data would otherwise remain.

### Frontend Verification

Manual verification is sufficient for this change:
- create or reuse an offline test client record;
- confirm the Clients page shows a delete action for it;
- delete it and verify it disappears from the list;
- verify related mappings and tasks no longer appear in their respective pages;
- confirm online clients do not show a delete action.

## Files Expected To Change

Backend:
- `apps/server/src/modules/clients/clients.routes.ts`
- `apps/server/src/modules/clients/clients.service.ts`
- `apps/server/src/modules/clients/clients.service.test.ts`
- `apps/server/src/modules/tasks/tasks.service.ts`
- `apps/server/src/modules/frp/frp.service.ts`

Frontend:
- `apps/server/src/web/index.html`

Possibly:
- route-level tests if the current server test setup makes them straightforward.

## Tradeoffs

The main tradeoff is choosing application-managed cascade deletion instead of database-enforced cascade deletion. For this codebase and this request, that is the right tradeoff: the change stays small, avoids migration risk, and solves the actual operator problem immediately.

The second tradeoff is refusing deletion of online clients instead of offering a force-delete flow. That is intentional. It avoids disconnect semantics, prevents accidental destruction of active agents, and matches the requested safety boundary.

## Acceptance Criteria

The design is complete when all of the following are true:
- The web console allows deleting offline clients.
- Online clients cannot be deleted.
- Deleting a client removes its related mappings, tasks, and task logs.
- The server rejects invalid delete attempts with clear errors.
- The action is auditable.
- No automatic cleanup behavior is added.
