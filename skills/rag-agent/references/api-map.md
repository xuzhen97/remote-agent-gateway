# CLI to Server/Client HTTP API Map

All examples below refer to the bundled distributed CLI launcher:

```bash
node ./run.cjs ...
```

`run.cjs` resolves the bundled CLI relative to the skill directory, so callers do not need to execute from that directory.

Client-targeting commands still follow the same two-step flow:
1. server discovery via `/api/clients/:clientId`
2. direct client HTTP operation via `clientHttpBaseUrl + clientHttpToken`

## Discovery

```text
node ./run.cjs clients list
  -> GET /api/clients

node ./run.cjs clients get --client <id>
  -> GET /api/clients/:clientId
  (returns clientHttpBaseUrl + clientHttpToken when httpReady=true)
```

## Jobs (Client HTTP Direct)

```text
node ./run.cjs jobs run --client <id> -- <cmd> [args...]
  -> GET /api/clients/:clientId
  -> POST {clientHttpBaseUrl}/jobs/command
     {"command":"<cmd>","args":[...]}

node ./run.cjs jobs script --client <id> --file ./s.js
  -> GET /api/clients/:clientId
  -> POST {clientHttpBaseUrl}/jobs/script
     {"runtime":"node","script":"<file content>"}

node ./run.cjs jobs get --client <id> --job <jobId>
  -> GET /api/clients/:clientId
  -> GET {clientHttpBaseUrl}/jobs/:jobId

node ./run.cjs jobs logs --client <id> --job <jobId>
  -> GET /api/clients/:clientId
  -> GET {clientHttpBaseUrl}/jobs/:jobId/logs?sinceSeq=...&limit=...

node ./run.cjs jobs events --client <id> --job <jobId>
  -> GET /api/clients/:clientId
  -> GET {clientHttpBaseUrl}/jobs/:jobId/events (SSE)

node ./run.cjs jobs cancel --client <id> --job <jobId>
  -> GET /api/clients/:clientId
  -> POST {clientHttpBaseUrl}/jobs/:jobId/cancel
```

## Files (Client HTTP Direct)

```text
node ./run.cjs files roots --client <id>
  -> GET /api/clients/:clientId
  -> GET {clientHttpBaseUrl}/files/roots

node ./run.cjs files list --client <id> --root root-0 --path .
  -> GET /api/clients/:clientId
  -> GET {clientHttpBaseUrl}/files?rootId=root-0&path=.

node ./run.cjs files read --client <id> --root root-0 --path f.txt
  -> GET /api/clients/:clientId
  -> GET {clientHttpBaseUrl}/files/read?rootId=root-0&path=f.txt

node ./run.cjs files write --client <id> --root root-0 --path f.txt --content "x"
  -> GET /api/clients/:clientId
  -> PUT {clientHttpBaseUrl}/files/write?rootId=root-0&path=f.txt  (body = content)

node ./run.cjs files upload --client <id> --root root-0 --path . --file ./x
  -> GET /api/clients/:clientId
  -> POST {clientHttpBaseUrl}/files/upload?rootId=root-0&path=.&filename=x  (body = file bytes)

node ./run.cjs files download --client <id> --root root-0 --path x --output ./x
  -> GET /api/clients/:clientId
  -> GET {clientHttpBaseUrl}/files/download?rootId=root-0&path=x  (response = raw bytes)

node ./run.cjs files mkdir --client <id> --root root-0 --path dir
  -> GET /api/clients/:clientId
  -> POST {clientHttpBaseUrl}/files/mkdir  {"rootId":"root-0","path":"dir","recursive":true}

node ./run.cjs files delete --client <id> --root root-0 --path dir --recursive
  -> GET /api/clients/:clientId
  -> DELETE {clientHttpBaseUrl}/files?rootId=root-0&path=dir&recursive=true

node ./run.cjs files move --client <id> --root root-0 --from a --to b
  -> GET /api/clients/:clientId
  -> POST {clientHttpBaseUrl}/files/move  {"rootId":"root-0","from":"a","to":"b","overwrite":false}

node ./run.cjs files copy --client <id> --root root-0 --from a --to b
  -> GET /api/clients/:clientId
  -> POST {clientHttpBaseUrl}/files/copy  {"rootId":"root-0","from":"a","to":"b","overwrite":false}
```

## FRP Mappings (Client HTTP Direct)

```text
node ./run.cjs frp list --client <id>
  -> GET /api/clients/:clientId
  -> GET {clientHttpBaseUrl}/frp/mappings

node ./run.cjs frp create --client <id> --name web --type tcp --local-port 3000
  -> GET /api/clients/:clientId
  -> POST {clientHttpBaseUrl}/frp/mappings
     {"name":"web","type":"tcp","localHost":"127.0.0.1","localPort":3000}

node ./run.cjs frp delete --client <id> --mapping pm_abc
  -> GET /api/clients/:clientId
  -> DELETE {clientHttpBaseUrl}/frp/mappings/pm_abc
  -> client HTTP route calls DELETE /api/client-http/ports/:mappingId on the server
  -> client HTTP route calls POST /api/client-http/ports/cleanup-dashboard on the server
  -> server polls FRPS dashboard and clears offline residue before success returns
```

## Tasks (Server API Only)

```text
node ./run.cjs tasks list
  -> GET /api/tasks

node ./run.cjs tasks list --client <id>
  -> GET /api/tasks?clientId=<id>

node ./run.cjs tasks list --action file.write
  -> GET /api/tasks?actionType=file.write

node ./run.cjs tasks get --record <recordId>
  -> GET /api/tasks/:recordId
```

## Doctor

```text
node ./run.cjs doctor
  -> GET /api/clients  (lists clients, checks server reachable)

node ./run.cjs doctor --client <id>
  -> GET /api/clients/:id  (checks client HTTP ready)
  -> GET {clientHttpBaseUrl}/health
  -> GET {clientHttpBaseUrl}/files/roots
  -> GET {clientHttpBaseUrl}/frp/mappings
```

## Important Notes

- Do not use old `/api/agent/*` routes as the primary interface.
- File data flows directly between the agent and the client HTTP service through FRP tunnels.
- Client HTTP tokens are per-client and are obtained from `GET /api/clients/:clientId` each time; the CLI handles this transparently.
