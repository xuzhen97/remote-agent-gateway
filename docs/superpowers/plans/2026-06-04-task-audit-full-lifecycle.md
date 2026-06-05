# Task Audit Full Lifecycle Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make task audit records capture the full job lifecycle, summarized output, and on-demand detailed logs so the web console shows a complete audit trail.

**Architecture:** Keep a single audit record per task action, update it as the job progresses, mirror the latest version to the server with upsert semantics, and let the web detail view render structured lifecycle/output summaries while lazily loading full logs by `jobId`.

**Tech Stack:** TypeScript, Vitest, Fastify, React, Ant Design, existing task audit mirror pipeline.

---

### Task 1: Extend shared audit shapes for lifecycle summaries
- [ ] Add failing shared/schema tests for enriched `resultSummary` / `metadata`
- [ ] Implement minimal shared type/schema updates
- [ ] Run shared tests

### Task 2: Let client audit store update existing records
- [ ] Add failing store tests for record replacement/update
- [ ] Implement store update API
- [ ] Run store tests

### Task 3: Capture full job lifecycle into audit records
- [ ] Add failing client tests proving `job.command` audit records are updated on completion with lifecycle + output tail + extracted fields
- [ ] Implement job audit tracker / record update flow
- [ ] Run client task-audit tests

### Task 4: Make server mirror endpoint upsert updated records
- [ ] Add failing server tests proving same `recordId` updates existing task history row
- [ ] Implement upsert behavior in tasks service
- [ ] Run server task tests

### Task 5: Upgrade web task detail UX
- [ ] Add failing web tests for readable lifecycle summary + detail sections + on-demand logs fetch
- [ ] Implement task page rendering changes
- [ ] Run web tests

### Task 6: End-to-end verification
- [ ] Run targeted typecheck/tests for shared, client, server, web
- [ ] Run `pnpm dev`, execute `ipconfig` through bundled rag skill, verify task page manually/with browser
- [ ] Commit changes
