---
version: 1
slug: "src-app-home-page-tsx"
primary_target: "src/app/home/page.tsx"
related_targets: ["src/app/home/home.css","src/app/home/dashboard-preview.tsx"]
---

# Kaks Credit — premium homepage and product presentation

Mode: Persuade.

Audience: prospective lending teams evaluating Kaks Credit. Existing users have a secondary sign-in path. The primary action is Request access in the header, hero and closing invitation.

Scope: the public homepage and the presentation frame around its fictional-data dashboard. The authenticated app retains its existing rendering components, permissions and data paths.

Visual direction: editorial precision in the established black-and-blue identity. The opening uses a graphite surface (#0d1016), soft white (#f4f6fc), readable secondary text (#b5bdce) and a lighter blue headline emphasis (#8ba7ff). The closing invitation uses the existing deep blue identity (#002f9c). The marketing sections use their own scoped color roles: white canvas (#ffffff), navy ink (#172033), blue-gray supporting text (#526079), pale blue workflow surface (#eef3fb), deep blue links/icons (#002f9c), and quiet blue-gray dividers (#dbe3ef). Dark mode uses a #101721 canvas, #162338 workflow field, #f4f6fc ink, #b5bdce secondary text and #9bb4ff links/icons. The native dashboard retains the actual app semantic surfaces.

Typography: Geist carries the page. The hero uses a lighter 400 weight, a maximum 6rem display size, tracking no tighter than -0.04em and three deliberate lines. Section headings step down to 3.5rem; supporting copy remains comfortably readable. Geist Mono is reserved for the ordered workflow and the native product's data treatment.

Composition: compact dark navigation, an asymmetric editorial hero, and a wide genuine product view. Capabilities are presented as editorial rows rather than repeated boxed cards. The three-step loan-to-repayment workflow uses numbers because the sequence carries meaning. An inset blue invitation closes the page, followed by a quiet neutral footer. On phones, the brand and Request access remain in the header; the hero supplies the secondary sign-in path. Tablets retain a compact split hero so real product content appears in the opening view.

Product truth: DashboardOverview and its native KPI, chart and activity renderers are shared with the authenticated dashboard. Public data is authored fiction, including every amount, borrower and officer. No live data feed is imported by the public preview. The preview is labelled read-only and fictional; private route actions are rendered without active links. KPI explanations retain the real definitions.

Interactions: Request access leads to /request-access, Sign in leads to /login, and workspace links target the real preview at #workspace. The dashboard can be expanded inline, preserving the user's context. Its native button supports pointer and keyboard activation and reports state with aria-expanded and aria-controls. The compact view presents complete native KPI cards without an inner scrolling surface: three cards below 768px, all six with native quick actions from 768px upward. Expanding reveals the remaining native sections inline. The disclosure lives at the end of the preview, and collapsing from below returns the snapshot into view. It remains disabled during server-rendered startup until its client handler is ready. Focus, text selection, hover and reduced-motion styling are authored from the same palette.

Verification: the focused Cypress suite covers real dashboard sections, fictional values, no live data requests, preview expansion/collapse, native keyboard activation, first-screen access, action priority, focus and responsive layouts at 320, 360, 390, 820, 1024 and 1440px, mobile brand visibility, complete mobile snapshots without nested scrolling, return position after collapsing, and tablet product visibility. Text and action contrast is measured in both light and dark themes. Desktop and mobile captures are inspected together; factual copy and product fidelity remain constraints on further design changes.

Shape preference: the user dislikes sharp corners. Homepage controls use a 14px radius, the product frame uses 24px (20px on phones), and large section edges use 32px (24px on phones). Native dashboard component shapes remain faithful to the real app.

Responsive detail: the hero and workflow stack through 767px, matching the native KPI grid transition at 768px. Preview information icons retain their native 16px appearance inside 44px tap targets with visible keyboard focus. Intermediate widths 610, 700 and 767px are covered by Cypress checks for whole headline phrases and compact/full preview states.

Spatial rhythm: desktop hero-to-preview gap is 48px, with 64px below the preview and 80px before capabilities (144px combined, reduced from 216px). Capability rows use 24px internal padding and no redundant row gap. The introduction and row descriptions share one editorial grid. Capabilities-to-workflow gap is 112px (48px plus 64px, reduced from 136px). The workflow has a quiet blue field and 64px desktop/48px phone padding. On phones, Explore the workspace and Sign in share one secondary-action row, and preview gap is 24px. The native KPI/card spacing remains accurate. A 32px pause separates the workflow from the inset closing invitation.

Final typography review: retain the coherent scoped palette and Geist role hierarchy. The workflow heading and numbered steps stack through 767px, avoiding cramped headline columns at 610–767px. Cypress verifies each heading phrase and the vertical reading order at 610, 700 and 767px. The 820px and desktop layouts retain three horizontal steps.
