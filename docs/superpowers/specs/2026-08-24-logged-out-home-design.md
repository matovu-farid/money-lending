# Logged-Out `/home` Landing Page Design

## Goal

Create a polished public landing page at `/home` for visitors who are not signed in. The page should introduce Kaks Credit as a calm, trustworthy operating workspace for money-lending teams and give visitors two clear paths:

- Existing users: sign in at `/login`.
- New users: request access through the existing `/register` flow, which creates an unassigned account and leads to `/pending-approval`.

Returning visitors who have logged in or registered before should not need to see the marketing page again. The existing long-lived `has_account` browser cookie should send logged-out returning visitors directly to `/login`.

## Visual direction

Use the approved “warm editorial” direction:

- Warm cream page surface with generous spacing.
- Ink-green typography and primary actions.
- Copper/orange accent for labels, highlights, and small moments of energy.
- Soft sage product-preview surfaces and subtle borders/shadows.
- Existing Kaks Credit logo and wordmark.
- Calm, human, financially credible tone; avoid unverified performance claims or live portfolio data.

The palette is scoped to the landing page so the authenticated app’s existing black-and-white design system remains unchanged.

## Page structure

1. **Navigation**
   - Kaks Credit logo/wordmark.
   - Quiet “Sign in” link to `/login`.
   - Copper-filled “Request access” button to `/register`.
   - Responsive layout that keeps both actions usable on small screens.

2. **Hero**
   - Eyebrow: “Lending, with clarity”.
   - Headline focused on purposeful, controlled lending operations.
   - Supporting copy explaining that Kaks Credit brings loans, repayments, customers, and operational context into one workspace.
   - Primary action to `/login`.
   - Secondary action to `/register` labeled “Request access”.
   - Editorial product preview illustration showing portfolio health, active loans, and collection progress as illustrative UI only.

3. **Capability section**
   - Three cards covering portfolio visibility, daily collections, and customer/loan context.
   - Each card has a small icon, a concise heading, and explanatory copy.

4. **Workflow / trust section**
   - A compact three-step progression: record the loan, stay ahead of collections, close the loop.
   - Copy emphasizes operational clarity and disciplined records rather than financial guarantees.

5. **Closing CTA and footer**
   - Warm, concise invitation to request access.
   - Repeated `/register` request-access CTA and `/login` sign-in link.
   - Small footer note identifying Kaks Credit.

## Routing and auth behavior

- Add a public server-rendered page at `src/app/home/page.tsx`.
- Keep `src/app/page.tsx` unchanged so the existing root/dashboard behavior is not altered unintentionally.
- Update `src/proxy.ts` so `/home` is treated as public:
  - No session + no `has_account`: allow `/home`.
  - No session + `has_account`: redirect `/home` to `/login`.
  - Valid session: existing authenticated routing remains unchanged.
- Continue using the existing `has_account=1` cookie written after successful login, registration, and invite acceptance. Its current long-lived max age is retained.
- Route “Request access” links to `/register`; do not add a new request-access backend or email workflow in this change.

## Component boundaries

- Keep the page composition in `src/app/home/page.tsx` unless a section becomes meaningfully reusable.
- Reuse `Logo` and existing `Button`/link conventions where they fit.
- Use Lucide icons already installed in the project for capability cards.
- Use semantic `header`, `main`, `section`, and `footer` landmarks with a single page `h1`.
- Ensure all interactive controls have visible focus states, descriptive labels, and touch-friendly targets.

## Responsive behavior

- Desktop: two-column hero with copy and product preview; horizontally arranged navigation and capability cards.
- Tablet: reduce spacing and allow capability cards to wrap.
- Mobile: stack hero content and preview, collapse navigation into a simple two-action row, and keep the main CTA visible without requiring horizontal scrolling.
- Respect reduced-motion preferences for decorative animation.

## Verification

Add `cypress/e2e/homepage-landing.cy.ts` covering:

- `/home` renders for a first-time logged-out visitor.
- Navigation, hero, capability, workflow, and footer content are visible.
- “Sign in” links navigate to `/login`.
- “Request access” links navigate to `/register`.
- A `has_account` cookie causes a logged-out `/home` request to redirect to `/login`.
- The page remains usable at mobile viewport width.

Run the focused Cypress spec, typecheck, lint, and the relevant existing auth/homepage tests before claiming completion.

## Non-goals

- No dashboard data fetching on the public page.
- No changes to the authenticated dashboard or global palette.
- No new request-access persistence, admin queue, or email notification system.
- No replacement of the existing registration or invite flows.
