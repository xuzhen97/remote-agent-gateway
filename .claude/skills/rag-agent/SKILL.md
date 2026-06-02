---
name: rag-agent
description: "Use when a user needs to control remote machines through Remote Agent Gateway: list clients, run scripts or commands, manage files, create port mappings and tunnels, push files, or query task status."
---

# Remote Agent Gateway Agent Skill

Use the bundled **Node CLI** first. It reads one unified config and wraps the Gateway HTTP API so agents do not need to hand-write curl JSON.

## Pick the CLI Command

Prefer whichever command exists in the current project:

```bash
# If this is the remote-agent-gateway repository:
RAG="node scripts/rag.mjs"

# If this skill is installed in a target project:
RAG="node .pi/skills/rag-agent/scripts/rag.mjs"

# If user installed the CLI on PATH:
RAG="rag"
```

Always start with:

```bash
$RAG config
$RAG clients
```

## Unified Configuration

Recommended configuration is user-level environment variables. This is safest and does not pollute the codebase.

### Option 1: Environment Variables (Recommended ✅)

Windows PowerShell:

```powershell
[Environment]::SetEnvironmentVariable("RAG_SERVER_URL", "http://your-server:3000", "User")
[Environment]::SetEnvironmentVariable("RAG_AGENT_TOKEN", "test_agent_token", "User")
```

Restart the terminal or agent session after setting user-level variables.

Current development default token is supported:

```text
test_agent_token
```

### Config Resolution Order

The Node CLI resolves config in this order:

1. CLI flags: `--server <url>` and `--token <token>`
2. Environment variables: `RAG_SERVER_URL`, `RAG_AGENT_TOKEN`, `RAG_AGENT_API_TOKEN`, `AGENT_API_TOKEN`
3. `.ragrc` in the current directory or parent directories
4. `.env` in the current directory or parent directories
5. `client.config.yaml`: `server.apiBaseUrl` + `server.token`
6. `server.config.yaml`: `server.port` + `auth.agentApiToken`

### Option 2: File-Based `.ragrc`

```bash
RAG_SERVER_URL=http://localhost:3000
RAG_AGENT_TOKEN=test_agent_token
```

## Core Commands

### Clients

```bash
$RAG clients
$RAG client <clientId>
```

### Execute Remote Script

```bash
$RAG exec <clientId> 'console.log(process.platform)'
$RAG exec-file <clientId> ./script.js
$RAG task <taskId>
$RAG wait <taskId> --interval 2000 --timeout 120000
```

### Remote Files

The CLI auto-creates and closes file sessions for these commands:

```bash
$RAG ls <clientId> [path] [rootId]
$RAG read <clientId> <path> [rootId]
$RAG write <clientId> <path> 'content' [rootId]
echo 'content' | $RAG write <clientId> <path> [rootId]
cat app.jar | $RAG write <clientId> D:/apps/app.jar root-1  # stdin stays binary-safe
$RAG mkdir <clientId> <path> [rootId]
$RAG rm <clientId> <path> [rootId]
$RAG mv <clientId> <from> <to> [rootId]
$RAG cp <clientId> <from> <to> [rootId]
```

Default `rootId` is `root-0`. Use `$RAG session <clientId>` to inspect available roots.

### Manual File Session

Use this for many file operations or direct API access:

```bash
$RAG session <clientId>          # returns publicUrl, token, roots
$RAG session-close <clientId>
```

### Port Mapping

```bash
$RAG open-port <clientId> <name> <localPort> [remotePort] [tcp|http|https]
$RAG close-port <mappingId>
```

Examples:

```bash
$RAG open-port client-1 ssh 22 2222 tcp
$RAG open-port client-1 web 8080 8080 http
```

### Push Server-Stored File

```bash
$RAG push <clientId> <fileId> <targetPath>
```

## Agent Workflow

1. Run `$RAG config` and verify `serverUrl` + masked token.
2. Run `$RAG clients`; choose an online client.
3. For commands/scripts, run `$RAG exec ...`, capture the returned `taskId`, then `$RAG wait <taskId>`.
4. For files, use `$RAG ls/read/write/...`; for bulk operations, create a manual session.
5. For tunnels, record the returned `mappingId` and close it when done.

## Fallback HTTP API

Only use curl if the Node CLI is unavailable.

```bash
AUTH="Authorization: Bearer $RAG_AGENT_TOKEN"
BASE="$RAG_SERVER_URL"

curl -sS -H "$AUTH" "$BASE/api/agent/clients"

curl -sS -X POST -H "$AUTH" -H 'Content-Type: application/json' \
  -d '{"target":{"clientId":"client-1"},"script":"console.log(process.platform)","timeoutMs":60000}' \
  "$BASE/api/agent/run-script"

curl -sS -X POST -H "$AUTH" -H 'Content-Type: application/json' \
  -d '{"clientId":"client-1"}' "$BASE/api/agent/file-session"
```

## API-to-CLI Map

| API | CLI |
|---|---|
| `GET /api/agent/clients` | `$RAG clients` |
| `GET /api/agent/clients/:id` | `$RAG client <id>` |
| `POST /api/agent/run-script` | `$RAG exec <id> <script>` |
| `GET /api/agent/tasks/:id` | `$RAG task <taskId>` |
| `POST /api/agent/file-session` | `$RAG session <id>` |
| `DELETE /api/agent/file-session` | `$RAG session-close <id>` |
| Direct file `/v1/list/read/write/...` | `$RAG ls/read/write/...` |
| `POST /api/agent/open-port` | `$RAG open-port ...` |
| `POST /api/agent/close-port` | `$RAG close-port <mappingId>` |
| `POST /api/agent/push-file` | `$RAG push <id> <fileId> <path>` |

## Notes

- Node 22+ is recommended; the CLI uses built-in `fetch` and ESM.
- The target project should keep `.ragrc` out of commits if it contains real tokens.
- File sessions expire; CLI-managed file operations create/close sessions automatically.
