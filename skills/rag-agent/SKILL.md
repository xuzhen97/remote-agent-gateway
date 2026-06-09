---
name: rag-agent
description: Control remote machines through Remote Agent Gateway using the bundled AI-agent-first CLI. Use when the user wants to list remote clients, run commands or scripts, read/write/upload/download files, manage FRP tunnels, inspect job status, or review remote operation audit history.
---

# Remote Agent Gateway Agent Skill

Use the bundled launcher first. The canonical entrypoint is:

```bash
node ./run.cjs --help
```

Do not assume the original `remote-agent-gateway` repository exists. Do not assume `rag` is on PATH. The distributed skill bundle must work with only Node.js.

## CLI Availability Check

Before any operation:

```bash
node ./run.cjs --help
```

`run.cjs` resolves `dist/rag.cjs` relative to the skill directory, so it does not depend on the caller's current working directory.

If `./run.cjs` or `./dist/rag.cjs` is missing, the skill installation is incomplete. Ask the user to rebuild or reinstall the skill.

If the user also has a separate `rag` command on PATH, that is optional convenience only. The bundled CLI remains the canonical execution path.

## Configuration

The bundled CLI needs a server URL and token. Recommended configuration:

```text
RAG_SERVER_URL=http://your-server:3000
RAG_AGENT_TOKEN=your-agent-token
```

Run:

```bash
node ./run.cjs config show
```

to confirm the resolved configuration. Tokens are masked in output.

## First Steps

Always start with diagnostics and discovery:

```bash
node ./run.cjs doctor
node ./run.cjs clients list
```

## Operating Rules

- Every client operation must explicitly pass `--client <clientId>`.
- Parse CLI output as JSON: check `ok`; then read `data` or `error`.
- Use `jobs` for live command/script execution.
- Use `tasks` for server-side audit history.
- **Node-first rule for remote commands:** when the target machine has Node.js and the task can be expressed as `node <script>` or `node -e <code>`, prefer Node over PowerShell or `cmd`. Only use PowerShell/`cmd` when Node cannot express the operation.
- **Working-directory rule:** prefer structured `--cwd <remotePath>` (when available on the command) instead of embedding `cd`, `Set-Location`, or chained shell commands inside the command string.
- When a script file lives on the remote machine and is a Node script, prefer `node C:\path\to\script.js ...` over `powershell -Command "cd ...; node script.js ..."`.
- **Mandatory result-following rule:** after `jobs run` or `jobs script`, do not stop at `jobId` unless the user explicitly only asked to enqueue a task. If the user wants the result, output, or process, you must either:
  - run with `--wait --logs` to execute and return final output in one step, or
  - run with `--events` to stream live progress, or
  - manually follow `jobs run` with `jobs get` + `jobs logs`.
- Never reply only with “job created” or “job succeeded” when the user actually wants to see command output.
- Ask for user confirmation before destructive operations:
  - `node ./run.cjs files delete ...`
  - `node ./run.cjs files write ...` when overwriting important files
  - `node ./run.cjs frp delete ...`
  - `node ./run.cjs jobs cancel ...`
- FRP delete semantics: once `node ./run.cjs frp delete ...` returns success, the system has already waited for the deleted mapping to be cleared from the FRPS dashboard/API, not merely removed from local config.

## Common Commands

```bash
node ./run.cjs clients list
node ./run.cjs clients get --client <clientId>
node ./run.cjs jobs run --client <clientId> -- node -v
node ./run.cjs jobs run --client <clientId> --wait --logs -- node -v
node ./run.cjs jobs run --client <clientId> --wait --logs --cwd C:\app -- node manager.js status
node ./run.cjs jobs run --client <clientId> --events -- node -v
node ./run.cjs files roots --client <clientId>
node ./run.cjs files read --client <clientId> --root root-0 --path README.md
node ./run.cjs frp list --client <clientId>
node ./run.cjs tasks list --client <clientId>
```

Full command reference: `references/cli.md`
Workflow examples: `references/workflows.md`
API mapping: `references/api-map.md`
