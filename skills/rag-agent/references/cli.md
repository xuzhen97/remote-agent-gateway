# RAG CLI Reference

## Distribution Model

The distributed skill bundle includes its own bundled CLI artifact:

```text
skills/rag-agent/
├── SKILL.md
├── references/
└── dist/
    └── rag.cjs
```

Canonical entrypoint for distributed usage:

```bash
node ./dist/rag.cjs --help
```

This works after the skill is copied into another repository or installed into Pi, as long as Node.js is available.

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
pnpm build:skill
```

This produces `skills/rag-agent/dist/rag.cjs`.

### Install skill into Pi

```bash
pnpm install:pi-skill
```

This command builds the bundled CLI first, then copies the full `skills/rag-agent/` directory into `~/.pi/agent/skills/rag-agent/`.

### After installation

```bash
node ./dist/rag.cjs doctor
```

## Configuration

Resolution order (highest priority first):

| Priority | Source | Example |
|----------|--------|---------|
| 1 | CLI flags | `node ./dist/rag.cjs --server http://... --token abc ...` |
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
node ./dist/rag.cjs config show
```

## Output Format

All structured commands output JSON by default.

### Success

```json
{"ok":true,"data":{}}
```

Examples:

```json
// node ./dist/rag.cjs clients list
{"ok":true,"data":[{"id":"win-dev-01","name":"Windows Dev","status":"online","online":true,...}]}

// node ./dist/rag.cjs files read --client win-dev --root root-0 --path README.md
{"ok":true,"data":{"rootId":"root-0","path":"README.md","content":"# Project\n..."}}

// node ./dist/rag.cjs jobs run --client win-dev -- echo hello
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
node ./dist/rag.cjs files read --client win-dev --root root-0 --path README.md --raw
# Output: # Project title\n\nContent...
```

### JSON Lines (SSE events)

```bash
node ./dist/rag.cjs jobs events --client win-dev --job job_abc
# {"ok":true,"event":"job.stdout","data":{"content":"hello\n","seq":1}}
# {"ok":true,"event":"job.stderr","data":{"content":"","seq":2}}
# {"ok":true,"event":"job.completed","data":{"status":"success","exitCode":0}}
```

## Full Command List

```bash
node ./dist/rag.cjs config show
node ./dist/rag.cjs doctor
node ./dist/rag.cjs doctor --client <clientId>
node ./dist/rag.cjs clients list
node ./dist/rag.cjs clients get --client <clientId>
node ./dist/rag.cjs jobs run --client <clientId> -- <command> [args...]
node ./dist/rag.cjs jobs script --client <clientId> --file ./script.js
node ./dist/rag.cjs jobs script --client <clientId> --inline "console.log(1)"
node ./dist/rag.cjs jobs get --client <clientId> --job <jobId>
node ./dist/rag.cjs jobs logs --client <clientId> --job <jobId> --since-seq 0 --limit 500
node ./dist/rag.cjs jobs events --client <clientId> --job <jobId>
node ./dist/rag.cjs jobs cancel --client <clientId> --job <jobId>
node ./dist/rag.cjs files roots --client <clientId>
node ./dist/rag.cjs files list --client <clientId> --root <rootId> --path .
node ./dist/rag.cjs files stat --client <clientId> --root <rootId> --path README.md
node ./dist/rag.cjs files read --client <clientId> --root <rootId> --path README.md
node ./dist/rag.cjs files read --client <clientId> --root <rootId> --path README.md --raw
node ./dist/rag.cjs files write --client <clientId> --root <rootId> --path out.txt --content "hello"
node ./dist/rag.cjs files upload --client <clientId> --root <rootId> --path . --file ./local.zip
node ./dist/rag.cjs files download --client <clientId> --root <rootId> --path remote.zip --output ./remote.zip
node ./dist/rag.cjs files mkdir --client <clientId> --root <rootId> --path logs --recursive
node ./dist/rag.cjs files delete --client <clientId> --root <rootId> --path logs --recursive
node ./dist/rag.cjs files move --client <clientId> --root <rootId> --from a.txt --to b.txt --overwrite
node ./dist/rag.cjs files copy --client <clientId> --root <rootId> --from a.txt --to b.txt --overwrite
node ./dist/rag.cjs frp list --client <clientId>
node ./dist/rag.cjs frp create --client <clientId> --name web --type tcp --local-port 3000
node ./dist/rag.cjs frp delete --client <clientId> --mapping <mappingId>
node ./dist/rag.cjs tasks list --client <clientId>
node ./dist/rag.cjs tasks get --record <recordId>
```

## Command Options Reference

### jobs run

```
--client <clientId>    (required) Client ID
--                     Separator before the command and its arguments
```

Example: `node ./dist/rag.cjs jobs run --client win-dev -- bash -c 'ls -la'`

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
