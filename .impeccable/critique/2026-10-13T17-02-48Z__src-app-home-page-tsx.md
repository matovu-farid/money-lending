---
target: homepage
total_score: 13
max_score: 20
na_heuristics: 1,5,7,9,10
p0_count: 0
p1_count: 2
timestamp: 2026-10-13T17-02-48Z
slug: src-app-home-page-tsx
---
Method: dual-agent (A: /root/homepage_design_review · B: /root/homepage_browser_audit)

Target: src/app/home/page.tsx. Pre-revision critique, 13 October 2026.

The page is restrained and coherent, but its composition and slogans remain interchangeable with finance SaaS marketing. UGX, shilling and the collections example are useful product cues; miniature text and abstract section headings weaken those cues. The most valuable improvement is to communicate an actual lending team's daily work.

## Applicable heuristic scores

| Heuristic | Score | Evidence |
|---|---:|---|
| Visibility of system status | n/a | Static landing surface has no task state. |
| Match with real world | 2/4 | Familiar loan/UGX terms, uncertain audience. |
| User control and freedom | 3/4 | Standard links and exits. |
| Consistency and standards | 3/4 | Styling consistent, CTA priority inconsistent. |
| Error prevention | n/a | No inputs or destructive actions. |
| Recognition rather than recall | 3/4 | Explicit labels, access context missing. |
| Flexibility and efficiency | n/a | Not applicable to this persuasion surface. |
| Aesthetic and minimalist design | 2/4 | Repetitive sections, miniature product evidence. |
| Error recovery | n/a | No error-producing task on this surface. |
| Help and documentation | n/a | Access context scored under recognition. |
| Total | 13/20 | Subjective design review, not an accessibility compliance score. |

## Priority issues

1. [P1] Audience and access expectations are unclear. The hero talks about a lending business; the request link never explains the contact-and-follow-up process. State who uses the workspace and explain the real request form without invented approval times or eligibility promises.
2. [P1] Mobile preview is too small to read. At 390px: table body 9.92px, header 8.8px, illustrative label 9.12px, receipt/caption 9.44px. Use 12px minimum labels and 13–14px table content, reduce framing and repeated content.
3. [P2] Primary action flips. Header promotes Request access, hero promotes Sign in, footer promotes Request access. Establish a consistent main journey and frame the secondary journey explicitly.
4. [P2] Repeated slogans occupy the strongest headings. Details matter, good lending is a practice and clear place to land add reassurance rather than information. Replace with concrete loan, payment and customer tasks, and shorten supporting text.
5. [P2] First-screen spacing underplays the product. At 1280×720 the headline begins around y307, preview starts around y188 and reaches below the fold. Reduce top padding, align hero content purposefully and shorten the sample.
6. [P2] Narrow-phone header wraps awkwardly. At320px brand, Sign in and Request access all wrap; Sign in measures34.81px wide. At390px it is38.46px wide. Reserve unbroken labels and comfortable44px target widths; do not shrink typography.

## What's working

Calm monochrome surfaces, restrained blue accents, deliberate grouping and no ornamental animation. Semantic figure/table/dl, explicit illustrative-data labeling, anonymous sample loan IDs, named navigation, visible keyboard focus, skip link and reduced-motion support. No real customer or creditor data is used.

## Independent detector and browser evidence

Detector command: node /Users/faridmatovu/.codex/skills/impeccable/scripts/detect.mjs --json src/app/home/page.tsx. Exit0, exact output[], zero findings. This markup scan missed external-CSS typography and header wrapping; clean output is not proof of design quality.

Native browser evidence at1280×720,390×844 and320×740 confirmed no document horizontal overflow, solid blue2px focus outlines, and hidden section anchors absent from keyboard/accessibility order. Browser evaluate is explicitly read-only and exposes no mutable script execution capability, so no detector overlay was injected or claimed. No critique-only server was started; the pre-existing demo remains available.

## Cognitive load and emotional journey

Moderate interpretive load from competing CTA hierarchy and vague copy, rather than too many choices. Chunking and grouping work. Calm arrival leads to uncertainty about audience, weak product proof on phones, then an access request without next-step explanation.

## Persona flags

Jordan (first-time visitor): cannot quickly distinguish an existing-team entrance from a product adoption page; request expectations unclear.
Casey (mobile visitor): readable hero actions, but9–10px example text and cramped narrow navigation.
Riley (promise checker): visible sample labeling is honest, but abstract claims are hard to map to actual supported functionality.

Minor: arrow-up-right icons suggest external navigation for internal links; prefer a straight arrow. No actual missing focus indicator or wholly unlabeled sample was found.

The user selected Request access as the primary journey for prospective teams and a sharper editorial layout within the existing black-and-blue identity.

## Revision implemented after this critique

The headline now names loans and payments directly; supporting copy identifies lending teams and concrete supported tasks. Request access is consistently primary in navigation, hero and closing banner. Sign-in remains secondary for existing users. The closing banner explains contact-and-follow-up expectations from the actual request form; a redundant separate access section was removed. Abstract capability/workflow slogans were replaced with concrete outcomes.

Hero spacing is reduced and top-aligned. The illustrative preview uses 12px minimum supporting labels and 13px table body text; a compact brand mark preserves unbroken header actions on narrow phones. Internal destinations now use straight arrows. Accessible sample/table semantics, keyboard focus, and light/dark tokens are retained.

Verification: 17 focused Cypress checks passed, including 320/360/390/820/1024/1440px widths, preview font size, one-line header labels and 44px action widths, 1280×720 first-screen preview fit, consistent request-access destinations and secondary sign-in links, access context, light/dark contrast, skip link, returning public visitors, and route destinations. TypeScript and scoped ESLint passed. Desktop/mobile Cypress screenshots inspected. Post-change markup detector returned[]; its scope remains limited and does not establish design quality. No post-change subjective heuristic rescore is claimed.

## Accurate product preview — 14 October 2026

The earlier illustrative collections mockup is superseded by the real dashboard presentation. The authenticated dashboard and homepage now use DashboardOverview, KpiCard, PageHeader, CollectionsChartView, and LoanDistributionChartView together. Authenticated queries, permission resolution, and live collections remain in the dashboard route and data wrappers. The public view receives only explicitly authored fixtures: six KPI values, 30 daily collection samples, loan status counts and two fictional activity events. No fixture is copied from the local sanitized financial snapshot or a production dataset.

The public figure is labelled read-only and fictional, exposes the real KPI explanations, uses a keyboard-accessible scroll area, and presents operational actions without active private-route links. Request access remains the primary action in all three placements. Workspace links target the actual preview. Black-and-blue homepage styling is retained, while dashboard components retain their native product styling.

Verification: 20 homepage Cypress checks passed; three additional checks confirmed the authenticated local demo still renders six KPI cards, operational links, two live charts and Recent Activity. Eleven shared-presentation/dashboard-action unit checks passed, as did scoped ESLint, TypeScript and git diff --check. The broader unchanged dashboard-service suite has one existing overdue-count test failure: its mocked empty balance rows no longer invoke the older mocked overdue fallback. Service code and the failing test match HEAD and were not edited.

The complete fictional dashboard screenshot is captured by the homepage Cypress spec at cypress/screenshots/homepage-design.cy.ts/kaks-credit-dashboard-fictional.png. It depicts the shared renderer with fictional data only; it does not contain a real user or creditor identity. No blurred production screenshot or production asset was added.
