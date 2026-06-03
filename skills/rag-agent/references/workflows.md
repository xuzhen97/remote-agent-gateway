# RAG Agent Workflows

## Discover Clients

```bash
rag doctor
rag clients list
rag clients get --client <clientId>
```

## Execute a Remote Command

```bash
rag jobs run --client <clientId> -- node -v
rag jobs get --client <clientId> --job <jobId>
rag jobs logs --client <clientId> --job <jobId>
```

## Read a Remote File

```bash
rag files roots --client <clientId>
rag files read --client <clientId> --root root-0 --path README.md
```

## Upload and Run a Script

```bash
rag files upload --client <clientId> --root root-0 --path . --file ./deploy.ps1 --filename deploy.ps1
rag jobs run --client <clientId> -- powershell -File deploy.ps1
```

## Expose a Service

```bash
rag frp create --client <clientId> --name web --type tcp --local-port 3000
rag frp delete --client <clientId> --mapping <mappingId>
```

## Review Audit History

```bash
rag tasks list --client <clientId>
rag tasks get --record <recordId>
```
