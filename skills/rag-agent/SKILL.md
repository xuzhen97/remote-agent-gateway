---
name: rag-agent
description: Control remote machines through Remote Agent Gateway using the bundled AI-agent-first CLI. Use when the user wants to list remote clients, run commands or scripts, read/write/upload/download files, manage FRP tunnels, inspect job status, or review remote operation audit history.
---

# Remote Agent Gateway Agent Skill

Use the bundled `rag` CLI first. Do not hand-write curl unless the CLI is unavailable or broken.

## CLI Availability Check

Before any operation, check whether the `rag` CLI is available. Try these in order:

```bash
# 1. If rag is on PATH (best)
rag --help

# 2. If you're inside the remote-agent-gateway repo
node bin/rag --help

# 3. If the repo is at a known path
node /path/to/remote-agent-gateway/bin/rag --help
```

If the CLI is not found:

1. Ask the user whether they have the `remote-agent-gateway` repository cloned.
2. If yes, guide them to run `pnpm build:cli` inside the repo.
3. If they have the repo but want to use `rag` globally, suggest adding the `bin/` directory to PATH (see `references/cli.md` for OS-specific instructions).
4. If the CLI is truly not available, fall back to the HTTP API via `references/api-map.md`.

## Configuration

The CLI needs a server URL and token. The recommended way is environment variables:

```text
RAG_SERVER_URL=http://your-server:3000
RAG_AGENT_TOKEN=your-agent-token
```

If the user hasn't configured them, ask for the server URL and token, then set them before running any command:

```bash
# Unix
export RAG_SERVER_URL=http://your-server:3000
export RAG_AGENT_TOKEN=your-agent-token

# Windows PowerShell
$env:RAG_SERVER_URL="http://your-server:3000"
$env:RAG_AGENT_TOKEN="your-agent-token"
```

Configuration is resolved in this order: CLI flags > env vars > `.ragrc` > `.env` > `server.config.yaml`. Run `rag config show` to confirm what the CLI is using (tokens are masked).

## First Steps

Always start with diagnostics and discovery:

```bash
rag doctor
rag clients list
```

If `rag doctor` fails, check:
- `RAG_SERVER_URL` is correct and accessible
- `RAG_AGENT_TOKEN` matches the server's `auth.agentApiToken` or `auth.adminToken`

## Operating Rules

- Every client operation must explicitly pass `--client <clientId>`. The CLI does not remember a default client — this prevents accidental operations on the wrong machine.
- Parse CLI output as JSON: check `ok`; then read `data` or `error`.
- Use **`jobs`** for live command/script execution (returns immediately, poll for results).
- Use **`tasks`** for server-side audit history (completed operations).
- Ask for user confirmation before destructive operations:
  - `rag files delete ...`
  - `rag files write ...` when overwriting important files
  - `rag frp delete ...`
  - `rag jobs cancel ...`

## Common Commands

```bash
rag clients list
rag clients get --client <clientId>
rag jobs run --client <clientId> -- node -v
rag files roots --client <clientId>
rag files read --client <clientId> --root root-0 --path README.md
rag frp list --client <clientId>
rag tasks list --client <clientId>
```

Full command reference: `references/cli.md`
Workflow examples: `references/workflows.md`
API mapping: `references/api-map.md`
