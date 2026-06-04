#!/bin/bash
set -e
echo ""
echo "╔══════════════════════════════════════════╗"
echo "║  Remote Agent Gateway — E2E Tests       ║"
echo "╚══════════════════════════════════════════╝"
echo ""
echo "Starting test suite..."
echo ""
pnpm build
echo ""
tsx scripts/e2e-test.ts "$@"
