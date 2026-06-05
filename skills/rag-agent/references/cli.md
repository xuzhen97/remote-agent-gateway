# RAG CLI Reference

## Distribution Model

The distributed skill bundle includes its own bundled CLI artifact:

```text
skills/rag-agent/
├── SKILL.md
├── references/
├── run.cjs
└── dist/
    └── rag.cjs
```

Canonical entrypoint for distributed usage:

```bash
node ./run.cjs --help
```

`run.cjs` resolves `dist/rag.cjs` relative to the skill directory, so it works even when the caller's current working directory is elsewhere.

## Developer Usage

Repository-local development can still use:

```bash
node bin/rag --help
```

but that is not the canonical distributed entrypoint.

## Installation

### Build the distributable skill bundle

```bash
cd remote-agent-gateway
pnpm exec tsx scripts/build-skill-cli.ts
```

This produces `skills/rag-agent/dist/rag.cjs`.

### Install skill into Pi

```bash
pnpm exec tsx scripts/install-pi-skill.ts
```

This command builds the bundled CLI first, then copies the full `skills/rag-agent/` directory into `~/.pi/agent/skills/rag-agent/`.

### After installation

```bash
node ./run.cjs doctor
```

## Configuration

Resolution order (highest priority first):

| Priority | Source | Example |
|----------|--------|---------|
| 1 | CLI flags | `node ./run.cjs --server http://... --token abc ...` |
| 2 | Environment variables | `RAG_SERVER_URL`, `RAG_AGENT_TOKEN`, `RAG_ADMIN_TOKEN`, `RAG_AGENT_API_TOKEN`, `AGENT_API_TOKEN` |

**Recommended (environment variables):**

```bash
export RAG_SERVER_URL=http://your-server:3000
export RAG_AGENT_TOKEN=your-agent-token
```

The CLI does not read `.ragrc`, `.env`, or `server.config.yaml`.

Check current config:

```bash
node ./run.cjs config show
```

## Output Format

All structured commands output JSON by default.

### Success

```json
{"ok":true,"data":{}}
```

Examples:

```json
// node ./run.cjs clients list
{"ok":true,"data":[{"id":"win-dev-01","name":"Windows Dev","status":"online","online":true,...}]}

// node ./run.cjs files read --client win-dev --root root-0 --path README.md
{"ok":true,"data":{"rootId":"root-0","path":"README.md","content":"# Project\n..."}}

// node ./run.cjs jobs run --client win-dev -- echo hello
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
node ./run.cjs files read --client win-dev --root root-0 --path README.md --raw
# Output: # Project title\n\nContent...
```

### JSON Lines (SSE events)

```bash
node ./run.cjs jobs events --client win-dev --job job_abc
# {"ok":true,"event":"job.stdout","data":{"content":"hello\n","seq":1}}
# {"ok":true,"event":"job.stderr","data":{"content":"","seq":2}}
# {"ok":true,"event":"job.completed","data":{"status":"success","exitCode":0}}
```

## Full Command List

```bash
node ./run.cjs config show
node ./run.cjs doctor
node ./run.cjs doctor --client <clientId>
node ./run.cjs clients list
node ./run.cjs clients get --client <clientId>
node ./run.cjs jobs run --client <clientId> -- <command> [args...]
node ./run.cjs jobs run --client <clientId> --wait -- <command> [args...]
node ./run.cjs jobs run --client <clientId> --wait --logs -- <command> [args...]
node ./run.cjs jobs run --client <clientId> --events -- <command> [args...]
node ./run.cjs jobs script --client <clientId> --file ./script.js
node ./run.cjs jobs script --client <clientId> --inline "console.log(1)"
node ./run.cjs jobs script --client <clientId> --file ./script.js --wait
node ./run.cjs jobs script --client <clientId> --file ./script.js --wait --logs
node ./run.cjs jobs script --client <clientId> --inline "console.log(1)" --events
node ./run.cjs jobs get --client <clientId> --job <jobId>
node ./run.cjs jobs logs --client <clientId> --job <jobId> --since-seq 0 --limit 500
node ./run.cjs jobs events --client <clientId> --job <jobId>
node ./run.cjs jobs cancel --client <clientId> --job <jobId>
node ./run.cjs files roots --client <clientId>
node ./run.cjs files list --client <clientId> --root <rootId> --path .
node ./run.cjs files stat --client <clientId> --root <rootId> --path README.md
node ./run.cjs files read --client <clientId> --root <rootId> --path README.md
node ./run.cjs files read --client <clientId> --root <rootId> --path README.md --raw
node ./run.cjs files write --client <clientId> --root <rootId> --path out.txt --content "hello"
node ./run.cjs files upload --client <clientId> --root <rootId> --path . --file ./local.zip
node ./run.cjs files download --client <clientId> --root <rootId> --path remote.zip --output ./remote.zip
node ./run.cjs files mkdir --client <clientId> --root <rootId> --path logs --recursive
node ./run.cjs files delete --client <clientId> --root <rootId> --path logs --recursive
node ./run.cjs files move --client <clientId> --root <rootId> --from a.txt --to b.txt --overwrite
node ./run.cjs files copy --client <clientId> --root <rootId> --from a.txt --to b.txt --overwrite
node ./run.cjs frp list --client <clientId>
node ./run.cjs frp create --client <clientId> --name web --type tcp --local-port 3000
node ./run.cjs frp delete --client <clientId> --mapping <mappingId>
# success means the proxy has also been cleared from the FRPS dashboard/API
node ./run.cjs tasks list --client <clientId>
node ./run.cjs tasks get --record <recordId>
```

## Command Options Reference

### jobs run

```
--client <clientId>    (required) Client ID
--wait                 Wait for the job to finish and return final status
--logs                 After waiting, also fetch logs (requires --wait)
--events               Stream live job events after creation
--                     Separator before the command and its arguments
```

Examples:
- `node ./run.cjs jobs run --client win-dev -- bash -c 'ls -la'`
- `node ./run.cjs jobs run --client win-dev --wait -- bash -c 'ls -la'`
- `node ./run.cjs jobs run --client win-dev --wait --logs -- bash -c 'ls -la'`
- `node ./run.cjs jobs run --client win-dev --events -- bash -c 'ls -la'`

### jobs script

```
--client <clientId>    (required) Client ID
--file <file>          Local script file to send
--inline <script>      Inline script content
--runtime <runtime>    Runtime: node (default), python, bash, powershell
--cwd <cwd>            Remote working directory
--timeout-ms <ms>      Timeout in milliseconds
--wait                 Wait for the job to finish and return final status
--logs                 After waiting, also fetch logs (requires --wait)
--events               Stream live job events after creation
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

### frp delete

```
--client <clientId>    (required) Client ID
--mapping <mappingId>  (required) Mapping ID from frp list/create
```

Behavior:
- deletes the mapping from server/client state,
- waits for the target proxy to leave FRPS online state,
- clears offline dashboard residue,
- and returns success only after the proxy is no longer present in the FRPS dashboard/API.
