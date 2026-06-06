# Aliyun Drive Auth Status Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Show persisted authorization status immediately on page load, add real remote authorization validation, and keep the left navigation fixed while only the right content pane scrolls.

**Architecture:** Extend the server auth service with a remote validation method and richer local authorization state, expose that through the existing status/test APIs, then update the web page to display both local and remote auth states and auto-run validation when locally authorized. Fix layout scrolling by constraining the app shell to viewport height and making only the content area scrollable.

**Tech Stack:** TypeScript, Fastify, React 19, Ant Design 5, Vitest

---

### Task 1: Server auth status and validation API

**Files:**
- Modify: `apps/server/src/modules/aliyundrive/aliyundrive-auth.service.ts`
- Modify: `apps/server/src/modules/aliyundrive/aliyundrive.routes.ts`
- Modify: `apps/server/src/modules/aliyundrive/aliyundrive-auth.service.test.ts`
- Modify: `apps/server/src/modules/aliyundrive/aliyundrive.routes.test.ts`

- [ ] Add failing tests for local authorizationState calculation and remote validation result.
- [ ] Run server aliyundrive tests to verify failure.
- [ ] Implement `authorizationState` in status and a real `testAuthorization()` method.
- [ ] Wire `/api/aliyundrive/test` to the new method.
- [ ] Run targeted server tests to verify pass.

### Task 2: Web page status UX

**Files:**
- Modify: `apps/web/src/api/aliyundrive.ts`
- Modify: `apps/web/src/pages/AliyunDrivePage.tsx`
- Modify: `apps/web/src/pages/AliyunDrivePage.test.tsx`

- [ ] Add failing tests for automatic validation on locally authorized status and for rendering separate local/remote states.
- [ ] Run web page test to verify failure.
- [ ] Implement API types, auto-test flow, manual test button, and richer status tags/messages.
- [ ] Run targeted web tests to verify pass.

### Task 3: Fixed shell layout

**Files:**
- Modify: `apps/web/src/components/AppLayout.tsx`
- Create or Modify: `apps/web/src/components/AppLayout.test.tsx`

- [ ] Add failing test for viewport-fixed layout and scrollable content pane.
- [ ] Run layout test to verify failure.
- [ ] Implement the layout style changes.
- [ ] Run targeted web tests to verify pass.

### Task 4: Final verification

**Files:**
- No code changes expected

- [ ] Run `pnpm test`.
- [ ] Run `pnpm typecheck`.
- [ ] Review output and only then report completion.
