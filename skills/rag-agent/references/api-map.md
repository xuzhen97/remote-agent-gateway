# CLI to API Map

```text
rag clients list
  -> GET /api/clients

rag clients get --client <id>
  -> GET /api/clients/:id

rag jobs run
  -> GET /api/clients/:id
  -> POST {clientHttpBaseUrl}/jobs/command

rag jobs script
  -> GET /api/clients/:id
  -> POST {clientHttpBaseUrl}/jobs/script

rag files read
  -> GET /api/clients/:id
  -> GET {clientHttpBaseUrl}/files/read?rootId=...&path=...

rag files write
  -> GET /api/clients/:id
  -> PUT {clientHttpBaseUrl}/files/write?rootId=...&path=...

rag frp create
  -> GET /api/clients/:id
  -> POST {clientHttpBaseUrl}/frp/mappings

rag tasks list
  -> GET /api/tasks
```

Do not use old `/api/agent/*` routes as the primary interface.
