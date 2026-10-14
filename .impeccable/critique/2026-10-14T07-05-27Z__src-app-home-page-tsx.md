---
target: updated homepage, especially mobile
total_score: 20
max_score: 28
na_heuristics: 7,9,10
p0_count: 0
p1_count: 1
timestamp: 2026-10-14T07-05-27Z
slug: src-app-home-page-tsx
---
Method: dual-agent (A: /root/premium_design_review · B: /root/premium_browser_evidence)

# Kaks Credit homepage — critique and mobile corrections

The previous revision was more premium on desktop, but mobile still felt compressed rather than deliberately composed. The real dashboard was trustworthy; its presentation created avoidable work. The graphite, black-and-blue identity and Request access priority remain the right direction.

## Baseline heuristic scores

These scores assess the page before this correction pass, not an invented after-score.

| # | Heuristic | Score | Main finding |
|---|---|---:|---|
| 1 | Status visibility | 3 | Fictional/read-only label and expansion state are explicit |
| 2 | Real-world match | 4 | Plain lending terminology, native product UI |
| 3 | Control/freedom | 2 | Nested scrolling and distant collapse |
| 4 | Consistency | 3 | Strong identity, repeated frame chrome |
| 5 | Error prevention | 3 | Fictional data clearly disclosed |
| 6 | Recognition | 2 | Collections/activity buried on phones |
| 7 | Efficiency | n/a | Marketing surface |
| 8 | Minimalism | 3 | Redundant sign-in paths and uneven row emphasis |
| 9 | Error recovery | n/a | No input/error flow on this page |
| 10 | Help/documentation | n/a | Marketing surface |
| | Total | 20/28 | Good foundation, unresolved mobile experience |

## Specificity and evidence

The actual Kaks dashboard supplies product character; the marketing composition still relies on familiar editorial typography. Premium quality comes from precise presentation and honest evidence, rather than more ornament. The detector returned zero findings, exit 0. This did not invalidate the browser problems. Fresh browser inspections covered 320, 390, 820 and 1440px. Mutable injection was unsupported, so no overlay or overlay server was created.

## Strengths

- Restrained graphite, white and blue composition with readable text.
- Consistent primary Request access action and generous targets.
- Real dashboard components and authored fictional data, without private/live data access.

## Priority issues and applied fixes

1. **P1 — Mobile product evidence hidden behind a nested scroller.** At 390px, 620px of a 2317px dashboard was visible; the fourth card was cut and charts were far below. Replaced the scroller with three complete native KPI cards and explicit inline expansion. Desktop also uses a complete snapshot rather than partially clipped charts. Full expansion preserves the real native dashboard layout. Collapse is at the bottom and returns the snapshot into view.
2. **P2 — Redundant preview frame chrome.** Duplicate app branding and Dashboard labels delayed useful content. Removed the decorative app-header row, retained native Dashboard heading and the fictional/read-only disclosure, and moved the single expansion control to the footer.
3. **P2 — Cramped phone navigation and repeated secondary copy.** At 320px the wordmark disappeared to accommodate Sign in. The mobile header now retains the brand and Request access; Sign in remains easy to find in the hero and footer. Shortened the hero sign-in note. The closing phone CTA now matches the full-width opening action.
4. **P2 — Tablet product pushed below the opening view.** At 820px the stacked hero delayed the native dashboard to about 850px. Restored a compact split hero through tablet widths, with a Cypress check that real KPI content starts before 720px.
5. **P3 — Uneven capability emphasis and repetitive descriptions.** The middle row's lone tinted panel implied an unsupported selected state. Replaced it with consistent quiet boundaries, clarified each capability's distinct lending task, and tuned phone section typography to avoid awkward wraps.

## Personas and emotional journey

Casey, the phone visitor, no longer has to choose between page and panel scrolling. Jordan, a first-time evaluator, gets a labelled snapshot and a clear full-view action. Riley, the promise checker, sees native components and fictional values without invented claims. The product proof no longer becomes an effort valley between the confident opening and the access invitation.

## Verification

24 focused Cypress tests pass, covering the mobile snapshot, expansion/collapse return position, native keyboard activation, six viewport widths, contrast in both themes, access navigation and no live-data requests. Four shared-dashboard unit tests pass; lint, TypeScript and diff whitespace checks pass. Desktop/mobile captures were inspected together in a bounded pass. Physical phone testing was not available; responsive behavior is verified in Electron.

Questions skipped: the user explicitly authorized finding and fixing remaining homepage issues, prioritizing mobile; the black-and-blue identity, Request access priority and authentic fictional-data preview were already settled.
