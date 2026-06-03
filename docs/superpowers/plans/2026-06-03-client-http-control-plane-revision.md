# Client HTTP Control Plane Revision Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this revision task-by-task.

**Goal:** Complete the mandatory UI paths for managing client files and FRP mappings through the client HTTP service.

**Architecture:** Browser pages use server discovery to obtain `clientHttpBaseUrl` and `clientHttpToken`. File operations call client HTTP directly from the browser so file bodies do not pass through server. Mapping management uses lightweight server admin orchestration for JSON create/delete/list calls, while client HTTP owns the local frpc config update.

**Tech Stack:** TypeScript, Node.js native HTTP, React, Ant Design, Vitest.

---

## Revision Tasks

### Task R1: Client HTTP File API

- Add `apps/client/src/runtime/control-http/file-routes.ts`.
- Register `/files/roots`, `/files`, `/files/stat`, `/files/read`, `/files/download`, `/files/write`, `/files/upload`, `/files/mkdir`, `/files`, `/files/move`, `/files/copy` in `control-http/server.ts`.
- Reuse existing `file-roots.ts` and `file-paths.ts` safety helpers.
- Verify client tests and typecheck.

### Task R2: Client HTTP FRP Mapping API

- Add `frp-mapping-store.ts` and `frp-routes.ts` under client control HTTP.
- Add server lightweight allocation routes that allocate/delete DB records without WebSocket task dispatch.
- Ensure `frpc-daemon.ts` preserves the protected control proxy when business mappings are rebuilt.
- Verify server/client tests and typecheck.

### Task R3: React File Manager Page

- Add `ClientFilesPage.tsx`.
- Use server discovery for `clientHttpBaseUrl` and `clientHttpToken`.
- Call client HTTP directly for roots, list, read/download, write, upload, mkdir, and delete.
- Add Files action button to Clients page.
- Verify web build and tests.

### Task R4: React Mapping Management Page Wiring

- Add Mapping action button to Clients page.
- Wire `MappingsPage` to a selected client.
- Keep mapping list/create/delete through lightweight server admin APIs.
- Verify web build and tests.

### Task R5: Final Verification

Run:

```bash
pnpm --filter @rag/shared test
pnpm --filter @rag/server test
pnpm --filter @rag/client test
pnpm --filter @rag/web test
pnpm typecheck
pnpm --filter @rag/web build
```
