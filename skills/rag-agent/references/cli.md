# RAG CLI Reference

## Global Configuration

```bash
rag --server <url> --token <token> <command>
rag --config <path> <command>
```

Environment variables:

```text
RAG_SERVER_URL=http://your-server:3000
RAG_AGENT_TOKEN=your-agent-token
```

## Output

Success:

```json
{"ok":true,"data":{}}
```

Error:

```json
{"ok":false,"error":{"code":"HTTP_ERROR","message":"Client not found","status":404}}
```

## Commands

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
rag files list --client <clientId> --root root-0 --path .
rag files stat --client <clientId> --root root-0 --path README.md
rag files read --client <clientId> --root root-0 --path README.md
rag files read --client <clientId> --root root-0 --path README.md --raw
rag files write --client <clientId> --root root-0 --path out.txt --content "hello"
rag files upload --client <clientId> --root root-0 --path . --file ./local.zip
rag files download --client <clientId> --root root-0 --path remote.zip --output ./remote.zip
rag files mkdir --client <clientId> --root root-0 --path logs --recursive
rag files delete --client <clientId> --root root-0 --path logs --recursive
rag files move --client <clientId> --root root-0 --from a.txt --to b.txt --overwrite
rag files copy --client <clientId> --root root-0 --from a.txt --to b.txt --overwrite
rag frp list --client <clientId>
rag frp create --client <clientId> --name web --type tcp --local-port 3000
rag frp delete --client <clientId> --mapping <mappingId>
rag tasks list --client <clientId>
rag tasks get --record <recordId>
```
