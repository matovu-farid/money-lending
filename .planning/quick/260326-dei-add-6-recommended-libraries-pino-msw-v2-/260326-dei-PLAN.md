---
phase: quick
plan: 260326-dei
type: execute
wave: 1
depends_on: []
files_modified:
  - package.json
  - pnpm-lock.yaml
  - src/lib/logger.ts
  - src/lib/msw/handlers.ts
  - src/lib/msw/server.ts
  - src/lib/store.ts
autonomous: true
requirements: []
must_haves:
  truths:
    - "All 6 libraries are installed and importable"
    - "Pino has a configured logger instance ready for use"
    - "MSW v2 has handler and server scaffolds ready for test mocking"
    - "All existing tests (unit, integration, e2e) still pass"
  artifacts:
    - path: "src/lib/logger.ts"
      provides: "Pino logger singleton with dev-friendly pino-pretty"
    - path: "src/lib/msw/handlers.ts"
      provides: "Empty MSW v2 handler array scaffold"
    - path: "src/lib/msw/server.ts"
      provides: "MSW setupServer for Vitest integration"
  key_links: []
---

<objective>
Install 6 recommended libraries (Pino, MSW v2, ts-pattern, TanStack Table, @zod/mini, Zustand) with minimal configuration scaffolds. No existing code is refactored to use them -- this is installation and setup only.

Purpose: Make these libraries available for future use without breaking anything.
Output: Updated package.json, lock file, and minimal config files for Pino and MSW.
</objective>

<execution_context>
@/Users/faridmatovu/.claude/get-shit-done/workflows/execute-plan.md
@/Users/faridmatovu/.claude/get-shit-done/templates/summary.md
</execution_context>

<context>
@.planning/STATE.md
@package.json
</context>

<tasks>

<task type="auto">
  <name>Task 1: Install all 6 libraries and create config scaffolds</name>
  <files>package.json, pnpm-lock.yaml, src/lib/logger.ts, src/lib/msw/handlers.ts, src/lib/msw/server.ts, src/lib/store.ts</files>
  <action>
    1. Install production dependencies:
       pnpm add pino pino-pretty ts-pattern @tanstack/react-table @zod/mini zustand

    2. Install MSW as a dev dependency (test mocking only):
       pnpm add -D msw

    Note: msw is already in pnpm.onlyBuiltDependencies in package.json -- leave that as-is.

    3. Create src/lib/logger.ts -- a Pino logger singleton:
       - Import pino
       - Export a default logger instance
       - In development (process.env.NODE_ENV !== 'production'), use pino-pretty transport for readable output
       - In production, use default JSON transport
       - Set base level to 'info' in production, 'debug' in development

    4. Create src/lib/msw/handlers.ts:
       - Import { http, HttpResponse } from 'msw'
       - Export an empty handlers array (typed as RequestHandler[])
       - Add a comment: "Add mock API handlers here for tests"

    5. Create src/lib/msw/server.ts:
       - Import { setupServer } from 'msw/node'
       - Import handlers from './handlers'
       - Export const server = setupServer(...handlers)
       - Add comments explaining: call server.listen() in beforeAll, server.resetHandlers() in afterEach, server.close() in afterAll

    6. Create src/lib/store.ts -- a minimal Zustand scaffold:
       - Import { create } from 'zustand'
       - Export a placeholder empty store (e.g., useAppStore with empty state interface)
       - Add a comment: "Add client-side state slices here as needed"

    No configuration needed for ts-pattern, @tanstack/react-table, or @zod/mini -- they are import-and-use libraries.
  </action>
  <verify>
    <automated>cd /Users/faridmatovu/projects/money-lending && node -e "require('pino'); require('ts-pattern'); require('@tanstack/react-table'); require('zustand'); require('msw'); console.log('All 6 libraries importable')" && npx tsc --noEmit --skipLibCheck 2>&1 | head -20</automated>
  </verify>
  <done>All 6 libraries installed. Pino logger, MSW server scaffold, and Zustand store scaffold exist and compile without errors.</done>
</task>

<task type="auto">
  <name>Task 2: Run all test suites and fix any breakage</name>
  <files>package.json</files>
  <action>
    Run all three test suites in sequence to confirm nothing is broken:

    1. Unit tests: pnpm test (vitest run)
    2. Integration tests: pnpm test:integration (vitest run --config vitest.integration.config.ts)
    3. E2E tests: pnpm test:e2e (cypress run)

    If any test fails due to the new installations (e.g., module resolution conflicts, type conflicts):
    - Diagnose the root cause
    - Fix minimally without changing test logic
    - Re-run the failing suite

    Common potential issues:
    - MSW may need node version compatibility check
    - @zod/mini might conflict with any existing zod usage (check: grep for 'from "zod"' in codebase -- if zod is not installed, no conflict)
    - pino-pretty may need to be in dependencies not devDependencies since logger.ts is production code

    Do NOT skip or disable any existing tests.
  </action>
  <verify>
    <automated>cd /Users/faridmatovu/projects/money-lending && pnpm test 2>&1 | tail -5 && pnpm test:integration 2>&1 | tail -5</automated>
  </verify>
  <done>All unit and integration tests pass. E2E tests pass (or pre-existing failures documented). No regressions from library installation.</done>
</task>

</tasks>

<verification>
- All 6 packages appear in package.json dependencies/devDependencies
- src/lib/logger.ts, src/lib/msw/handlers.ts, src/lib/msw/server.ts, src/lib/store.ts exist
- TypeScript compilation succeeds
- All existing test suites pass without regression
</verification>

<success_criteria>
- 6 libraries installed: pino, pino-pretty, msw, ts-pattern, @tanstack/react-table, @zod/mini, zustand
- Minimal config scaffolds for Pino (logger), MSW (server + handlers), Zustand (store)
- Zero test regressions
</success_criteria>

<output>
After completion, create `.planning/quick/260326-dei-add-6-recommended-libraries-pino-msw-v2-/260326-dei-SUMMARY.md`
</output>
