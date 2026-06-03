# Agent-first CLI and Project Skill Design

> Date: 2026-06-03  
> Status: Design approved for spec review  
> Scope: Redesign the Remote Agent Gateway CLI for AI Agent usage and move the `rag-agent` skill into the project as a first-class project asset.

## Background

Remote Agent Gateway has moved away from the older Agent API and file-session design. The current architecture is:

- Server control plane: client discovery, lightweight admin orchestration, task audit history.
- Client HTTP data plane: direct `/jobs/*`, `/files/*`, and `/frp/*` operations through the client's HTTP control service.
- Web console: management UI backed by the same server/client HTTP model.
- Shared package: shared schemas, protocol contracts, and task audit types.

The existing `bin/rag` CLI is a single-file tool that still reflects older command and API assumptions. The existing `.claude/skills/rag-agent/SKILL.md` is also not the desired source of truth. The new requirement is to rebuild the CLI around the current architecture and provide a project-owned skill that can be installed into Pi Agent.

## Goals

1. Build a new AI-Agent-first CLI under `apps/cli/`.
2. Use the current codebase and current API model only; do not preserve old CLI command compatibility.
3. Keep `bin/rag` and `bin/rag.bat` as cross-platform wrappers for the new CLI implementation.
4. Make every client-targeting operation explicit with `--client <clientId>`.
5. Default all structured output to JSON for reliable AI Agent parsing.
6. Support server URL and token configuration through environment variables, CLI flags, and config files.
7. Move the skill source into `skills/rag-agent/` as a project-owned asset.
8. Provide a Node/TypeScript copy installer for Pi Agent skills.
9. Keep the implementation cross-platform and Node-stack based.

## Non-goals

- Do not keep compatibility with old CLI commands such as `rag exec <clientId>`, `rag session <clientId>`, or `rag ls <clientId>`.
- Do not build an MCP server in this change.
- Do not publish the CLI as an external npm package in this change.
- Do not use `.claude/skills/rag-agent` as the source of truth.
- Do not use Bash-only or PowerShell-only scripts for core behavior.

## Current Architecture Findings

Current relevant source layout:

```text
apps/server/src/modules/clients/        # GET /api/clients and /api/clients/:clientId
apps/server/src/modules/client-http/    # Lightweight server orchestration for client HTTP admin routes
apps/server/src/modules/tasks/          # Server-side task audit history mirror
apps/client/src/runtime/control-http/   # Client HTTP /jobs, /files, /frp routes
packages/shared/src/                    # Shared schemas and task audit contracts
```

Important current APIs:

```text
GET    /api/clients
GET    /api/clients/:clientId
GET    /api/tasks
GET    /api/tasks/:recordId

Client HTTP direct routes:
GET    /health
POST   /jobs/command
POST   /jobs/script
GET    /jobs/:jobId
GET    /jobs/:jobId/logs
GET    /jobs/:jobId/events
POST   /jobs/:jobId/cancel
GET    /files/roots
GET    /files
GET    /files/stat
GET    /files/read
GET    /files/download
PUT    /files/write
POST   /files/upload
POST   /files/mkdir
DELETE /files
POST   /files/move
POST   /files/copy
GET    /frp/mappings
POST   /frp/mappings
DELETE /frp/mappings/:mappingId
```

The CLI should use server discovery first, then call the client HTTP service directly with `clientHttpBaseUrl` and `clientHttpToken` returned by `GET /api/clients/:clientId`.

## Decisions

| Topic | Decision |
|---|---|
| CLI location | `apps/cli/` |
| CLI stack | Node.js 22+, TypeScript, ESM, commander, Vitest |
| CLI wrappers | `bin/rag`, `bin/rag.bat` |
| Command model | New Agent-first domain commands |
| Backward compatibility | None |
| Client targeting | Explicit `--client <clientId>` on every client operation |
| Output | JSON by default; JSON Lines for event streams |
| Skill source | `skills/rag-agent/` |
| Skill install | Copy install to Pi user skill directory |
| Script stack | Node/TypeScript only |

## CLI Architecture

New app layout:

```text
apps/cli/
├── package.json
├── tsconfig.json
├── vitest.config.ts
└── src/
    ├── index.ts
    ├── config/
    │   ├── config.ts
    │   └── config.test.ts
    ├── http/
    │   ├── server-api.ts
    │   ├── client-http.ts
    │   └── http-error.ts
    ├── commands/
    │   ├── clients.ts
    │   ├── jobs.ts
    │   ├── files.ts
    │   ├── frp.ts
    │   ├── tasks.ts
    │   └── doctor.ts
    ├── output/
    │   └── json-output.ts
    └── util/
        └── args.ts
```

Responsibilities:

- `config/`: resolve server URL and token.
- `http/server-api.ts`: call server APIs such as `/api/clients` and `/api/tasks`.
- `http/client-http.ts`: call discovered client HTTP APIs.
- `commands/`: define commander command groups.
- `output/`: write stable JSON success and error envelopes.
- `bin/rag` and `bin/rag.bat`: thin wrappers that execute `apps/cli/dist/index.js`.

## Configuration

The CLI must support environment variable configuration for the server address and token. This is a primary requirement for AI Agent usage and deployment automation.

Resolution order:

1. CLI flags:
   - `--server <url>`
   - `--token <token>`
   - `--config <path>`
2. Environment variables:
   - `RAG_SERVER_URL`
   - `RAG_AGENT_TOKEN`
   - `RAG_ADMIN_TOKEN`
   - `RAG_AGENT_API_TOKEN`
   - `AGENT_API_TOKEN`
3. `.ragrc` in the current directory or an ancestor directory.
4. `.env` in the current directory or an ancestor directory.
5. `server.config.yaml` in the current directory or an ancestor directory:
   - `server.port` for local URL construction
   - `auth.agentApiToken` or `auth.adminToken` for token resolution

Recommended environment variables:

```text
RAG_SERVER_URL=http://your-server:3000
RAG_AGENT_TOKEN=your-agent-token
```

Token handling rules:

- Never print the full token.
- `rag config show` may print a masked token.
- Error messages must not include the token.

## CLI Command Surface

### Global

```bash
rag --server <url> --token <token> <command>
rag --config <path> <command>
rag --help
rag --version
```

### Config and diagnostics

```bash
rag config show
rag doctor
rag doctor --client <clientId>
```

`doctor` checks server reachability, client discovery, client HTTP health, file roots, and FRP mappings where applicable.

### Clients

```bash
rag clients list
rag clients get --client <clientId>
```

API mapping:

```text
rag clients list              -> GET /api/clients
rag clients get --client id   -> GET /api/clients/:id
```

### Jobs

```bash
rag jobs run --client <clientId> -- <command>
rag jobs script --client <clientId> --file ./script.js
rag jobs script --client <clientId> --inline "console.log(1)"
rag jobs get --client <clientId> --job <jobId>
rag jobs logs --client <clientId> --job <jobId> --since-seq 0 --limit 500
rag jobs events --client <clientId> --job <jobId>
rag jobs cancel --client <clientId> --job <jobId>
```

API mapping:

```text
GET /api/clients/:clientId
POST {clientHttpBaseUrl}/jobs/command
POST {clientHttpBaseUrl}/jobs/script
GET  {clientHttpBaseUrl}/jobs/:jobId
GET  {clientHttpBaseUrl}/jobs/:jobId/logs
GET  {clientHttpBaseUrl}/jobs/:jobId/events
POST {clientHttpBaseUrl}/jobs/:jobId/cancel
```

`jobs events` emits JSON Lines.

### Files

```bash
rag files roots --client <clientId>
rag files list --client <clientId> --root <rootId> --path .
rag files stat --client <clientId> --root <rootId> --path README.md
rag files read --client <clientId> --root <rootId> --path README.md
rag files read --client <clientId> --root <rootId> --path README.md --raw
rag files write --client <clientId> --root <rootId> --path out.txt --content "hello"
rag files write --client <clientId> --root <rootId> --path out.txt --stdin
rag files upload --client <clientId> --root <rootId> --path . --file ./local.zip --filename local.zip
rag files download --client <clientId> --root <rootId> --path remote.zip --output ./remote.zip
rag files mkdir --client <clientId> --root <rootId> --path logs --recursive
rag files delete --client <clientId> --root <rootId> --path logs --recursive
rag files move --client <clientId> --root <rootId> --from a.txt --to b.txt --overwrite
rag files copy --client <clientId> --root <rootId> --from a.txt --to b.txt --overwrite
```

API mapping:

```text
GET    {clientHttpBaseUrl}/files/roots
GET    {clientHttpBaseUrl}/files?rootId=...&path=...
GET    {clientHttpBaseUrl}/files/stat?rootId=...&path=...
GET    {clientHttpBaseUrl}/files/read?rootId=...&path=...
GET    {clientHttpBaseUrl}/files/download?rootId=...&path=...
PUT    {clientHttpBaseUrl}/files/write?rootId=...&path=...
POST   {clientHttpBaseUrl}/files/upload?rootId=...&path=...&filename=...
POST   {clientHttpBaseUrl}/files/mkdir
DELETE {clientHttpBaseUrl}/files?rootId=...&path=...&recursive=true
POST   {clientHttpBaseUrl}/files/move
POST   {clientHttpBaseUrl}/files/copy
```

By default, `files read` returns JSON with content. `--raw` prints only the file content on success.

### FRP

```bash
rag frp list --client <clientId>
rag frp create --client <clientId> --name web --type tcp --local-host 127.0.0.1 --local-port 3000
rag frp create --client <clientId> --name web --type http --local-port 3000 --custom-domain preview.example.com
rag frp delete --client <clientId> --mapping <mappingId>
```

API mapping:

```text
GET    {clientHttpBaseUrl}/frp/mappings
POST   {clientHttpBaseUrl}/frp/mappings
DELETE {clientHttpBaseUrl}/frp/mappings/:mappingId
```

### Task audit history

```bash
rag tasks list
rag tasks list --client <clientId>
rag tasks list --action file.write
rag tasks get --record <recordId>
```

API mapping:

```text
GET /api/tasks
GET /api/tasks/:recordId
```

The skill must explain that `jobs` are live client HTTP executions, while `tasks` are server-side audit history records.

## Output and Error Format

Success envelope:

```json
{
  "ok": true,
  "data": {}
}
```

Error envelope:

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

Known error codes:

| Code | Meaning |
|---|---|
| `CONFIG_ERROR` | Missing or invalid server URL/token configuration |
| `ARGUMENT_ERROR` | Missing required option or invalid option combination |
| `HTTP_ERROR` | Server or client HTTP returned non-2xx |
| `NETWORK_ERROR` | Fetch failed, timed out, DNS failure, or connection failure |
| `CLIENT_DISCOVERY_ERROR` | Client not found or missing client HTTP details |
| `IO_ERROR` | Local file read/write failed |
| `PARSE_ERROR` | Response was not expected JSON/SSE/text |

Rules:

- Structured success responses go to stdout.
- Structured errors go to stderr.
- Failed commands exit non-zero.
- `files read --raw` writes raw content to stdout on success; errors remain JSON on stderr.
- `jobs events` writes JSON Lines to stdout.

## Project Skill Layout

Project-owned skill source:

```text
skills/rag-agent/
├── SKILL.md
└── references/
    ├── cli.md
    ├── workflows.md
    └── api-map.md
```

`SKILL.md` should be concise and stable:

- Use the bundled CLI first; do not hand-write curl unless the CLI is unavailable.
- Start with `rag doctor` and `rag clients list`.
- Always pass `--client <clientId>` for client operations.
- Parse JSON output by checking `ok` and then `data` or `error`.
- Ask for confirmation before destructive operations:
  - `files delete`
  - `files write` when overwriting important files
  - `frp delete`
  - `jobs cancel`

Reference files:

- `references/cli.md`: full command reference and output examples.
- `references/workflows.md`: common AI Agent workflows.
- `references/api-map.md`: command-to-current-API mapping.

The skill must not document old `/api/agent/*` routes as the primary path.

## Pi Skill Installation

Provide a cross-platform Node/TypeScript script:

```text
scripts/install-pi-skill.ts
```

Behavior:

- Source: `skills/rag-agent/`
- Default target: `join(homedir(), '.pi', 'agent', 'skills', 'rag-agent')`
- Delete existing target directory before copying.
- Copy files recursively.
- Print the installed path and remind the user to restart or reload Pi Agent skills.
- Do not create symlinks.
- Do not install the CLI globally.

Root package script:

```json
{
  "scripts": {
    "install:pi-skill": "tsx scripts/install-pi-skill.ts"
  }
}
```

## Cross-platform Requirements

- Core implementation must be Node/TypeScript.
- Use `node:path`, `node:os`, `node:fs/promises`, and Node streams for portable behavior.
- Keep shell wrappers thin.
- Avoid Bash-only or PowerShell-only behavior in the CLI logic.
- Local file paths are resolved with Node path utilities.
- Remote paths are passed as user-provided strings because the remote client OS may differ from the local OS.
- Prefer `--file`, `--output`, and `--content` in skill examples for cross-platform reliability.
- Stdin remains supported for automation but should not be the primary example in the skill.

Wrapper design:

```text
bin/rag      -> Node shebang wrapper loading apps/cli/dist/index.js
bin/rag.bat  -> Windows batch wrapper loading apps\cli\dist\index.js
```

## Testing Strategy

### CLI package tests

Commands:

```bash
pnpm --filter @rag/cli test
pnpm --filter @rag/cli typecheck
pnpm --filter @rag/cli build
```

Test groups:

1. Config resolution tests.
2. Commander argument parsing tests.
3. Server API mock-fetch tests.
4. Client HTTP mock-fetch tests.
5. Output envelope and error formatting tests.
6. File upload/download local I/O tests using temp directories.

### Workspace validation

Commands:

```bash
pnpm build
pnpm test
pnpm typecheck
pnpm install:pi-skill
```

Wrapper smoke tests:

```bash
node bin/rag --help
node bin/rag doctor
```

On Windows, also verify:

```bat
bin\rag.bat --help
bin\rag.bat doctor
```

## Migration Strategy

1. Replace `bin/rag` implementation with a wrapper to `apps/cli/dist/index.js`.
2. Replace `bin/rag.bat` implementation with a Windows wrapper to the same compiled CLI.
3. Add `apps/cli` to the pnpm workspace.
4. Add root scripts:
   - `dev:cli`
   - `build:cli`
   - `install:pi-skill`
5. Move skill source to `skills/rag-agent/`.
6. Stop maintaining `.claude/skills/rag-agent`; implementation may delete it to avoid stale guidance.
7. Update README and testing docs to document the new CLI and project skill.

## Files to Add or Modify

Add:

```text
apps/cli/package.json
apps/cli/tsconfig.json
apps/cli/vitest.config.ts
apps/cli/src/index.ts
apps/cli/src/config/config.ts
apps/cli/src/config/config.test.ts
apps/cli/src/http/server-api.ts
apps/cli/src/http/client-http.ts
apps/cli/src/http/http-error.ts
apps/cli/src/output/json-output.ts
apps/cli/src/commands/clients.ts
apps/cli/src/commands/jobs.ts
apps/cli/src/commands/files.ts
apps/cli/src/commands/frp.ts
apps/cli/src/commands/tasks.ts
apps/cli/src/commands/doctor.ts
apps/cli/src/util/args.ts
skills/rag-agent/SKILL.md
skills/rag-agent/references/cli.md
skills/rag-agent/references/workflows.md
skills/rag-agent/references/api-map.md
scripts/install-pi-skill.ts
```

Modify:

```text
bin/rag
bin/rag.bat
package.json
pnpm-workspace.yaml
README.md
docs/TESTING.md or docs/cli.md
```

Potentially remove:

```text
.claude/skills/rag-agent/
```

## Open Questions

None. The design explicitly includes environment variable support for server address and token configuration.
