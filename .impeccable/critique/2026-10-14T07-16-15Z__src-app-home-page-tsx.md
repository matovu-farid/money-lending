---
target: rounded homepage, especially mobile
total_score: 22
max_score: 28
na_heuristics: 7,9,10
p0_count: 0
p1_count: 0
timestamp: 2026-10-14T07-16-15Z
slug: src-app-home-page-tsx
---
Method: dual-agent (A: /root/rounded_design_review · B: /root/rounded_browser_evidence)

# Rounded Kaks Credit homepage — critique and corrections

The rounded version feels polished and credible. The 14px controls, 20–24px product frame and 24–32px section curves work together. The remaining problems were responsive composition and small interactive targets, not the radius system. The native fictional-data dashboard remains the most product-specific evidence.

## Baseline design health

Scores below are Assessment A's pre-fix evaluation; they are not an invented after-score.

| # | Heuristic | Score | Key finding |
|---|---|---:|---|
| 1 | Status | 3 | Clear read-only/fictional labels and disclosure state |
| 2 | Real-world match | 4 | Native lending data and terminology |
| 3 | Control/freedom | 3 | Expansion and collapse retain context |
| 4 | Consistency | 2 | Compact preview and hero breakpoints disagree with native grid |
| 5 | Error prevention | 4 | Preview cannot access private data or route actions |
| 6 | Recognition | 3 | Explicit action labels and real product content |
| 7 | Efficiency | n/a | Marketing page |
| 8 | Aesthetics | 3 | Coherent curves and hierarchy; intermediate widths cramped |
| 9 | Error recovery | n/a | No input/error task on this page |
| 10 | Help | n/a | Marketing page |
| | Total | 22/28 | Polished, with responsive defects to correct |

## Independent browser evidence

Detector returned zero findings, exit 0. Fresh browser inspection covered 320, 390, 820 and 1440px, with Assessment A also checking intermediate mobile widths. Mutable overlay injection was unsupported; no overlay server was started. Page widths matched viewport widths, KPI currency was fully contained at 320px, and rounded CTA/preview corners did not collide with content. Expansion retained focus and collapse restored the snapshot to a sensible position.

## Strengths

- Coherent rounded shape hierarchy, restrained black-and-blue palette and readable typography.
- Strong Request access priority with a usable secondary sign-in path.
- Authentic dashboard renderers, clearly fictional values and explicit full-view disclosure.

## Priority issues and fixes

1. **P2 — Hero splits too early.** At 610px, Every payment wrapped within a narrow left column while the right column crowded copy and actions. The hero now stays single-column through 767px. Whole headline phrases are tested at 610, 700 and 767px.
2. **P2 — Compact preview ends before the native grid changes.** At 601–767px, six single-column cards and action tiles made the snapshot unnecessarily long. Compact preview rules now match the native 768px grid transition. Expanding still reveals the exact native full dashboard.
3. **P2 — KPI information targets are only 16px.** Browser measurement revealed focusable 16×16px controls that were hard to tap. Public-preview CSS now provides 44px targets around the unchanged 16px icons, with explicit rounded keyboard focus. Negative margins preserve native card spacing and typography. The authenticated app is not restyled.

## Personas and emotional journey

A prospective team lead using a 610px screen now gets the same composed headline and compact snapshot as other narrow-screen visitors. A phone evaluator can tap real KPI explanations comfortably. A returning member still finds Sign in in the hero/footer. The product presentation remains honest and avoids private data.

## Minor observations

The authentic phone dashboard makes a tall three-card snapshot. Its complete native cards are a deliberate fidelity constraint; no public-only miniaturization was introduced. Native chart headings can wrap at 320px when expanded; they remain legible and outside the homepage frame refinement.

## Verification

28 Cypress checks pass, including the new intermediate-width and mobile tap-target checks, expansion/collapse, keyboard activation, navigation, contrast and no live-data requests. Lint, TypeScript and diff whitespace checks pass. Desktop, narrow phone and 610px captures were inspected together. An initial Electron startup failure was retried successfully without changing product code.

Questions skipped: the user explicitly authorized fixing remaining issues and already settled rounded shapes, black-and-blue identity, Request access priority and an authentic fictional-data preview.
