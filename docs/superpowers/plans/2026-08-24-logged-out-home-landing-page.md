# Logged-Out `/home` Landing Page Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a warm editorial public landing page at `/home`, route its sign-in/request-access actions correctly, and redirect returning logged-out visitors with the existing `has_account` cookie to `/login`.

**Architecture:** Keep `/home` as a focused server component with local styling and no data fetching. Extend `src/proxy.ts` with one explicit public-route exception so `/home` is allowed only for first-time logged-out visitors; existing authenticated and root-route behavior remains unchanged. Verify the page and cookie redirect through Cypress E2E tests, including mobile rendering.

**Tech Stack:** Next.js 16 App Router, React 19 server components, Tailwind CSS v4 utilities, existing Kaks Credit `Logo`/`ButtonLink` components, Lucide icons, Cypress 15.

---

## File map

- Create: `src/app/home/page.tsx` — semantic landing-page composition, local editorial palette, illustrative product preview, capability/workflow/CTA sections.
- Modify: `src/proxy.ts:31-50` — allow `/home` without a session for first-time browsers and redirect cookie-bearing visitors to `/login`.
- Create: `cypress/e2e/homepage-landing.cy.ts` — first-time rendering, links, returning-cookie redirect, and mobile coverage.
- Create: `docs/superpowers/plans/2026-08-24-logged-out-home-landing-page.md` — this implementation plan.

Do not modify `src/app/page.tsx`, `src/app/globals.css`, the auth pages, or the existing cookie writers. The landing page owns its visual treatment through classes and scoped style markup so authenticated surfaces remain unchanged.

### Task 1: Write the failing Cypress contract

**Files:**
- Create: `cypress/e2e/homepage-landing.cy.ts`

- [ ] **Step 1: Add the focused E2E spec before production code.**

Create one spec with these tests:

```ts
describe("Logged-out home landing page", () => {
  beforeEach(() => {
    cy.task("db:reset")
    cy.clearCookies()
  })

  it("renders the public landing page for a first-time visitor", () => {
    cy.visit("/home")

    cy.contains("Lending, with clarity").should("be.visible")
    cy.get("h1").should("contain", "Make every shilling move with purpose")
    cy.contains("Portfolio visibility").should("be.visible")
    cy.contains("Record the loan").should("be.visible")
    cy.get("footer").should("contain", "Kaks Credit")
  })

  it("routes sign-in and request-access actions to the existing auth flows", () => {
    cy.visit("/home")

    cy.get('a[href="/login"]').first().click()
    cy.url().should("include", "/login")

    cy.visit("/home")
    cy.get('a[href="/register"]').first().click()
    cy.url().should("include", "/register")
  })

  it("sends a returning logged-out visitor to sign in", () => {
    cy.setCookie("has_account", "1")

    cy.visit("/home")

    cy.url().should("include", "/login")
    cy.contains("Sign in to Kaks Credit").should("be.visible")
  })

  it("keeps similarly named routes behind the normal auth gate", () => {
    cy.visit("/home/anything")

    cy.url().should("include", "/register")
  })

  it("stays readable and keeps actions available on mobile", () => {
    cy.viewport(390, 844)
    cy.visit("/home")

    cy.get("h1").should("be.visible")
    cy.get('a[href="/login"]').first().should("be.visible")
    cy.get('a[href="/register"]').first().should("be.visible")
    cy.document().then((document) => {
      expect(document.documentElement.scrollWidth).to.be.lte(
        document.documentElement.clientWidth + 1,
      )
    })
  })
})
```

- [ ] **Step 2: Run the new spec and confirm the failure is meaningful.**

Run:

```bash
pnpm exec cypress run --spec cypress/e2e/homepage-landing.cy.ts
```

Expected: the first-time visitor is redirected away from `/home` by the current proxy, and the returning-cookie case reaches `/register` rather than `/login`. If Cypress cannot start because the app is not running, start the project dev server and rerun; do not treat an infrastructure error as the RED result.

### Task 2: Make `/home` public without weakening the auth gate

**Files:**
- Modify: `src/proxy.ts:31-50`
- Test: `cypress/e2e/homepage-landing.cy.ts`

- [ ] **Step 1: Add an explicit public-home branch to the no-session path.**

Immediately after `const { pathname } = request.nextUrl`, define:

```ts
const isPublicHome = pathname === "/home"
```

In the `if (!sessionCookie)` branch, preserve auth-page handling and then add:

```ts
if (isPublicHome) {
  if (request.cookies.has("has_account")) {
    return NextResponse.redirect(new URL("/login", request.url))
  }
  return NextResponse.next()
}
```

Keep the current fallback for all other unauthenticated protected routes:

```ts
const dest = request.cookies.has("has_account") ? "/login" : "/register"
return NextResponse.redirect(new URL(dest, request.url))
```

This makes only exact `/home` public. `/home/anything`, `/dashboard`, reports, and all other protected routes keep their current behavior.

- [ ] **Step 2: Run the focused spec to verify the auth behavior turns green for routing assertions.**

Run:

```bash
pnpm exec cypress run --spec cypress/e2e/homepage-landing.cy.ts
```

Expected: the cookie redirect test passes; the first-time rendering test fails only because the page does not yet exist. The link/mobile tests may also fail until the page is created.

### Task 3: Build the warm editorial landing page

**Files:**
- Create: `src/app/home/page.tsx`
- Test: `cypress/e2e/homepage-landing.cy.ts`

- [ ] **Step 1: Create a server-rendered page with semantic landmarks and stable testable copy.**

The page should follow this structure:

```tsx
export default function HomePage() {
  return (
    <div className="home-page">
      <header>Logo + /login link + /register Request access link</header>
      <main>
        <section aria-labelledby="home-hero-title">hero copy + two CTAs + preview</section>
        <section aria-labelledby="home-capabilities-title">three capability cards</section>
        <section aria-labelledby="home-workflow-title">three workflow steps</section>
        <section aria-labelledby="home-cta-title">final request-access CTA</section>
      </main>
      <footer>Kaks Credit</footer>
    </div>
  )
}
```

Use `Logo` for branding, `ButtonLink` for CTA links, and Lucide icons (`ChartNoAxesCombined`, `CalendarCheck2`, `UsersRound` or equivalent installed exports) with `aria-hidden="true"`. Keep the page server-rendered: no hooks, client state, data reads, or fabricated live values.

- [ ] **Step 2: Add the approved editorial copy and illustrative preview.**

Use these required landmarks/copy anchors:

- Eyebrow: `Lending, with clarity`.
- Single `h1` containing `Make every shilling move with purpose.`
- Supporting text describing loans, repayments, customers, and operational context in one workspace.
- Capability headings: `Portfolio visibility`, `Daily collections`, and `Customer context`.
- Workflow labels: `Record the loan`, `Stay ahead of collections`, and `Close the loop`.
- Final CTA heading inviting visitors to request access.

Build the preview from plain HTML/CSS blocks representing “Portfolio health”, “Active loans”, and “Collections this week”. Mark the preview as `aria-hidden="true"` because it is illustrative decoration, not accessible data.

- [ ] **Step 3: Apply local warm-editorial styling and responsive behavior.**

Use a page-root class such as `.home-page` with a local `<style>` block or CSS module. Define the palette as local custom properties:

```css
.home-page {
  --home-ink: #1f2d27;
  --home-ink-soft: #536259;
  --home-cream: #f6f2ea;
  --home-paper: #fffdf9;
  --home-sage: #e2ebe4;
  --home-copper: #bd6e3f;
  --home-line: #ded8ce;
  min-height: 100vh;
  overflow: hidden;
  background: var(--home-cream);
  color: var(--home-ink);
}
```

Use a centered max-width container, a two-column desktop hero, stacked mobile layout at `max-width: 760px`, `:focus-visible` outlines using the copper color, and `@media (prefers-reduced-motion: reduce)` to disable decorative transitions/animations. Never use `overflow-x: hidden` as a substitute for fixing a layout width; ensure grids actually collapse on mobile.

- [ ] **Step 4: Run the focused E2E spec and fix implementation failures.**

Run:

```bash
pnpm exec cypress run --spec cypress/e2e/homepage-landing.cy.ts
```

Expected: all four tests pass, including direct navigation to `/login` and `/register`, cookie-based redirect, required content, and the 390px viewport.

### Task 4: Adversarial implementation review and verification

**Files:**
- Review: `src/app/home/page.tsx`
- Review: `src/proxy.ts`
- Review: `cypress/e2e/homepage-landing.cy.ts`
- Review: `docs/superpowers/specs/2026-08-24-logged-out-home-design.md`

- [ ] **Step 1: Review the diff against every spec requirement.**

Check explicitly:

1. `/home` is allowed only without a session and without `has_account`; cookie-bearing logged-out visitors reach `/login`.
2. Existing protected routes still redirect to `/register` for first-time visitors and `/login` for cookie-bearing visitors.
3. Authenticated users are not redirected to `/home` and can still use the existing dashboard flow.
4. There is one `h1`, correct landmarks, working `/login` and `/register` links, visible focus styling, and no fabricated live data.
5. Desktop and 390px layouts do not introduce horizontal overflow.
6. The page uses the Kaks Credit logo and does not modify the global authenticated palette.

Use:

```bash
git diff --check
rg -n "has_account|isPublicHome|/home|Request access|Portfolio visibility|Record the loan" src/proxy.ts src/app/home/page.tsx cypress/e2e/homepage-landing.cy.ts
```

Fix every issue found, then repeat the review rather than documenting known defects.

- [ ] **Step 2: Run focused and broad verification.**

Run:

```bash
pnpm exec cypress run --spec cypress/e2e/homepage-landing.cy.ts
pnpm exec cypress run --spec cypress/e2e/homepage-redirect.cy.ts --spec cypress/e2e/auth-gate.cy.ts
pnpm typecheck
pnpm lint
```

If the focused tests pass but an existing auth/homepage test fails, fix the regression in the implementation or test setup before considering the plan complete. Record the exact command results in the final handoff.

- [ ] **Step 3: Perform a second adversarial review after tests.**

Re-read the final files and ask:

- Can a logged-out first-time browser load `/home` without a DB/session lookup?
- Can a stale/invalid session still reach `/home` when `has_account` is present and should be sent to `/login`?
- Does every request-access link route to the existing `/register` flow?
- Does the page remain meaningful if JavaScript is unavailable?
- Are decorative preview numbers clearly non-live and hidden from assistive technology?
- Did any new global styles, external assets, or data dependencies sneak into the change?

Correct any issue and rerun the relevant verification command until the review finds no remaining issue.

## Commit sequence

Create focused commits after verification checkpoints:

```bash
git add cypress/e2e/homepage-landing.cy.ts
git commit -m "test: cover logged-out home landing page"

git add src/proxy.ts src/app/home/page.tsx
git commit -m "feat: add logged-out home landing page"
```

Do not stage or modify the unrelated existing untracked files in `docs/superpowers/plans/2026-08-03-delete-production-loan-ffabf86d.md`, `docs/superpowers/plans/2026-08-04-payment-overpayment-revenue.md`, `scripts/delete-production-loan.ts`, or `src/scripts/`.
