# Phase 10: Verification & Documentation Cleanup — Research

**Researched:** 2026-03-24
**Domain:** Documentation artifacts, Cypress E2E confirmation, VERIFICATION.md authoring
**Confidence:** HIGH

---

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|-----------------|
| PAY-01 | User can view a paginated list of all payments across all loans | Implementation confirmed in 06-01-SUMMARY.md (bccc3b5 + f087fb1). VERIFICATION.md gap only — code complete. |
| PAY-02 | User can see customer name, loan reference, amount, date, and allocation breakdown | Implementation confirmed in 06-01-SUMMARY.md. Same verification gap. |
| PAY-03 | User can filter payments by date range | Implementation confirmed in 06-01-SUMMARY.md. Same verification gap. |
| PAY-04 | User can filter payments by amount range | Implementation confirmed in 06-01-SUMMARY.md. Same verification gap. |
| PAY-05 | User can search payments by customer name | Implementation confirmed in 06-01-SUMMARY.md. Same verification gap. |
| PAY-06 | User can edit a payment directly from the global list (admin+ only) | Code confirmed wired: editPaymentAction + admin dropdown in PaymentsClient.tsx + revalidatePath. Unchecked in REQUIREMENTS.md. Not in any SUMMARY requirements_completed. No VERIFICATION.md. |
| PAY-07 | User can delete a payment directly from the global list (admin+ only) | Code confirmed wired: deletePaymentAction + admin dropdown + revalidatePath. Same gaps as PAY-06. |
| PAY-08 | User can export the filtered payment list to CSV | Code confirmed: exportToCsv() client-side in PaymentsClient.tsx. Same gaps as PAY-06/07. |
</phase_requirements>

---

## Summary

Phase 10 is a documentation and verification closure phase. All implementation for PAY-01 through PAY-08 was completed in Phase 6 — the code is wired and confirmed working by the v1.1-MILESTONE-AUDIT.md integration checker. The gaps are purely in the documentation layer: Phase 6 has no VERIFICATION.md, PAY-06/07/08 are unchecked in REQUIREMENTS.md, and the 06-02-SUMMARY.md has an empty `requirements_completed` field. Phase 9's VERIFICATION.md is stale (the DS-12 subtitle gap it documented was fixed in commit 83616ee, and SUMMARY plans 03-05 never declared DS-07 through DS-11 in their `requirements_completed` fields).

The primary deliverable of this phase is creating a Phase 6 VERIFICATION.md that confirms all 8 PAY requirements are satisfied, then updating the three supporting documentation artifacts: REQUIREMENTS.md checkboxes, 06-02-SUMMARY.md frontmatter, and a refreshed Phase 9 VERIFICATION.md. An automated Cypress run of `payments-list.cy.ts` is required to confirm the 23-test suite passes before writing the verification report.

The success criteria are fully deterministic: each artifact either exists with the right content or it does not. There is no implementation work; this is document-authoring driven by verified evidence gathering.

**Primary recommendation:** Run `payments-list.cy.ts` Cypress spec first to gather the Cypress pass evidence, then write Phase 6 VERIFICATION.md using that evidence alongside code inspection of PaymentsClient.tsx and payment.actions.ts for PAY-06/07/08.

---

## Current State of Artifacts

### Phase 6 Documentation Gaps (confirmed from MILESTONE-AUDIT.md)

| Artifact | Current State | Required State |
|----------|--------------|----------------|
| `.planning/phases/06-global-payments-list/06-VERIFICATION.md` | **MISSING** | Exists, status=passed, all 8 PAY requirements verified |
| `.planning/REQUIREMENTS.md` PAY-06, PAY-07, PAY-08 | `[ ]` unchecked | `[x]` checked |
| `06-02-SUMMARY.md` `requirements-completed` field | Empty (no list) | `[PAY-06, PAY-07, PAY-08]` |

### Phase 9 Documentation Gaps (confirmed from MILESTONE-AUDIT.md + current code inspection)

| Artifact | Current State | Required State |
|----------|--------------|----------------|
| `09-VERIFICATION.md` | `status: gaps_found`, score 7/8, reports subtitle gap flagged | Re-run verification: status=passed, score 8/8, gap resolved in 83616ee |
| Phase 9 SUMMARY plans 03-05 `requirements_completed` | Empty / absent in frontmatter | Must claim DS-07 (plan 03), DS-08/DS-09/DS-10 (plan 04), DS-11 (plan 05) |

### Report Subtitle Fix — Already Done

The VERIFICATION.md gap for DS-12 (report subtitles) documented `text-sm text-muted-foreground` as the wrong class. Code inspection confirms this was fixed in commit 83616ee. Current state of all four report pages:

- `src/app/(app)/reports/page.tsx:49` — `text-xs font-semibold uppercase tracking-wider text-muted-foreground`
- `src/app/(app)/reports/portfolio/page.tsx:15` — `text-xs font-semibold uppercase tracking-wider text-muted-foreground`
- `src/app/(app)/reports/pnl/page.tsx:29` — `text-xs font-semibold uppercase tracking-wider text-muted-foreground`
- `src/app/(app)/reports/balance-sheet/page.tsx:36` — `text-xs font-semibold uppercase tracking-wider text-muted-foreground`

The Phase 9 VERIFICATION.md refresh only needs to re-read these files and update the report — no code changes required.

---

## Architecture Patterns

### VERIFICATION.md Structure (from Phase 7 and Phase 8 examples)

VERIFICATION.md files in this project follow a strict YAML frontmatter + markdown body structure:

```yaml
---
phase: {phase-slug}
verified: {ISO-8601 datetime}
status: passed | gaps_found
score: {N}/{M} must-haves verified
re_verification: false | true
gaps: []
---
```

Body sections:
1. **Goal Achievement** — Observable Truths table with `#`, `Truth`, `Status`, `Evidence` columns
2. **Required Artifacts** — table of key files with `Artifact`, `Expected`, `Status`, `Details`
3. **Key Link Verification** — table checking cross-component wiring
4. **Requirements Coverage** — table mapping requirement IDs to satisfaction evidence
5. **Anti-Patterns Found** — any deviations from project conventions
6. **Gaps Summary** — narrative of what is missing (empty if status=passed)

### Phase 6 VERIFICATION.md Observable Truths to Document

These truths correspond directly to the 8 PAY requirements:

| # | Truth | Evidence Source |
|---|-------|----------------|
| 1 | listPayments service returns paginated payments with isNull(deletedAt) filter | 06-01-SUMMARY.md, payment.service.ts |
| 2 | Each row includes customerName, loanRef, amount, interestPortion, principalPortion, balanceAfter | PaymentsClient.tsx column definitions |
| 3 | Date range filter (dateFrom/dateTo) applies T23:59:59.999Z inclusive boundary | payment.service.ts, 06-01-SUMMARY decisions |
| 4 | Amount range filter (amountMin/amountMax) implemented | payment.service.ts, PaymentsClient filter bar |
| 5 | Customer name filter uses case-insensitive ilike | payment.service.ts |
| 6 | editPaymentAction is admin-gated and revalidates /payments | payment.actions.ts, PaymentsClient.tsx Edit Sheet |
| 7 | deletePaymentAction is admin-gated, requires reason, revalidates /payments | payment.actions.ts, PaymentsClient.tsx Delete Dialog |
| 8 | exportToCsv() generates payments-YYYY-MM-DD.csv client-side; button disabled when no rows | PaymentsClient.tsx |

### Cypress Evidence Gathering

The payments-list.cy.ts file has 23 test cases covering PAY-01 through PAY-08 (confirmed by reading the file). The run command is:

```bash
npx cypress run --spec cypress/e2e/payments-list.cy.ts
```

The VERIFICATION.md must record the Cypress run result. Per project convention (09-06-SUMMARY.md), a design-system test run was the primary evidence source for DS-12. Same pattern applies here.

### SUMMARY.md requirements_completed Format

From 06-01-SUMMARY.md and 09-01-SUMMARY.md, the correct YAML format is:

```yaml
requirements-completed: [PAY-06, PAY-07, PAY-08]
```

Note: the key uses a hyphen (`requirements-completed`), not underscore. The frontmatter field is on one line with a bracketed list. The 09-01-SUMMARY.md uses a multi-line list format; either is acceptable, but the compact bracket format matches most plans.

### REQUIREMENTS.md Checkbox Format

Current unchecked entries:
```markdown
- [ ] **PAY-06**: User can edit a payment directly from the global list (admin+ only)
- [ ] **PAY-07**: User can delete a payment directly from the global list (admin+ only)
- [ ] **PAY-08**: User can export the filtered payment list to CSV
```

Must be changed to:
```markdown
- [x] **PAY-06**: User can edit a payment directly from the global list (admin+ only)
- [x] **PAY-07**: User can delete a payment directly from the global list (admin+ only)
- [x] **PAY-08**: User can export the filtered payment list to CSV
```

---

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Verification evidence | Re-implement or re-run tests from scratch | Read existing SUMMARY.md files + run Cypress once | All evidence already exists in committed artifacts |
| Phase 9 VERIFICATION.md content | Rewrite from scratch | Update the existing 09-VERIFICATION.md in place — change `status`, `score`, clear `gaps`, update the truth table row for #7 and #8 | Preserves the verified content; only 3 fields change |
| PAY-06/07/08 code confirmation | Re-read all source files exhaustively | Read only PaymentsClient.tsx and payment.actions.ts | Audit already confirmed these as the relevant files |

---

## Common Pitfalls

### Pitfall 1: Writing VERIFICATION.md Without Running Cypress

**What goes wrong:** The audit flagged that `payments-list.cy.ts` exists with 23 tests but no Cypress run was confirmed. A VERIFICATION.md that says "VERIFIED — Cypress 23/23" without actually running the spec is a documentation lie.

**How to avoid:** Run `npx cypress run --spec cypress/e2e/payments-list.cy.ts` before writing the VERIFICATION.md. Record the actual pass/fail counts from the output.

**Warning signs:** The 09-06-SUMMARY.md noted "Pre-existing failures in payments-list (6 tests)" — these may have been fixed or may still exist. The Cypress run output is the ground truth.

### Pitfall 2: Confusing re_verification Flag

**What goes wrong:** The Phase 9 VERIFICATION.md refresh is a re-verification of a phase that was already verified. The `re_verification` frontmatter field should be `true` in the refreshed file.

**How to avoid:** Set `re_verification: true` in the updated 09-VERIFICATION.md frontmatter.

### Pitfall 3: Partial SUMMARY Frontmatter Updates

**What goes wrong:** The audit identifies DS-07 through DS-11 as missing from SUMMARY requirements_completed. These 5 DS requirements span plans 03, 04, and 05. Updating only one SUMMARY (e.g. 09-06-SUMMARY.md) or the wrong one leaves the gap.

**The mapping (from plan content):**
- DS-07 (Sidebar/TopBar tonal separation, no borders) — covered by 09-03-PLAN.md → update 09-03-SUMMARY.md
- DS-08 (AppShell bg-background surface tier) — covered by 09-03-PLAN.md → update 09-03-SUMMARY.md
- DS-09 (KpiCard + core page typography) — covered by 09-04-PLAN.md → update 09-04-SUMMARY.md
- DS-10 (Core page headings tracking-tight + label subtitles) — covered by 09-04-PLAN.md → update 09-04-SUMMARY.md
- DS-11 (Secondary pages typography) — covered by 09-05-PLAN.md → update 09-05-SUMMARY.md

**Note on DS numbering:** The original REQUIREMENTS.md now contains DS-01 through DS-12 (confirmed in current file). The orphaned-requirements issue noted in the stale 09-VERIFICATION.md has already been resolved.

### Pitfall 4: Changing Phase 9 VERIFICATION.md Status Without Verifying the Fix

**What goes wrong:** The stale 09-VERIFICATION.md lists two gaps. One gap (report subtitle wrong typography) was fixed in commit 83616ee. Code inspection confirms the fix is in place. The second gap (DS-01..DS-12 orphaned in REQUIREMENTS.md) was resolved by adding DS requirements to REQUIREMENTS.md. The refreshed VERIFICATION.md should confirm both fixes before declaring status=passed.

**How to avoid:** Read the four report page files and REQUIREMENTS.md before updating the VERIFICATION.md, not after.

---

## Execution Order

The planner should sequence tasks in this order to avoid writing verification docs before gathering evidence:

1. **Run Cypress** — `npx cypress run --spec cypress/e2e/payments-list.cy.ts` — gather pass/fail counts
2. **Write Phase 6 VERIFICATION.md** — use Cypress output + code inspection evidence
3. **Update REQUIREMENTS.md** — check off PAY-06, PAY-07, PAY-08
4. **Update 06-02-SUMMARY.md** — add `requirements-completed: [PAY-06, PAY-07, PAY-08]` to frontmatter
5. **Update Phase 9 SUMMARY files** — add requirements_completed to 09-03, 09-04, 09-05 SUMMARYs
6. **Refresh Phase 9 VERIFICATION.md** — update status, score, gaps, re_verification=true

This order ensures each document is written with verified evidence and each update is grounded in actual artifact state.

---

## Validation Architecture

### Test Framework

| Property | Value |
|----------|-------|
| Framework | Cypress 14.x (E2E) |
| Config file | `cypress.config.ts` |
| Quick run command | `npx cypress run --spec cypress/e2e/payments-list.cy.ts` |
| Full suite command | `npx cypress run` |

### Phase Requirements → Test Map

| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| PAY-01 | Paginated payments list renders | E2E | `npx cypress run --spec cypress/e2e/payments-list.cy.ts` | Yes |
| PAY-02 | Table shows correct columns | E2E | same spec | Yes |
| PAY-03 | Date range filter works | E2E | same spec | Yes |
| PAY-04 | Amount range filter works | E2E | same spec | Yes |
| PAY-05 | Customer name search works | E2E | same spec | Yes |
| PAY-06 | Admin can edit payment | E2E | same spec | Yes |
| PAY-07 | Admin can delete payment | E2E | same spec | Yes |
| PAY-08 | CSV export button enabled/disabled | E2E | same spec | Yes |

### Sampling Rate

- **Per task commit:** `npx cypress run --spec cypress/e2e/payments-list.cy.ts`
- **Phase gate:** Cypress spec fully green before writing VERIFICATION.md

### Wave 0 Gaps

None — all test infrastructure exists. The single gap is a confirmed Cypress run, not missing test files.

---

## Key Files Referenced in This Phase

| File | Role |
|------|------|
| `.planning/phases/06-global-payments-list/06-02-SUMMARY.md` | Has empty `requirements-completed` — needs PAY-06/07/08 added |
| `.planning/REQUIREMENTS.md` | PAY-06/07/08 unchecked — needs `[x]` |
| `.planning/phases/09-design-system-overhaul-.../09-VERIFICATION.md` | Status stale — needs re-verification |
| `.planning/phases/09-design-system-overhaul-.../09-03-SUMMARY.md` | Missing requirements-completed: [DS-07, DS-08] |
| `.planning/phases/09-design-system-overhaul-.../09-04-SUMMARY.md` | Missing requirements-completed: [DS-09, DS-10] |
| `.planning/phases/09-design-system-overhaul-.../09-05-SUMMARY.md` | Missing requirements-completed: [DS-11] |
| `cypress/e2e/payments-list.cy.ts` | 23-test Cypress spec covering PAY-01 through PAY-08 — run required |
| `src/app/(app)/payments/PaymentsClient.tsx` | Evidence source for PAY-06/07/08 implementation |
| `src/actions/payment.actions.ts` | Evidence source for editPaymentAction / deletePaymentAction |

---

## Sources

### Primary (HIGH confidence)

- `.planning/v1.1-MILESTONE-AUDIT.md` — authoritative gap list, verified 2026-03-23
- `.planning/phases/06-global-payments-list/06-02-SUMMARY.md` — confirms empty requirements_completed
- `.planning/phases/09-design-system-overhaul-.../09-VERIFICATION.md` — confirms stale status
- `cypress/e2e/payments-list.cy.ts` — direct file read confirming 23 tests exist covering PAY-01 to PAY-08
- Code inspection of report page files — confirms DS-12 subtitle fix is in place
- `.planning/phases/07-daily-collections-view/07-VERIFICATION.md` — structural template for VERIFICATION.md format
- `.planning/phases/08-quick-record-workflow/08-VERIFICATION.md` — second structural template

### Secondary (MEDIUM confidence)

- `09-06-SUMMARY.md` note about pre-existing Cypress failures in payments-list — 6 tests had timing/auth issues at that point; current state requires a fresh run to confirm

---

## Metadata

**Confidence breakdown:**
- Gap identification: HIGH — sourced directly from MILESTONE-AUDIT.md and confirmed by file reads
- VERIFICATION.md format: HIGH — two existing VERIFICATION.md files serve as templates
- Cypress run outcome: MEDIUM — 09-06-SUMMARY.md noted pre-existing failures in payments-list; current state unknown until run
- DS-07..DS-11 SUMMARY mapping: HIGH — traced from plan content to which plan covers which DS requirement

**Research date:** 2026-03-24
**Valid until:** Stable — documentation-only phase with no moving dependencies
