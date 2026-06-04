---
name: rag-agent
description: Control remote machines through Remote Agent Gateway using the bundled AI-agent-first CLI. Use when the user wants to list remote clients, run commands or scripts, read/write/upload/download files, manage FRP tunnels, inspect job status, or review remote operation audit history.
---

# Remote Agent Gateway Agent Skill

Use the bundled CLI first. The canonical entrypoint is:

```bash
node ./dist/rag.cjs --help
```

Do not assume the original `remote-agent-gateway` repository exists. Do not assume `rag` is on PATH. The distributed skill bundle must work with only Node.js.

## CLI Availability Check

Before any operation:

```bash
node ./dist/rag.cjs --help
```

If `./dist/rag.cjs` is missing, the skill installation is incomplete. Ask the user to rebuild or reinstall the skill.

If the user also has a separate `rag` command on PATH, that is optional convenience only. The bundled CLI remains the canonical execution path.

## Configuration

The bundled CLI needs a server URL and token. Recommended configuration:

```text
RAG_SERVER_URL=http://your-server:3000
RAG_AGENT_TOKEN=your-agent-token
```

Run:

```bash
node ./dist/rag.cjs config show
```

to confirm the resolved configuration. Tokens are masked in output.

## First Steps

Always start with diagnostics and discovery:

```bash
node ./dist/rag.cjs doctor
node ./dist/rag.cjs clients list
```

## Operating Rules

- Every client operation must explicitly pass `--client <clientId>`.
- Parse CLI output as JSON: check `ok`; then read `data` or `error`.
- Use `jobs` for live command/script execution.
- Use `tasks` for server-side audit history.
- **Mandatory result-following rule:** after `jobs run` or `jobs script`, do not stop at `jobId` unless the user explicitly only asked to enqueue a task. If the user wants the result, output, or process, you must either:
  - run with `--wait --logs` to execute and return final output in one step, or
  - run with `--events` to stream live progress, or
  - manually follow `jobs run` with `jobs get` + `jobs logs`.
- Never reply only with “job created” or “job succeeded” when the user actually wants to see command output.
- Ask for user confirmation before destructive operations:
  - `node ./dist/rag.cjs files delete ...`
  - `node ./dist/rag.cjs files write ...` when overwriting important files
  - `node ./dist/rag.cjs frp delete ...`
  - `node ./dist/rag.cjs jobs cancel ...`

## Common Commands

```bash
node ./dist/rag.cjs clients list
node ./dist/rag.cjs clients get --client <clientId>
node ./dist/rag.cjs jobs run --client <clientId> -- node -v
node ./dist/rag.cjs jobs run --client <clientId> --wait --logs -- node -v
node ./dist/rag.cjs jobs run --client <clientId> --events -- node -v
node ./dist/rag.cjs files roots --client <clientId>
node ./dist/rag.cjs files read --client <clientId> --root root-0 --path README.md
node ./dist/rag.cjs frp list --client <clientId>
node ./dist/rag.cjs tasks list --client <clientId>
```

Full command reference: `references/cli.md`
Workflow examples: `references/workflows.md`
API mapping: `references/api-map.md`
