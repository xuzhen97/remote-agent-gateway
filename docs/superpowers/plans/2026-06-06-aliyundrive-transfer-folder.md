# Aliyun Drive Transfer Folder Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make `transferFolder` actually control where relay files are stored in Aliyun Drive, and align the rag-agent skill documentation with the real CLI behavior.

**Architecture:** Add minimal folder-ensure support to the Aliyun OpenAPI client, use it from `TransferService.createUpload()` to resolve a dedicated parent folder before creating relay files, then update skill documentation to describe the real `auto` transfer behavior and dedicated relay folder semantics.

**Tech Stack:** TypeScript, Fastify, Vitest, Markdown skill docs

---

### Task 1: Aliyun folder resolution in upload creation

**Files:**
- Modify: `apps/server/src/modules/aliyundrive/aliyundrive-openapi.client.ts`
- Modify: `apps/server/src/modules/aliyundrive/aliyundrive-openapi.client.test.ts`
- Modify: `apps/server/src/modules/transfers/transfer.service.ts`
- Modify: `apps/server/src/modules/transfers/transfer.service.test.ts`

- [ ] Add failing tests for ensuring nested transfer folders and using their file id as `parentFileId`.
- [ ] Run targeted server tests to verify failure.
- [ ] Implement minimal folder ensure helpers and wire `transferFolder` into `createUpload()`.
- [ ] Run targeted server tests to verify pass.

### Task 2: Skill/CLI behavior sync docs

**Files:**
- Modify: `C:/Users/xuzhe/.pi/agent/skills/rag-agent/SKILL.md`

- [ ] Update skill documentation to describe real aliyundrive auto-upload behavior and dedicated transfer folder semantics.
- [ ] Self-review wording against actual CLI behavior.

### Task 3: End-to-end verification

**Files:**
- No code changes expected

- [ ] Run `pnpm test`.
- [ ] Run `pnpm typecheck`.
- [ ] Re-run a real CLI upload and verify it still completes through aliyundrive mode.
