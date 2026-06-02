---
name: rag-agent
description: Control remote machines via the Remote Agent Gateway platform. Use when you need to execute scripts, manage files, create port mappings, or query client status on remote machines. Triggers: user mentions remote machines, wants to run commands on another computer, needs to access files on a remote machine, or wants to expose a local port.
---

# Remote Agent Gateway — AI Agent Skill

Control remote machines via HTTP API. All endpoints use Bearer token auth with `AGENT_API_TOKEN`.

## Configuration

Set these environment variables or provide them when asked:

- `RAG_SERVER_URL` — Gateway server URL (e.g. `http://localhost:3000`)
- `RAG_AGENT_TOKEN` — Agent API token (the `AGENT_API_TOKEN` value from server config)

All API calls: `Authorization: Bearer <RAG_AGENT_TOKEN>`

## Typical Workflow

```
1. GET  /api/agent/clients              -> Find target machine
2. POST /api/agent/file-session         -> Get direct file access URL + token
3. Use {publicUrl} + Authorization header to operate files directly
4. POST /api/agent/run-script           -> Execute commands (optional)
5. POST /api/agent/open-port / close-port -> Manage tunnels (optional)
6. GET  /api/agent/tasks/:taskId        -> Check task status
```

## API Reference

### Clients

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/agent/clients` | List all clients (online + offline) |
| GET | `/api/agent/clients/:clientId` | Get single client details |

Response fields: `id`, `name`, `hostname`, `os`, `arch`, `tags[]`, `status`, `online`, `lastSeenAt`

### File Session (Direct Connect)

| Method | Path | Description |
|--------|------|-------------|
| POST | `/api/agent/file-session` | Create/reuse file session |
| DELETE | `/api/agent/file-session` | Stop file session |

**POST `/api/agent/file-session`**

Request:
```json
{ "clientId": "client-1" }
```

Response:
```json
{
  "clientId": "client-1",
  "publicUrl": "http://frps.example.com:23001",
  "token": "file_abc123",
  "localPort": 45123,
  "mappingId": "pm_file",
  "startedAt": 1748800000000,
  "expiresAt": 1748801800000,
  "roots": [
    { "id": "root-0", "label": "workspace", "path": "/home/user/workspace" }
  ]
}
```

**After getting the session, operate files directly via `publicUrl`:**

All direct requests need header: `Authorization: Bearer {token}`

| Method | URL | Description |
|--------|-----|-------------|
| GET | `{publicUrl}/v1/roots` | List browsable roots |
| GET | `{publicUrl}/v1/list?rootId=root-0&path=.` | List directory |
| GET | `{publicUrl}/v1/stat?rootId=root-0&path=file.txt` | File stat |
| GET | `{publicUrl}/v1/read?rootId=root-0&path=file.txt` | Read file content |
| GET | `{publicUrl}/v1/download?rootId=root-0&path=file.txt` | Download file |
| PUT | `{publicUrl}/v1/write?rootId=root-0&path=file.txt` | Write file content |
| POST | `{publicUrl}/v1/upload?rootId=root-0&path=.&filename=f` | Upload file |
| POST | `{publicUrl}/v1/mkdir` | Create directory |
| DELETE | `{publicUrl}/v1/delete?rootId=root-0&path=dir&recursive=true` | Delete |
| POST | `{publicUrl}/v1/move` | Move/rename |
| POST | `{publicUrl}/v1/copy` | Copy |

**DELETE `/api/agent/file-session`**

Request: `{ "clientId": "client-1" }`
Response: `{ "success": true }`

### Script Execution

**POST `/api/agent/run-script`**

```json
{
  "target": { "clientId": "client-1" },
  "script": "console.log('hello')",
  "timeoutMs": 30000
}
```

Response: task object with `id`. Poll `GET /api/agent/tasks/:taskId` for result.

### Port Mapping

**POST `/api/agent/open-port`**

```json
{
  "clientId": "client-1",
  "name": "ssh",
  "localPort": 22,
  "remotePort": 2222,
  "type": "tcp"
}
```

**POST `/api/agent/close-port`**

```json
{ "mappingId": "pm_abc" }
```

### File Push (Server-Hosted Files)

**POST `/api/agent/push-file`** — Push a file previously uploaded to server storage (`/api/files`) to a client.

```json
{
  "clientId": "client-1",
  "fileId": "file_xyz",
  "targetPath": "/home/user/deploy.tar.gz"
}
```

### Task Status

**GET `/api/agent/tasks/:taskId`**

Returns task with logs:
```json
{
  "id": "task_1",
  "clientId": "client-1",
  "type": "exec_script",
  "status": "success",
  "result": { ... },
  "logs": [
    { "stream": "stdout", "content": "hello\n", "createdAt": 1748800000000 }
  ]
}
```

## Common Patterns

### List remote files
```
1. GET /api/agent/clients -> pick online client
2. POST /api/agent/file-session { "clientId": "client-1" }
3. GET {publicUrl}/v1/roots -> see available roots
4. GET {publicUrl}/v1/list?rootId=root-0&path=. -> browse files
```

### Download a file from remote machine
```
1. POST /api/agent/file-session { "clientId": "client-1" }
2. GET {publicUrl}/v1/read?rootId=root-0&path=config.yaml
   -> Returns file content directly
```

### Upload a file to remote machine
```
1. POST /api/agent/file-session { "clientId": "client-1" }
2. PUT {publicUrl}/v1/write?rootId=root-0&path=deploy.sh
   Headers: Authorization: Bearer {token}, Content-Type: application/octet-stream
   Body: file content
```
Or use upload for multi-part:
```
2. POST {publicUrl}/v1/upload?rootId=root-0&path=.&filename=deploy.sh
   Headers: Authorization: Bearer {token}, Content-Type: application/octet-stream
   Body: file content
```

### Execute a remote script
```
1. POST /api/agent/run-script { "target": { "clientId": "client-1" }, "script": "ls -la" }
2. GET /api/agent/tasks/{taskId} -> check result
```

### Expose a local port publicly
```
1. POST /api/agent/open-port { "clientId": "client-1", "name": "web", "localPort": 8080, "type": "tcp" }
   -> Returns mapping with publicUrl
2. When done: POST /api/agent/close-port { "mappingId": "pm_xxx" }
```

## Notes

- File sessions expire after 30 minutes. Re-call `POST /api/agent/file-session` to renew.
- Direct file operations via `publicUrl` bypass the server - no server bandwidth consumed.
- If direct connection to `publicUrl` is not possible, fall back to proxied endpoints at `/api/clients/:clientId/files/*`.
- `push-file` pushes files from server storage, not from your local machine. For local file upload, use the direct `publicUrl` approach.
