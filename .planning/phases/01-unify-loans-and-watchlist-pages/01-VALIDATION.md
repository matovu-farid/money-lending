---
phase: 1
slug: unify-loans-and-watchlist-pages
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-03-31
---

# Phase 1 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | vitest + cypress |
| **Config file** | vitest.config.ts, cypress.config.ts |
| **Quick run command** | `npx vitest run --reporter=verbose` |
| **Full suite command** | `npx vitest run && npx cypress run` |
| **Estimated runtime** | ~60 seconds |

---

## Sampling Rate

- **After every task commit:** Run `npx vitest run --reporter=verbose`
- **After every plan wave:** Run `npx vitest run && npx cypress run`
- **Before `/gsd:verify-work`:** Full suite must be green
- **Max feedback latency:** 60 seconds

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|-----------|-------------------|-------------|--------|
| TBD | 01 | 1 | Unified data query | unit | `npx vitest run` | ⬜ W0 | ⬜ pending |
| TBD | 01 | 1 | Sidebar update | e2e | `npx cypress run --spec cypress/e2e/unified-loans.cy.ts` | ⬜ W0 | ⬜ pending |
| TBD | 02 | 1 | Filter tabs | e2e | `npx cypress run --spec cypress/e2e/unified-loans.cy.ts` | ⬜ W0 | ⬜ pending |
| TBD | 02 | 1 | Print support | e2e | `npx cypress run --spec cypress/e2e/unified-loans.cy.ts` | ⬜ W0 | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] `cypress/e2e/unified-loans.cy.ts` — E2E test stubs for unified loans page
- [ ] Existing vitest infrastructure covers unit test needs

*Existing infrastructure covers most phase requirements.*

---

## Manual-Only Verifications

*All phase behaviors have automated verification (Cypress E2E tests per CLAUDE.md policy).*

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 60s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
