# Client HTTP Control Plane Design

Date: 2026-06-03

## Summary

Remote Agent Gateway will switch its formal operation path from server-dispatched WebSocket tasks to a client-hosted HTTP/SSE API exposed through FRP. The server remains responsible for client discovery, registration, heartbeat, sticky port allocation, FRP configuration coordination, token coordination, and lightweight admin orchestration. File transfer, script execution output, job logs, SSE streams, and other high-volume operation traffic must go directly through `frps -> frpc -> client HTTP`, not through the server application.

The primary goal is to serve AI Agents efficiently without consuming server application bandwidth for client operations.

## Goals

1. Client starts a local HTTP control service during startup.
2. Client registers with server over WebSocket and receives FRP + HTTP control coordination data.
3. Server assigns each client a sticky TCP remote port for the client HTTP service.
4. Client starts exactly one `frpc` process that includes the system HTTP control mapping and any business mappings.
5. AI Agents discover `clientHttpBaseUrl` and `clientHttpToken` from server, then call client HTTP directly.
6. Script and command execution use asynchronous jobs with mandatory SSE events for real-time AI Agent output.
7. File operations run through direct client HTTP endpoints and do not proxy through the server application.
8. Server admin UI can perform lightweight client management by calling client HTTP, while avoiding large body or long stream proxying.
9. The admin UI is rebuilt with React and a mainstream UI framework, replacing the current single-file HTML console with maintainable routed modules.
10. The old task/WebSocket execution path is removed from the formal product model.

## Non-goals

- Server will not proxy file upload/download bodies.
- Server will not proxy job stdout/stderr streams.
- Server will not proxy client SSE connections.
- First version will not provide cross-client distributed scheduling.
- First version will not persist job state across client process restarts.
- First version will use TCP remote port URLs, not domain/subdomain-based HTTP FRP routing.

## Frontend Admin UI

The current single-file `apps/server/src/web/index.html` console is not maintainable for the new model. The admin UI should be rebuilt as a React application with a mainstream UI framework.

Recommended stack:

```text
React + Vite + TypeScript + Ant Design
```

Reasons:

- React and Vite fit the existing TypeScript/Node toolchain.
- Ant Design provides mature tables, forms, modals, tabs, status tags, layout, and admin-console patterns.
- Multi-file React modules make client discovery, mapping management, job tools, and future maintenance clearer than a single HTML file.

Frontend structure should be modular:

```text
apps/web/src/
├── main.tsx
├── App.tsx
├── api/
│   ├── http.ts
│   ├── clients.ts
│   └── adminClientHttp.ts
├── pages/
│   ├── DashboardPage.tsx
│   ├── ClientsPage.tsx
│   ├── ClientDetailPage.tsx
│   └── MappingsPage.tsx
├── components/
│   ├── AppLayout.tsx
│   ├── StatusTag.tsx
│   └── TokenLogin.tsx
└── styles/
    └── theme.css
```

First-version UI pages:

- Login/token entry.
- Dashboard with online client count and HTTP-ready count.
- Clients list showing online status, `httpReady`, `clientHttpBaseUrl`, capabilities, and actions.
- Client detail showing discovery data and direct HTTP endpoint information.
- FRP business mapping management through server lightweight admin APIs.

The UI must not route large file bodies or SSE streams through the server. For direct client operations, it should display direct client URLs or call lightweight server admin endpoints only where the spec permits.

Build/distribution should compile React static assets and serve them from the server. The old `index.html` can be replaced by generated assets or kept only as a minimal fallback during migration.

## Architecture

The system has two planes:

```text
Control plane: client <──WebSocket──> server
Data plane:    AI Agent <──HTTP/SSE via frps/frpc──> client HTTP service
```

### Server Responsibilities

Server is responsible for:

- Client registration, heartbeat, and online status.
- Sticky remote port allocation for the client HTTP control endpoint.
- FRP connection configuration coordination.
- Client HTTP token generation and rotation coordination.
- Client discovery APIs.
- Lightweight admin orchestration for small JSON management operations.
- Audit logging for admin management actions.

Server is not responsible for:

- Running client operations through WebSocket tasks.
- Proxying file contents.
- Proxying script output.
- Proxying SSE events.
- Maintaining task execution state as the formal operation path.

### Client Responsibilities

Client is responsible for:

- Starting a local HTTP control service.
- Registering with server over WebSocket.
- Receiving FRP and HTTP control coordination data.
- Starting and maintaining exactly one `frpc` process.
- Exposing direct HTTP APIs for health, jobs, files, and FRP mapping management.
- Providing SSE streams for job output and status events.
- Enforcing client HTTP bearer-token authorization.

### AI Agent Flow

1. AI Agent calls server discovery API:

```text
GET /api/clients/:id
Authorization: Bearer <server token>
```

2. Server returns:

```json
{
  "id": "dev-client-01",
  "status": "online",
  "httpReady": true,
  "clientHttpBaseUrl": "http://your-server-ip:20317",
  "clientHttpToken": "client-specific-token"
}
```

3. AI Agent calls client directly:

```text
POST http://your-server-ip:20317/jobs/command
Authorization: Bearer <clientHttpToken>
```

4. AI Agent reads realtime output directly from client HTTP through FRP:

```text
GET http://your-server-ip:20317/jobs/:jobId/events
Authorization: Bearer <clientHttpToken>
Accept: text/event-stream
```

## Startup and Coordination Flow

Client startup sequence:

```text
1. Load client.config.yaml
2. Start local HTTP control service
3. Connect server WebSocket
4. Send client.register
5. Server coordinates HTTP control endpoint
6. Server replies with FRP config, remote port, base URL, and token
7. Client writes combined frpc config
8. Client starts the single frpc process
9. Client sends client.http_ready or client.http_failed
10. Server updates discovery state
```

### Client Registration Payload

`client.register` extends existing client metadata with local HTTP information and capabilities:

```json
{
  "clientId": "dev-client-01",
  "name": "Development Machine",
  "hostname": "host-a",
  "os": "win32",
  "arch": "x64",
  "version": "0.1.0",
  "tags": ["dev"],
  "http": {
    "localHost": "127.0.0.1",
    "localPort": 17890,
    "protocol": "http"
  },
  "capabilities": {
    "httpControl": true,
    "jobs": true,
    "sse": true,
    "files": true,
    "frpMappings": true
  }
}
```

### Server Coordination Response

`server.ack` includes HTTP control coordination data:

```json
{
  "message": "registered",
  "frp": {
    "serverAddr": "your-server-ip",
    "serverPort": 7000,
    "authToken": "frp-token"
  },
  "httpControl": {
    "localHost": "127.0.0.1",
    "localPort": 17890,
    "remotePort": 20317,
    "publicBaseUrl": "http://your-server-ip:20317",
    "token": "client-specific-token"
  }
}
```

### System HTTP Control Mapping

Client creates a protected TCP proxy for its HTTP control service:

```toml
[[proxies]]
name = "rag-dev-client-01-http-control"
type = "tcp"
localIP = "127.0.0.1"
localPort = 17890
remotePort = 20317
```

Rules:

- Every client has at most one HTTP control mapping.
- The control mapping is protected and cannot be deleted by normal business mapping APIs.
- The control mapping is maintained automatically during startup.
- The control mapping is the formal entry point for direct client HTTP/SSE operations.

## Sticky Port Allocation

Server owns remote-port coordination.

Allocation rules:

1. Read existing `clients.http_remote_port` as preferred port.
2. If preferred port exists, reuse it when all checks pass:
   - It is inside configured FRP port range.
   - It is not used by another client's `http_remote_port`.
   - It is not used by business mappings in `port_mappings.remote_port`.
   - It is not reported as occupied by frps dashboard.
3. If preferred port is unavailable or absent, allocate a new available port.
4. Persist the selected remote port and computed base URL on the client record.
5. Return the selected port to the client.

The port is sticky, not immutable. Client restarts should keep the same remote port whenever it is not conflicting. If a real conflict is detected, server may assign a new port.

## Single frpc Process Model

A client must have exactly one managed `frpc` process. All proxies are written to one combined config:

```text
frpc-combined.toml
├── protected HTTP control mapping
├── business TCP mapping A
├── business TCP mapping B
└── future HTTP/HTTPS mappings if needed
```

When business mappings change:

1. Client HTTP API updates local mapping metadata.
2. Client regenerates the combined frpc config.
3. Client restarts the one managed `frpc` process.
4. Client returns the result.
5. If initiated through server admin UI, server records audit information.

## Client HTTP API

### Common API Rules

Base URL:

```text
http://<frpsPublicHost>:<clientHttpRemotePort>
```

Authentication:

```http
Authorization: Bearer <clientHttpToken>
```

JSON success response:

```json
{
  "ok": true,
  "data": {}
}
```

JSON error response:

```json
{
  "ok": false,
  "error": {
    "code": "INVALID_PATH",
    "message": "Path is outside allowed roots"
  }
}
```

### Health

`GET /health`

Returns authenticated client health:

```json
{
  "ok": true,
  "data": {
    "clientId": "dev-client-01",
    "status": "ready",
    "version": "0.1.0",
    "httpReady": true,
    "frpcRunning": true
  }
}
```

A separate unauthenticated `GET /ping` may return only `{ "ok": true }` for low-information probing.

### Job API

Script and command execution use async jobs.

Create command job:

```text
POST /jobs/command
```

```json
{
  "command": "node",
  "args": ["-v"],
  "cwd": ".",
  "timeoutMs": 60000,
  "env": {
    "NODE_ENV": "development"
  }
}
```

Create script job:

```text
POST /jobs/script
```

```json
{
  "runtime": "node",
  "script": "console.log('hello')",
  "cwd": ".",
  "timeoutMs": 60000
}
```

Supported runtimes in the first version:

```text
node | python | bash | powershell
```

Query job status:

```text
GET /jobs/:jobId
```

Query historical logs:

```text
GET /jobs/:jobId/logs?sinceSeq=0&limit=500
```

Cancel job:

```text
POST /jobs/:jobId/cancel
```

### SSE Events

SSE is mandatory in the first version because AI Agents are the primary users.

Connect:

```text
GET /jobs/:jobId/events
Accept: text/event-stream
Authorization: Bearer <clientHttpToken>
```

Required event types:

```text
job.started
job.stdout
job.stderr
job.status
job.completed
job.failed
job.cancelled
heartbeat
```

Example event:

```text
event: job.stdout
id: 12
data: {"jobId":"job_01H","seq":12,"content":"installing...\n","timestamp":1710000000123}
```

SSE reconnect behavior:

- Each emitted log/status event has a monotonic `seq`.
- SSE `id` uses the same sequence number where applicable.
- Client keeps an in-memory log buffer.
- Caller can recover using `Last-Event-ID` or `GET /jobs/:id/logs?sinceSeq=...`.
- Job state is not preserved across client process restarts in the first version.

Job resource limits:

```yaml
http:
  job:
    maxConcurrent: 4
    defaultTimeoutMs: 300000
    maxTimeoutMs: 1800000
    logBufferLines: 5000
```

### File API

File APIs run directly on client HTTP and reuse `workspace.allowedRoots` safety rules.

Endpoints:

```text
GET    /files/roots
GET    /files?rootId=workspace&path=.
GET    /files/stat?rootId=workspace&path=README.md
GET    /files/read?rootId=workspace&path=README.md
GET    /files/download?rootId=workspace&path=dist/app.zip
PUT    /files/write?rootId=workspace&path=src/index.ts
POST   /files/upload?rootId=workspace&path=tmp&filename=a.zip
POST   /files/mkdir
DELETE /files?rootId=workspace&path=tmp/a.zip
POST   /files/move
POST   /files/copy
```

Rules:

- Access is limited to configured allowed roots.
- Path traversal outside allowed roots is rejected.
- Large upload/download bodies go directly through FRP to the client.
- Server does not proxy file bodies.

### FRP Mapping API

Client HTTP manages business mappings while server remains the port allocator.

List mappings:

```text
GET /frp/mappings
```

Create business mapping:

```text
POST /frp/mappings
```

```json
{
  "name": "vite-dev-server",
  "type": "tcp",
  "localHost": "127.0.0.1",
  "localPort": 5173,
  "remotePort": null
}
```

If `remotePort` is null, client asks server to allocate a business port. If `remotePort` is provided, client asks server to validate and reserve it before writing the mapping.

Delete business mapping:

```text
DELETE /frp/mappings/:id
```

Rules:

- `kind=system` HTTP control mapping cannot be deleted.
- Business mappings can be created and removed through client HTTP.
- Client restarts the single `frpc` process after mapping changes.
- Client notifies server so server can persist/release business mapping records and audit changes.

## Server Data Model

### clients Table Additions

Add fields to persist HTTP control endpoint state:

```sql
ALTER TABLE clients ADD COLUMN http_local_host TEXT;
ALTER TABLE clients ADD COLUMN http_local_port INTEGER;
ALTER TABLE clients ADD COLUMN http_remote_port INTEGER;
ALTER TABLE clients ADD COLUMN http_base_url TEXT;
ALTER TABLE clients ADD COLUMN http_token TEXT;
ALTER TABLE clients ADD COLUMN http_ready INTEGER DEFAULT 0;
ALTER TABLE clients ADD COLUMN http_last_ready_at INTEGER;
ALTER TABLE clients ADD COLUMN capabilities TEXT;
```

Field meanings:

| Field | Meaning |
|---|---|
| `http_local_host` | Client local HTTP host, normally `127.0.0.1` |
| `http_local_port` | Client local HTTP port |
| `http_remote_port` | FRP remote TCP port for client HTTP control |
| `http_base_url` | Public client HTTP base URL |
| `http_token` | Client HTTP bearer token, stored or derived according to implementation choice |
| `http_ready` | Whether client reported HTTP tunnel readiness |
| `http_last_ready_at` | Last ready timestamp |
| `capabilities` | JSON client capabilities |

### port_mappings Table Additions

Business mappings continue to use `port_mappings`. Add metadata:

```sql
ALTER TABLE port_mappings ADD COLUMN kind TEXT DEFAULT 'business';
ALTER TABLE port_mappings ADD COLUMN protected INTEGER DEFAULT 0;
ALTER TABLE port_mappings ADD COLUMN source TEXT DEFAULT 'client_http';
```

Authority rule:

- `clients.http_remote_port` is the authority for each client's system HTTP control port.
- `port_mappings` is the authority for user/business mappings.

## Token Generation and Rotation

Server config adds:

```yaml
clientHttp:
  tokenSecret: "change-me-client-http-secret"
  tokenVersion: 1
  requestTimeoutMs: 10000
```

Recommended token derivation:

```text
HMAC(tokenSecret, clientId + ":" + tokenVersion)
```

This allows manual rotation by changing `tokenSecret` or `tokenVersion` in server config. On the next registration/coordination, server returns the new token and client updates its HTTP authorization requirement.

## WebSocket Protocol Changes

### Keep

```text
client.register
client.heartbeat
server.ack
server.error
```

### Add

```text
client.http_ready
client.http_failed
```

Optional future message:

```text
server.config_update
```

### Remove from Formal Operation Model

```text
task.dispatch
task.log
task.result
```

### client.http_ready

```json
{
  "type": "client.http_ready",
  "payload": {
    "clientId": "dev-client-01",
    "remotePort": 20317,
    "baseUrl": "http://your-server-ip:20317"
  }
}
```

Server sets `http_ready = 1`, records `http_last_ready_at`, and keeps the client online.

### client.http_failed

```json
{
  "type": "client.http_failed",
  "payload": {
    "clientId": "dev-client-01",
    "remotePort": 20317,
    "reason": "frpc exited with code 1"
  }
}
```

Server sets `http_ready = 0`. If a later coordination detects a conflict, server can allocate a new port.

## Server APIs

### Discovery

`GET /api/clients`

Returns client list with HTTP endpoint status but no token by default:

```json
{
  "id": "dev-client-01",
  "name": "Development Machine",
  "status": "online",
  "online": true,
  "httpReady": true,
  "clientHttpBaseUrl": "http://your-server-ip:20317",
  "clientHttpRemotePort": 20317,
  "capabilities": {
    "jobs": true,
    "sse": true,
    "files": true,
    "frpMappings": true
  },
  "lastSeenAt": 1710000000000
}
```

`GET /api/clients/:id`

Returns detail including token:

```json
{
  "id": "dev-client-01",
  "status": "online",
  "httpReady": true,
  "clientHttpBaseUrl": "http://your-server-ip:20317",
  "clientHttpToken": "client-specific-token",
  "clientHttpRemotePort": 20317,
  "capabilities": {
    "jobs": true,
    "sse": true,
    "files": true,
    "frpMappings": true
  }
}
```

Agent-facing discovery endpoints may remain:

```text
GET /api/agent/clients
GET /api/agent/clients/:id
```

Their meaning changes to discovery only.

### Lightweight Admin Management

Server admin UI can call server endpoints that perform short JSON calls to client HTTP:

```text
GET    /api/clients/:id/http/health
GET    /api/clients/:id/http/frp/mappings
POST   /api/clients/:id/http/frp/mappings
DELETE /api/clients/:id/http/frp/mappings/:mappingId
```

Rules:

- Use `clientHttpBaseUrl + clientHttpToken` internally.
- Use a short timeout such as `clientHttp.requestTimeoutMs`.
- Do not proxy files.
- Do not proxy SSE.
- Do not proxy long job logs.
- Record audit logs for mutating operations.

## Old Task System Removal

The formal product model removes server-dispatched tasks.

Deprecated/removed APIs:

```text
POST /api/tasks
GET  /api/tasks
GET  /api/tasks/:id
GET  /api/tasks/:id/logs
POST /api/agent/run-script
POST /api/agent/push-file
POST /api/agent/open-port
POST /api/agent/close-port
GET  /api/agent/tasks/:id
```

Replacement mapping:

| Old ability | New direct client HTTP entry |
|---|---|
| Execute script task | `POST <clientHttpBaseUrl>/jobs/script` |
| Execute command task | `POST <clientHttpBaseUrl>/jobs/command` |
| Task status | `GET <clientHttpBaseUrl>/jobs/:jobId` |
| Task logs | `GET <clientHttpBaseUrl>/jobs/:jobId/logs` or SSE |
| Push/write file | `PUT/POST <clientHttpBaseUrl>/files/...` |
| Open port | `POST <clientHttpBaseUrl>/frp/mappings` |
| Close port | `DELETE <clientHttpBaseUrl>/frp/mappings/:id` |

Implementation can remove route registration first and delete unused modules later, but the supported behavior must be the direct client HTTP model.

## Error Handling

### Registration and Coordination Failures

| Scenario | Behavior |
|---|---|
| No available remote port | Client remains WebSocket-online but `httpReady=false`; discovery marks HTTP unavailable |
| Missing FRP config | Registration fails or client degrades to no HTTP endpoint |
| Token generation failure | Server returns `server.error` |
| DB write failure | Registration fails; client reconnect loop retries later |

### Client HTTP Startup Failure

If local HTTP port binding fails:

- Client logs the error.
- Client sends `client.http_failed`.
- Server records `httpReady=false`.
- Client does not start the control FRP proxy.

### frpc Failure

If `frpc` startup fails:

- Client sends `client.http_failed` with remote port and reason.
- Server records `httpReady=false`.
- Client uses limited retries, not infinite restart loops.
- Next coordination may allocate a new port if conflict evidence exists.

### Client HTTP Errors

Common error codes:

```text
UNAUTHORIZED
FORBIDDEN
NOT_FOUND
INVALID_REQUEST
INVALID_PATH
CONFLICT
JOB_TIMEOUT
JOB_CANCELLED
JOB_LIMIT_EXCEEDED
FRP_CONFIG_ERROR
FRPC_RESTART_FAILED
INTERNAL_ERROR
```

### Server Admin Management Errors

If server cannot reach client HTTP:

```json
{
  "ok": false,
  "error": {
    "code": "CLIENT_HTTP_UNREACHABLE",
    "message": "Failed to reach client HTTP endpoint"
  }
}
```

No fallback to WebSocket task execution is allowed.

## Security

Client HTTP security:

- All operation APIs require bearer token authorization.
- `/health` requires token.
- Optional `/ping` may be public but returns only minimal information.
- File paths are constrained to `workspace.allowedRoots`.
- Command/script `cwd` is constrained to workspace or allowed roots.
- Job timeout, concurrency, and log-buffer limits are enforced.
- Error responses must never reveal client HTTP token.

Server discovery security:

- Client list endpoint does not return tokens by default.
- Client detail endpoint returns token only under existing server authorization.
- Production deployments must change `clientHttp.tokenSecret`.
- Token rotation occurs through `tokenSecret` or `tokenVersion` config changes.
- Mutating admin management calls are audit logged.

## Testing Strategy

### Shared Protocol and Schema Tests

- `client.register` accepts `http` and `capabilities`.
- `server.ack` accepts `httpControl`.
- `client.http_ready` and `client.http_failed` validate correctly.
- Removed task message types are no longer required by formal client/server flow.

### Server Unit Tests

- First registration allocates a new HTTP remote port.
- Re-registration reuses historical port when available.
- Historical port owned by another client causes reallocation.
- Historical port used by business mapping causes reallocation.
- Dashboard-reported occupied port causes reallocation.
- Token is stable for same `tokenSecret`, `tokenVersion`, and `clientId`.
- Token changes when `tokenVersion` changes.
- `GET /api/clients` omits token.
- `GET /api/clients/:id` returns token.
- Admin management calls include Authorization to client HTTP.
- Admin management timeout returns `CLIENT_HTTP_UNREACHABLE`.
- File and SSE proxy routes are not provided through server.

### Client Unit Tests

- HTTP service starts on configured host and port.
- Auth middleware rejects missing or invalid token.
- Command and script job creation returns queued job IDs.
- Job timeout, cancellation, and concurrency limits work.
- SSE emits stdout, stderr, completed, failed, and heartbeat events.
- `Last-Event-ID` or `sinceSeq` can recover buffered events.
- File API enforces allowed roots.
- Protected HTTP control mapping cannot be deleted.
- Business mapping changes regenerate combined frpc config.
- Only one managed `frpc` process is running.

### E2E Tests

Core E2E path:

```text
1. Start server
2. Start client
3. Client registers and receives HTTP control coordination data
4. Client starts HTTP service and frpc control tunnel
5. Server discovery returns clientHttpBaseUrl and token
6. Test process directly calls client HTTP to create command job
7. Test process receives stdout and completion through SSE
8. Test process writes and reads a file through client HTTP
9. Test process creates and deletes a business FRP mapping through client HTTP
```

## Migration Plan

1. Add client HTTP service, auth middleware, and basic health endpoint.
2. Add server-side HTTP control coordination and sticky port fields.
3. Add protected control mapping to the single frpc daemon config.
4. Add discovery fields to client APIs.
5. Implement client HTTP job API and mandatory SSE.
6. Move file operations to client HTTP.
7. Move business FRP mapping management to client HTTP.
8. Add server lightweight admin orchestration endpoints for UI maintenance.
9. Stop registering old task and operation routes.
10. Update README, API documentation, examples, and tests.

## Success Criteria

The implementation is successful when:

1. Client startup automatically obtains a sticky `clientHttpRemotePort`.
2. Client restart keeps the same remote port when there is no conflict.
3. Server reallocates only when the previous port conflicts.
4. Each client has exactly one managed `frpc` process.
5. Server discovery exposes client HTTP address and detail-token information.
6. AI Agent can create a job by calling client HTTP directly.
7. AI Agent receives real-time stdout/stderr and completion through SSE.
8. File upload/download traffic does not pass through the server application.
9. Server admin UI can manage client business FRP mappings with lightweight JSON calls.
10. WebSocket is limited to registration, heartbeat, and configuration coordination.
11. Old task/WebSocket execution path is not part of the supported operation model.
