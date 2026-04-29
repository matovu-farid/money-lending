<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

# Infrastructure: self-hosted ElectricSQL

We run our **own** ElectricSQL instance plus an nginx caching proxy as a Docker Swarm stack on `node1` (Hetzner). It is **not** Electric Cloud. Anything related to Electric — the proxy in `src/app/api/electric/[...table]/route.ts`, sync transport, bandwidth, caching, deployment — connects to this stack.

- Stack source: `deploy/electric/` (see `deploy/electric/README.md` for full details)
- CI: `.github/workflows/deploy-electric.yml` deploys on push to `main` when `deploy/electric/**` changes
- SSH access to the host: `ssh node1` (configured in the user's `~/.ssh/config`). Use it to inspect `docker service ls`, follow logs, or curl `http://127.0.0.1:3001/v1/health` directly.

# Verification Policy: Cypress Tests Replace Manual Verification

**This project does NOT use `checkpoint:human-verify` tasks for manual/visual verification.**

All verification that would normally require human visual checks MUST be automated with Cypress E2E tests instead. This applies to both plan creation (planner agents) and plan execution (executor agents).

## For GSD Planners (`gsd-planner`, `gsd-phase-researcher`)

When writing PLAN.md files:

- **NEVER** create tasks with `type="checkpoint:human-verify"`. Use `type="auto"` instead.
- The final task of any UI-facing plan MUST include writing Cypress E2E tests that cover all the verification steps that would have been in a `checkpoint:human-verify` task.
- Set `autonomous: true` on all plans — there are no human checkpoints.

**Instead of this:**
```xml
<task type="checkpoint:human-verify" gate="blocking">
  <what-built>Payments page at /payments</what-built>
  <how-to-verify>
    1. Visit /payments and verify table shows rows
    2. Type customer name — verify filter works
    3. Click Edit — verify Sheet opens
  </how-to-verify>
  <resume-signal>Type "approved" or describe issues</resume-signal>
</task>
```

**Write this:**
```xml
<task type="auto" tdd="true">
  <name>E2E tests for /payments page</name>
  <files>cypress/e2e/payments-list.cy.ts</files>
  <action>
    Write Cypress E2E tests covering:
    1. Page renders with table and correct columns
    2. Customer name filter updates results
    3. Edit Sheet opens from row dropdown
    4. Delete Dialog requires reason
    5. CSV export button enabled/disabled states
    6. Empty states render correctly
  </action>
  <verify>
    <automated>npx cypress run --spec cypress/e2e/payments-list.cy.ts</automated>
  </verify>
</task>
```

## For GSD Executors (`gsd-executor`)

When executing plans:

- If you encounter a `checkpoint:human-verify` task (from an older plan), convert it: write Cypress E2E tests covering the verification checklist, run them, and treat passing tests as "approved".
- Always run `npx cypress run --spec <file>` to verify — do not ask the user for visual confirmation.
- If Cypress tests fail, fix the code and re-run. Do not present a checkpoint to the user.

## What Cypress Tests Must Cover

For any UI page or feature, the E2E test file must verify:

- **Rendering:** Page loads, headings visible, key elements present
- **Data display:** Table rows show correct data, formatting (dates, currency)
- **Filters/search:** Each filter input works, clear filters resets state
- **CRUD actions:** Create/edit/delete flows complete successfully with correct toasts
- **Empty states:** Correct messages when no data or no filter matches
- **Navigation:** Sidebar links, pagination, URL parameter sync
- **Authorization:** Admin-only actions visible/hidden based on role

## Exceptions

`checkpoint:decision` and `checkpoint:human-action` (auth gates) remain unchanged — those genuinely require human input and cannot be automated.
