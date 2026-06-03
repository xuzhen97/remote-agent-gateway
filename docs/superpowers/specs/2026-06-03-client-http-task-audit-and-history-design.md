# Client HTTP Task Audit and History Design

Date: 2026-06-03

## Summary

Remote Agent Gateway will add end-to-end audit and history tracking for mutating client HTTP operations. The client remains the source of truth by persisting local audit records for every state-changing client HTTP request, while the server stores a query-oriented mirrored copy for unified cross-client history views in the web console.

The web console will add a new `任务` menu that supports both:

- a global cross-client task history view
- a single-client filtered task history view

This first version audits request-level execution summaries plus redacted parameter summaries for all mutating client HTTP operations, not only `/jobs/*`.

## User Decisions Captured

This design reflects the following confirmed choices:

1. **Storage model:** client local record + server mirrored aggregate (`方案 B`)
2. **Audit scope:** all mutating client HTTP operations (`方案 C`)
3. **UI scope:** both global view and single-client view (`方案 C`)
4. **Record granularity:** request summary + redacted parameter summary (`方案 B`)
5. **Actor identification:** source + identity summary (`方案 B`)

## Goals

1. Persist a local audit record on the client for every mutating client HTTP operation.
2. Mirror a normalized summary of those records to the server for centralized querying.
3. Support a new `任务` menu in the web console.
4. Support both global and single-client history views.
5. Record successful, failed, and cancelled operations.
6. Preserve sensitive-data boundaries by storing summaries instead of raw bodies or secrets.
7. Keep the server mirror idempotent and retry-safe.
8. Fit into the current client HTTP architecture without reintroducing server-side data-plane proxying.

## Non-goals

1. Do not centralize full stdout/stderr streams into the server audit table.
2. Do not store raw file contents, upload bodies, script contents, or secret env values in the server mirror.
3. Do not replace the existing job runtime model with the audit model.
4. Do not add a full user-account identity system in this iteration.
5. Do not add real-time streaming task dashboards in this iteration.
6. Do not require every audit-sync failure to fail the original business request.

## Terminology

### Task record

In this design, a `task` means one mutating client HTTP request plus its execution result. This includes more than `/jobs/*`.

Examples:

- `POST /jobs/command`
- `POST /jobs/script`
- `POST /jobs/:id/cancel`
- `PUT /files/write`
- `POST /files/upload`
- `POST /files/mkdir`
- `DELETE /files`
- `POST /files/move`
- `POST /files/copy`
- `POST /frp/mappings`
- `DELETE /frp/mappings/:id`

### Source of truth

The client-local audit record is the source of truth. The server-side record is a mirrored query projection.

## Current Codebase Context

The current codebase already provides:

- client HTTP mutating routes in:
  - `apps/client/src/runtime/control-http/job-routes.ts`
  - `apps/client/src/runtime/control-http/file-routes.ts`
  - `apps/client/src/runtime/control-http/frp-routes.ts`
- server audit infrastructure for admin-side events via:
  - `apps/server/src/modules/audit/audit.service.ts`
  - `apps/server/src/db/migrate.ts`
- web console routing and navigation via:
  - `apps/web/src/App.tsx`
  - `apps/web/src/components/AppLayout.tsx`
  - `apps/web/src/pages/ClientsPage.tsx`

The new feature should extend these structures rather than invent a separate product path.

## Scope

### In scope

All mutating client HTTP operations:

- jobs
  - `POST /jobs/command`
  - `POST /jobs/script`
  - `POST /jobs/:jobId/cancel`
- files
  - `PUT /files/write`
  - `POST /files/upload`
  - `POST /files/mkdir`
  - `DELETE /files`
  - `POST /files/move`
  - `POST /files/copy`
- frp mappings
  - `POST /frp/mappings`
  - `DELETE /frp/mappings/:id`

### Out of scope

Read-only routes such as:

- `GET /jobs/:id`
- `GET /jobs/:id/logs`
- `GET /jobs/:id/events`
- `GET /files`
- `GET /files/stat`
- `GET /files/read`
- `GET /files/download`
- `GET /frp/mappings`

## Architecture

```text
Caller ──HTTP──> client control service
                  │
                  ├─ execute mutating operation
                  ├─ persist local audit record (source of truth)
                  ├─ async mirror summary to server
                  ▼
                server aggregate task history store
                  │
                  ▼
               web console task history UI
```

### Client responsibilities

The client is responsible for:

- identifying mutating requests that require auditing
- extracting actor/source context
- executing the business operation
- persisting a local structured audit record
- attempting asynchronous mirror upload to the server
- marking sync success or sync failure locally

### Server responsibilities

The server is responsible for:

- accepting mirrored task audit records from clients
- validating and idempotently storing them
- serving query APIs for the web console
- supporting cross-client and single-client history views

### Web responsibilities

The web console is responsible for:

- adding a `任务` navigation entry
- listing recent task history across all clients
- filtering to a specific client
- showing record details without exposing raw sensitive content

## High-level Request Flow

For each mutating client HTTP request:

1. Caller sends request to the client HTTP service.
2. Client resolves source and actor summary.
3. Client executes the business action.
4. Client builds an audit record using request summary + result summary.
5. Client persists the audit record locally.
6. Client asynchronously uploads a mirrored summary to the server.
7. Server stores the mirrored summary idempotently.
8. Web console queries the server-side mirror for display.

### Failure flow

If the business action fails:

- the client still writes a local audit record
- status is `failed`
- error summary is captured
- client still attempts mirror upload to the server

### Mirror-sync failure flow

If local persistence succeeds but mirror sync fails:

- the business response is still returned normally
- the local record remains available
- the local sync status becomes `sync_failed`
- future retry or replay logic may reconcile it later

## Audit Data Model

## Client-local record

The client-local store should be the richer model.

### Identity and correlation fields

- `recordId`: globally unique audit record ID generated by client
- `clientId`
- `requestId`: per-request correlation ID
- `jobId`: optional, only for relevant job actions

### Actor fields

- `sourceType`
  - `web-console`
  - `agent-api`
  - `server-proxy`
  - `direct-client-http`
  - `unknown`
- `actorType`
  - `admin-token`
  - `agent-token`
  - `client-token`
  - `unknown-token`
- `actorLabel`
  - example: `web-console/admin-token`

### Request fields

- `resourceType`
  - `job`
  - `file`
  - `frp_mapping`
- `actionType`
  - `job.command`
  - `job.script`
  - `job.cancel`
  - `file.write`
  - `file.upload`
  - `file.mkdir`
  - `file.delete`
  - `file.move`
  - `file.copy`
  - `frp_mapping.create`
  - `frp_mapping.delete`
- `method`
- `path`
- `querySummary`
- `requestSummary`
- `targetId`

### Result fields

- `status`
  - `success`
  - `failed`
  - `cancelled`
- `httpStatus`
- `startedAt`
- `finishedAt`
- `durationMs`
- `errorCode`
- `errorMessage`
- `resultSummary`

### Mirror-sync fields

- `syncStatus`
  - `pending`
  - `synced`
  - `sync_failed`
- `syncedAt`
- `syncError`

### Extension field

- `metadata`: small structured extension object for future additions

## Server mirrored record

The server-side record should be query-oriented.

- `recordId` (unique; idempotency key)
- `clientId`
- `clientNameSnapshot`
- `requestId`
- `jobId`
- `resourceType`
- `actionType`
- `targetId`
- `sourceType`
- `actorType`
- `actorLabel`
- `status`
- `httpStatus`
- `startedAt`
- `finishedAt`
- `durationMs`
- `requestSummary`
- `resultSummary`
- `errorCode`
- `errorMessage`
- `reportedAt`
- `receivedAt`

### Relationship between local and mirrored records

- local client record is richer and authoritative
- mirrored server record is optimized for list/detail query
- `recordId` links both copies
- duplicate uploads are handled by server idempotency on `recordId`

## Redaction and Summary Rules

The system must store useful summaries without leaking secrets or large payloads.

### Allowed summary content

- job runtime type
- command name and a shortened args summary
- cwd
- timeoutMs
- rootId
- relative file paths
- mapping name / type / localPort / remotePort
- result size and simple structured result fields

### Must not store raw values centrally

- bearer tokens
- authorization headers
- env values
- raw script body in the server mirror
- file upload body
- file write content
- large raw output streams

### Summary strategy

- `script`: store runtime + length + optional short prefix summary if safe
- `command`: store command + shortened args summary
- `env`: store keys only, not values
- `file.write` / `file.upload`: store path, file name, and size only
- long error messages: truncate to bounded length for list/detail safety

## Storage Strategy

### Client-side storage

The client must use structured persistent storage rather than loose text logs.

Preferred option:

- local SQLite-backed structured store

Acceptable fallback if implementation constraints require lighter first step:

- structured JSONL store with a clear migration path

The client store must support:

- append new records
- update sync status for existing records
- bounded query for future client-side inspection or retry logic

### Server-side storage

The server already uses SQLite (`sql.js`) and migration-based schema evolution. This feature should add a dedicated task-audit mirror table rather than overloading the existing generic `audit_logs` table.

Reasoning:

- existing `audit_logs` is a lightweight generic admin event log
- task history needs richer query fields and filters
- a dedicated table keeps pagination, filters, and detail queries simpler

## Client-side Audit Components

The client should introduce three focused responsibilities.

### Audit context resolver

Responsible for extracting:

- sourceType
- actorType
- actorLabel
- request summary
- targetId

This avoids duplicating audit-field assembly across jobs/files/frp route files.

### Audit recorder

Responsible for:

- creating audit records
- writing the local source-of-truth record
- updating sync status after mirror attempts

### Audit sync reporter

Responsible for:

- uploading mirrored summaries to the server
- handling success/failure of upload
- enabling future retry or batch replay

## API Design

## Client mutating routes

Existing mutating routes keep their business contract and gain audit integration.

The recommended sequence per audited route is:

1. resolve audit context
2. execute business logic
3. build record summary from request + result
4. persist local audit record
5. trigger asynchronous mirror upload
6. return business response

This integration applies to:

- `apps/client/src/runtime/control-http/job-routes.ts`
- `apps/client/src/runtime/control-http/file-routes.ts`
- `apps/client/src/runtime/control-http/frp-routes.ts`

## Client -> server mirror upload API

Add a dedicated server endpoint for mirrored task audit records.

```http
POST /api/client-audit/records
Authorization: Bearer <server-internal-token>
```

Characteristics:

- intended for client-to-server mirror upload
- not intended for direct web usage
- separate from generic admin APIs
- must be schema-validated and idempotent

### Example payload

```json
{
  "recordId": "car_01...",
  "clientId": "dev-client-01",
  "requestId": "req_01...",
  "jobId": null,
  "resourceType": "file",
  "actionType": "file.write",
  "targetId": "workspace:src/index.ts",
  "sourceType": "web-console",
  "actorType": "admin-token",
  "actorLabel": "web-console/admin-token",
  "method": "PUT",
  "path": "/files/write",
  "requestSummary": {
    "rootId": "workspace",
    "path": "src/index.ts",
    "size": 312
  },
  "resultSummary": {
    "size": 312
  },
  "status": "success",
  "httpStatus": 200,
  "startedAt": 1710000000000,
  "finishedAt": 1710000000188,
  "durationMs": 188,
  "errorCode": null,
  "errorMessage": null,
  "reportedAt": 1710000000192
}
```

## Server mirror ingest behavior

For each mirror upload:

1. validate authentication
2. validate schema
3. check `recordId`
4. insert if missing
5. if already present, treat as idempotent success
6. return success response

This keeps mirror upload retry-safe and simple.

## Web query APIs

### Global and filtered list

```http
GET /api/tasks
```

Supported query parameters:

- `clientId`
- `status`
- `resourceType`
- `actionType`
- `sourceType`
- `from`
- `to`
- `keyword`
- `page`
- `pageSize`

Behavior:

- default sort: newest first
- supports all-client global view
- supports single-client filtered view using `clientId`

### Record detail

```http
GET /api/tasks/:recordId
```

Returns:

- task summary fields
- request summary
- result summary
- error summary
- related client info snapshot
- related `jobId` if present

### Optional future raw-client inspection endpoint

A future extension may add client-source-of-truth inspection such as:

```http
GET /api/clients/:clientId/tasks/raw
```

This is not required for the first UI release and should not block the central mirror design.

## Actor Identification Strategy

The design requires source + identity summary, not just token type.

### Source classification

- `web-console`
- `agent-api`
- `server-proxy`
- `direct-client-http`
- `unknown`

### Actor classification

- `admin-token`
- `agent-token`
- `client-token`
- `unknown-token`

### Actor label

A display-friendly string composed from both, for example:

- `web-console/admin-token`
- `agent-api/agent-token`
- `direct-client-http/client-token`

### Trusted context propagation

If current direct client HTTP auth is too simple to distinguish callers, server-mediated callers should attach trusted context headers such as:

- `x-rag-source`
- `x-rag-actor-type`

Client behavior:

- if trusted caller context is present from an approved path, use it
- otherwise default direct calls to:
  - `sourceType=direct-client-http`
  - `actorType=client-token`

## UI Design

## Navigation

Add a first-level `任务` item to the left navigation.

Proposed order:

- 仪表盘
- 客户端
- 任务
- 端口映射

## Main page

Add a dedicated `TasksPage`.

This page handles both:

- global cross-client list view
- single-client filtered view

The page should be reused instead of creating separate global and per-client pages.

## Page entry paths

### Global view

Entry:

- click `任务` in left navigation

Behavior:

- shows all clients by default
- supports filters for client, status, resource type, action type, source type, and time range

### Single-client view

Entry:

- choose a client from the page filter, or
- click a `任务` action from the client list

Behavior:

- reuses the same `TasksPage`
- applies `clientId` filter automatically

## Task list columns

Recommended first-version columns:

- time
- client
- source
- action
- target
- status
- duration
- result summary
- action button (`查看详情`)

### Column meaning

- **time**: use `finishedAt` or `startedAt`, newest first
- **client**: show client name with client ID context
- **source**: show `actorLabel`
- **action**: show normalized `actionType`
- **target**: show target summary (`jobId`, path summary, mapping name/ID)
- **status**: `success`, `failed`, `cancelled`
- **duration**: show `durationMs`, with compact formatting
- **result summary**: short response or failure summary

## Filters

First-version filters should include:

- client
- status
- resource type
- action type
- source
- time range
- keyword

Keyword search may remain a simple fuzzy match over common visible fields in the first version.

## Detail presentation

Use a right-side `Drawer` rather than a separate detail page.

Reasoning:

- preserves list/filter context
- better for rapid inspection workflows
- lower navigation overhead for first release

### Drawer sections

#### Basic info

- recordId
- clientId / clientName
- requestId
- jobId
- resourceType
- actionType
- status
- sourceType / actorType / actorLabel

#### Time info

- startedAt
- finishedAt
- durationMs
- reportedAt
- receivedAt

#### Request summary

Read-only redacted summary for the request.

#### Result and error summary

- resultSummary
- httpStatus
- errorCode
- errorMessage

Failures should be visually emphasized.

## Client page integration

`apps/web/src/pages/ClientsPage.tsx` should add a `任务` action button per client row.

Target behavior:

- clicking the button opens `TasksPage` filtered to that client

This keeps the navigation pattern aligned with existing `详情`, `文件`, and `映射` actions.

## Refresh and pagination

First-version behavior:

- manual refresh
- paginated list
- newest-first sorting
- no real-time auto-refresh required

## Error Handling

## Priority order

1. preserve correct business execution behavior
2. preserve client-local source-of-truth audit write when possible
3. mirror to server on a best-effort async basis

## Business success + mirror failure

If business execution succeeds but server mirror upload fails:

- do not fail the original business request
- keep the client-local record
- set `syncStatus=sync_failed`
- allow future retry/reconciliation

## Business failure

If business execution fails:

- still write a client-local record
- still attempt server mirror upload
- store `status=failed`
- store structured error summary

## Local audit write failure

If client-local audit persistence fails:

- do not automatically convert a successful business result into a failure
- emit a high-priority client runtime error log
- preserve enough log context for investigation
- consider future health/alerting extension

## Duplicate upload

If the same record is uploaded multiple times:

- server uses `recordId` uniqueness
- duplicate upload returns idempotent success
- no duplicate task records are created

## Sensitive or oversized payloads

For large or sensitive inputs:

- store summaries only
- truncate overly long fields
- never store raw secrets

## Testing Strategy

Testing should cover schemas, client behavior, server behavior, and integrated flows.

## Shared/schema tests

Validate:

- task audit payload schemas
- task query schemas
- redacted summary structures
- enum boundaries and required fields

## Client tests

Validate:

1. `job.command` success creates local record with `success`
2. `job.script` failure creates local record with `failed`
3. `file.write` stores summary only, not raw content
4. `file.upload` stores path/name/size summary only
5. `frp_mapping.create` stores mapping summary
6. successful mirror upload marks local record as `synced`
7. failed mirror upload marks local record as `sync_failed`

## Server tests

Validate:

1. mirrored task record insert succeeds
2. duplicate `recordId` upload is idempotent
3. `GET /api/tasks` returns newest-first list
4. `GET /api/tasks?clientId=...` filters correctly
5. `GET /api/tasks?status=failed` filters correctly
6. `GET /api/tasks/:recordId` returns detail payload

## Web tests

Validate:

1. left nav shows `任务`
2. `TasksPage` loads unified list
3. client list `任务` button opens filtered view
4. detail drawer opens and renders record fields
5. filters trigger the expected API query behavior

## Integration / E2E tests

At least one full path should verify:

1. trigger a mutating client HTTP operation
2. client executes business action
3. client writes local audit record
4. client mirrors summary to server
5. server query API returns the new record
6. returned data shape matches web expectations

## Acceptance Criteria

The feature is complete for this iteration when all of the following are true:

1. all mutating client HTTP routes are audited
2. client-local records persist structured history
3. server stores mirrored task history records
4. web console exposes a `任务` menu
5. web console supports both global and single-client history views
6. failed operations appear in history
7. sensitive fields are redacted or summarized
8. relevant verification commands and tests pass

## Risks and Constraints

1. Current client HTTP auth may need trusted caller context propagation to distinguish sources reliably.
2. `/jobs/*` is asynchronous runtime work; auditing the request to create/cancel a job is not identical to storing full job lifecycle state.
3. If a lightweight client-local storage implementation is chosen first, it must still leave room for future retry/query needs.
4. The `任务` label is product-friendly, but internally the feature covers file and FRP mutations too; UI copy should remain clear.

## Recommended Implementation Direction

Proceed with:

- client-local structured audit persistence as source of truth
- asynchronous mirrored upload to a dedicated server task-audit endpoint
- dedicated server-side task history table and query APIs
- a reusable `TasksPage` plus detail `Drawer`
- per-client entry from `ClientsPage`

This provides the smallest complete version that satisfies audit, cross-client visibility, and future extensibility.
