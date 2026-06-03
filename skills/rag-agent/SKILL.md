---
name: rag-agent
description: Control remote machines through Remote Agent Gateway using the bundled AI-agent-first CLI. Use when the user wants to list remote clients, run commands or scripts, read/write/upload/download files, manage FRP tunnels, inspect job status, or review remote operation audit history.
---

# Remote Agent Gateway Agent Skill

Use the bundled `rag` CLI first. Do not hand-write curl unless the CLI is unavailable or broken.

## First Steps

Always start with diagnostics and discovery:

```bash
rag doctor
rag clients list
```

If server configuration is missing, ask the user for the server URL and token, or use environment variables:

```text
RAG_SERVER_URL=http://your-server:3000
RAG_AGENT_TOKEN=your-agent-token
```

## Operating Rules

- Every client operation must explicitly pass `--client <clientId>`.
- Parse CLI output as JSON: check `ok`; then read `data` or `error`.
- Use `jobs` for live command/script execution.
- Use `tasks` for server-side audit history.
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

## References

- Full CLI reference: `references/cli.md`
- Common workflows: `references/workflows.md`
- API mapping: `references/api-map.md`
