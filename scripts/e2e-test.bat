@echo off
echo.
echo ╔══════════════════════════════════════════╗
echo ║  Remote Agent Gateway — E2E Tests       ║
echo ╚══════════════════════════════════════════╝
echo.
echo Starting test suite...
echo.
call pnpm build
echo.
call tsx scripts/e2e-test.ts %*
