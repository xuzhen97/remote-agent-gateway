# CLI to Server/Client HTTP API Map

Each CLI command that interacts with a client follows a two-step process:

1. **Discovery:** `GET /api/clients/:clientId` — get the client's `clientHttpBaseUrl` and `clientHttpToken`.
2. **Direct operation:** Call the client HTTP service at `{clientHttpBaseUrl}` with `Authorization: Bearer {clientHttpToken}`.

Server-only commands (no client target) call the server API directly.

## Discovery

```text
rag clients list
  -> GET /api/clients

rag clients get --client <id>
  -> GET /api/clients/:clientId
  (returns clientHttpBaseUrl + clientHttpToken when httpReady=true)
```

## Jobs (Client HTTP Direct)

```text
rag jobs run --client <id> -- <cmd> [args...]
  -> GET /api/clients/:clientId
  -> POST {clientHttpBaseUrl}/jobs/command
     {"command":"<cmd>","args":[...]}

rag jobs script --client <id> --file ./s.js
  -> GET /api/clients/:clientId
  -> POST {clientHttpBaseUrl}/jobs/script
     {"runtime":"node","script":"<file content>"}

rag jobs get --client <id> --job <jobId>
  -> GET /api/clients/:clientId
  -> GET {clientHttpBaseUrl}/jobs/:jobId

rag jobs logs --client <id> --job <jobId>
  -> GET /api/clients/:clientId
  -> GET {clientHttpBaseUrl}/jobs/:jobId/logs?sinceSeq=...&limit=...

rag jobs events --client <id> --job <jobId>
  -> GET /api/clients/:clientId
  -> GET {clientHttpBaseUrl}/jobs/:jobId/events (SSE)

rag jobs cancel --client <id> --job <jobId>
  -> GET /api/clients/:clientId
  -> POST {clientHttpBaseUrl}/jobs/:jobId/cancel
```

## Files (Client HTTP Direct)

```text
rag files roots --client <id>
  -> GET /api/clients/:clientId
  -> GET {clientHttpBaseUrl}/files/roots

rag files list --client <id> --root root-0 --path .
  -> GET /api/clients/:clientId
  -> GET {clientHttpBaseUrl}/files?rootId=root-0&path=.

rag files stat --client <id> --root root-0 --path f.txt
  -> GET /api/clients/:clientId
  -> GET {clientHttpBaseUrl}/files/stat?rootId=root-0&path=f.txt

rag files read --client <id> --root root-0 --path f.txt
  -> GET /api/clients/:clientId
  -> GET {clientHttpBaseUrl}/files/read?rootId=root-0&path=f.txt

rag files write --client <id> --root root-0 --path f.txt --content "x"
  -> GET /api/clients/:clientId
  -> PUT {clientHttpBaseUrl}/files/write?rootId=root-0&path=f.txt  (body = content)

rag files upload --client <id> --root root-0 --path . --file ./x
  -> GET /api/clients/:clientId
  -> POST {clientHttpBaseUrl}/files/upload?rootId=root-0&path=.&filename=x  (body = file bytes)

rag files download --client <id> --root root-0 --path x --output ./x
  -> GET /api/clients/:clientId
  -> GET {clientHttpBaseUrl}/files/download?rootId=root-0&path=x  (response = raw bytes)

rag files mkdir --client <id> --root root-0 --path dir
  -> GET /api/clients/:clientId
  -> POST {clientHttpBaseUrl}/files/mkdir  {"rootId":"root-0","path":"dir","recursive":true}

rag files delete --client <id> --root root-0 --path dir --recursive
  -> GET /api/clients/:clientId
  -> DELETE {clientHttpBaseUrl}/files?rootId=root-0&path=dir&recursive=true

rag files move --client <id> --root root-0 --from a --to b
  -> GET /api/clients/:clientId
  -> POST {clientHttpBaseUrl}/files/move  {"rootId":"root-0","from":"a","to":"b","overwrite":false}

rag files copy --client <id> --root root-0 --from a --to b
  -> GET /api/clients/:clientId
  -> POST {clientHttpBaseUrl}/files/copy  {"rootId":"root-0","from":"a","to":"b","overwrite":false}
```

## FRP Mappings (Client HTTP Direct)

```text
rag frp list --client <id>
  -> GET /api/clients/:clientId
  -> GET {clientHttpBaseUrl}/frp/mappings

rag frp create --client <id> --name web --type tcp --local-port 3000
  -> GET /api/clients/:clientId
  -> POST {clientHttpBaseUrl}/frp/mappings
     {"name":"web","type":"tcp","localHost":"127.0.0.1","localPort":3000}

rag frp delete --client <id> --mapping pm_abc
  -> GET /api/clients/:clientId
  -> DELETE {clientHttpBaseUrl}/frp/mappings/pm_abc
```

## Tasks (Server API Only)

```text
rag tasks list
  -> GET /api/tasks

rag tasks list --client <id>
  -> GET /api/tasks?clientId=<id>

rag tasks list --action file.write
  -> GET /api/tasks?actionType=file.write

rag tasks get --record <recordId>
  -> GET /api/tasks/:recordId
```

## Doctor

```text
rag doctor
  -> GET /api/clients  (lists clients, checks server reachable)

rag doctor --client <id>
  -> GET /api/clients/:id  (checks client HTTP ready)
  -> GET {clientHttpBaseUrl}/health
  -> GET {clientHttpBaseUrl}/files/roots
  -> GET {clientHttpBaseUrl}/frp/mappings
```

## Important Notes

- Do **not** use old `/api/agent/*` routes as the primary interface. They are not the current API model.
- File data flows directly between the agent and the client HTTP service through FRP tunnels — it never passes through the server's application layer.
- Client HTTP tokens are per-client and are obtained from `GET /api/clients/:clientId` each time; the CLI handles this transparently.
