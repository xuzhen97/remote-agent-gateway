# CLI Jobs Wait/Logs/Events Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make command/script execution support first-class result-following so agents can execute and immediately retrieve status, logs, or live events without manually composing `run -> get -> logs`.

**Architecture:** Extend `jobs run` and `jobs script` with `--wait`, `--logs`, and `--events` behaviors in the CLI command layer while keeping existing low-level endpoints unchanged. Update the rag-agent skill docs to require result-following after job execution.

**Tech Stack:** TypeScript, Commander, Vitest, existing ClientHttpApi jobs endpoints.
