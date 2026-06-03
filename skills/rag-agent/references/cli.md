# RAG CLI Reference

## Installation

### Option 1: Use within the repo (no extra install)

```bash
cd remote-agent-gateway
pnpm build:cli
node bin/rag doctor
```

Cross-platform wrappers are available:

| Platform | Command |
|----------|---------|
| Windows  | `bin\rag.bat doctor` |
| Linux / macOS | `node bin/rag doctor` |

### Option 2: Add to PATH (global use)

**Windows PowerShell** (adds `bin/` to user PATH):

```powershell
$userPath = [Environment]::GetEnvironmentVariable("Path", "User")
$repoBin = "D:\remote-agent-gateway\bin"
[Environment]::SetEnvironmentVariable("Path", "$repoBin;$userPath", "User")
# Restart terminal, then:
rag doctor
```

**Linux / macOS** (add to shell rc):

```bash
export PATH="/path/to/remote-agent-gateway/bin:$PATH"
```

Or create an alias:

```bash
alias rag="node /path/to/remote-agent-gateway/bin/rag"
```

### Option 3: npm link

```bash
cd apps/cli
pnpm link --global
rag doctor
```

## Configuration

Resolution order (highest priority first):

| Priority | Source | Example |
|----------|--------|---------|
| 1 | CLI flags | `rag --server http://... --token abc ...` |
| 2 | Environment variables | `RAG_SERVER_URL`, `RAG_AGENT_TOKEN`, `RAG_ADMIN_TOKEN`, `RAG_AGENT_API_TOKEN`, `AGENT_API_TOKEN` |
| 3 | `.ragrc` | `RAG_SERVER_URL=http://...` |
| 4 | `.env` | `RAG_SERVER_URL=http://...` |
| 5 | `server.config.yaml` | `server.port` + `auth.agentApiToken` |

**Recommended (environment variables):**

```bash
export RAG_SERVER_URL=http://your-server:3000
export RAG_AGENT_TOKEN=your-agent-token
```

Check current config:

```bash
rag config show
```

## Output Format

All structured commands output JSON by default.

### Success

```json
{"ok":true,"data":{}}
```

Examples:

```json
// rag clients list
{"ok":true,"data":[{"id":"win-dev-01","name":"Windows Dev","status":"online","online":true,...}]}

// rag files read --client win-dev --root root-0 --path README.md
{"ok":true,"data":{"rootId":"root-0","path":"README.md","content":"# Project\n..."}}

// rag jobs run --client win-dev -- echo hello
{"ok":true,"data":{"jobId":"job_abc","status":"queued"}}
```

### Error

```json
{
  "ok": false,
  "error": {
    "code": "HTTP_ERROR",
    "message": "Client not found",
    "status": 404
  }
}
```

Error codes:

| Code | Meaning |
|------|---------|
| `CONFIG_ERROR` | Missing server URL or token |
| `ARGUMENT_ERROR` | Missing or invalid command option |
| `HTTP_ERROR` | Server or client HTTP non-2xx |
| `NETWORK_ERROR` | Connection failure or timeout |
| `CLIENT_DISCOVERY_ERROR` | Client missing HTTP details |
| `IO_ERROR` | Local file read/write failed |
| `PARSE_ERROR` | Response not expected JSON/SSE |

### Raw output

```bash
rag files read --client win-dev --root root-0 --path README.md --raw
# Output: # Project title\n\nContent...
```

### JSON Lines (SSE events)

```bash
rag jobs events --client win-dev --job job_abc
# {"ok":true,"event":"job.stdout","data":{"content":"hello\n","seq":1}}
# {"ok":true,"event":"job.stderr","data":{"content":"","seq":2}}
# {"ok":true,"event":"job.completed","data":{"status":"success","exitCode":0}}
```

## Full Command List

```bash
rag config show
rag doctor
rag doctor --client <clientId>
rag clients list
rag clients get --client <clientId>
rag jobs run --client <clientId> -- <command> [args...]
rag jobs script --client <clientId> --file ./script.js
rag jobs script --client <clientId> --inline "console.log(1)"
rag jobs get --client <clientId> --job <jobId>
rag jobs logs --client <clientId> --job <jobId> --since-seq 0 --limit 500
rag jobs events --client <clientId> --job <jobId>
rag jobs cancel --client <clientId> --job <jobId>
rag files roots --client <clientId>
rag files list --client <clientId> --root <rootId> --path .
rag files stat --client <clientId> --root <rootId> --path README.md
rag files read --client <clientId> --root <rootId> --path README.md
rag files read --client <clientId> --root <rootId> --path README.md --raw
rag files write --client <clientId> --root <rootId> --path out.txt --content "hello"
rag files upload --client <clientId> --root <rootId> --path . --file ./local.zip
rag files download --client <clientId> --root <rootId> --path remote.zip --output ./remote.zip
rag files mkdir --client <clientId> --root <rootId> --path logs --recursive
rag files delete --client <clientId> --root <rootId> --path logs --recursive
rag files move --client <clientId> --root <rootId> --from a.txt --to b.txt --overwrite
rag files copy --client <clientId> --root <rootId> --from a.txt --to b.txt --overwrite
rag frp list --client <clientId>
rag frp create --client <clientId> --name web --type tcp --local-port 3000
rag frp delete --client <clientId> --mapping <mappingId>
rag tasks list --client <clientId>
rag tasks get --record <recordId>
```

## Command Options Reference

### jobs run

```
--client <clientId>    (required) Client ID
--                     Separator before the command and its arguments
```

Example: `rag jobs run --client win-dev -- bash -c 'ls -la'`

### jobs script

```
--client <clientId>    (required) Client ID
--file <file>          Local script file to send
--inline <script>      Inline script content
--runtime <runtime>    Runtime: node (default), python, bash, powershell
--cwd <cwd>            Remote working directory
--timeout-ms <ms>      Timeout in milliseconds
```

### files upload

```
--client <clientId>    (required) Client ID
--root <rootId>        (required) Root ID from `files roots`
--path <path>          (required) Remote target path within root
--file <file>          (required) Local file to upload
--filename <filename>  Remote filename (default: basename of --file)
```

### frp create

```
--client <clientId>    (required) Client ID
--name <name>          (required) Mapping name
--type <type>          (required) tcp | http | https
--local-host <host>    Local host (default: 127.0.0.1)
--local-port <port>    (required) Local port to expose
--remote-port <port>   Preferred remote port (auto-allocated if omitted)
--custom-domain <domain> Custom domain for http/https mappings
```
