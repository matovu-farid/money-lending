# Explicit Public Routes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Keep `/` as the smart entry point while making exact `/home` and `/request-access` visits public regardless of cookie or session state.

**Architecture:** Add an exact-match public-route allowlist to `src/proxy.ts`. The proxy returns `NextResponse.next()` for those two paths before session validation, while `/` retains its existing cookie-aware redirect behavior and child paths remain behind the normal auth gate.

**Tech Stack:** Next.js 16 App Router Proxy, TypeScript, Cypress 15.

---

## Files and responsibilities

- Modify `src/proxy.ts`: add exact public-route matching before session-cookie inspection; remove `/request-access` from the generic auth-page list because it is public for authenticated users too.
- Modify `cypress/e2e/homepage-landing.cy.ts`: change the returning-cookie expectation for explicit `/home` from `/login` to the landing page and add authenticated coverage.
- Modify `cypress/e2e/request-access.cy.ts`: add cookie and authenticated public-route coverage, plus a nested-route auth-gate assertion.
- `cypress/e2e/homepage-redirect.cy.ts`: existing root smart-routing coverage remains unchanged and is included in final verification.

## Task 1: Add failing route-matrix coverage

**Files:**

- Modify `cypress/e2e/homepage-landing.cy.ts`
- Modify `cypress/e2e/request-access.cy.ts`

- [x] **Step 1: Change explicit `/home` returning-user coverage to require the landing page**

Replace the existing test that sets `has_account=1`, visits `/home`, and expects `/login` with:

```ts
it("keeps an explicit /home visit public for returning visitors", () => {
  cy.setCookie("has_account", "1")

  cy.visit("/home")

  cy.location("pathname").should("eq", "/home")
  cy.contains("Lending, with clarity").should("be.visible")
})
```

- [x] **Step 2: Add request-access cookie and authenticated cases**

Append these tests to `cypress/e2e/request-access.cy.ts`:

```ts
it("stays public for returning visitors", () => {
  cy.setCookie("has_account", "1")

  cy.visit("/request-access")

  cy.location("pathname").should("eq", "/request-access")
  cy.get("h1").should("have.text", "Request access")
})

it("stays public for authenticated visitors", () => {
  cy.registerAndLogin({ name: "Request Access User" })

  cy.visit("/request-access")

  cy.location("pathname").should("eq", "/request-access")
  cy.get("h1").should("have.text", "Request access")
})

it("keeps nested request-access paths behind the normal auth gate", () => {
  cy.visit("/request-access/anything")

  cy.location("pathname").should("eq", "/register")
})
```

Add the equivalent authenticated `/home` assertion to `cypress/e2e/homepage-landing.cy.ts`:

```ts
it("stays public for authenticated visitors", () => {
  cy.registerAndLogin({ name: "Landing Page User" })

  cy.visit("/home")

  cy.location("pathname").should("eq", "/home")
  cy.contains("Lending, with clarity").should("be.visible")
})
```

- [x] **Step 3: Run the focused Cypress specs and verify the new assertions fail for the current behavior**

Run:

```bash
pnpm exec cypress run --spec cypress/e2e/homepage-landing.cy.ts,cypress/e2e/request-access.cy.ts
```

Expected: the returning-cookie `/home` test fails because current proxy code redirects it to `/login`; the authenticated `/request-access` test fails because `AUTH_PAGES` redirects authenticated visitors to `/dashboard`. Existing unrelated assertions should remain green.

## Task 2: Implement exact public-route handling

**File:** `src/proxy.ts`

- [x] **Step 1: Define exact public routes and remove request-access from auth-page redirects**

Change the route constants to:

```ts
const AUTH_PAGES = ["/login", "/register", "/forgot-password", "/verify-email", "/reset-password", "/accept-invite", "/access-blocked"]
const PUBLIC_PAGES = ["/home", "/request-access"]
```

Then replace the current `isPublicHome` declaration with:

```ts
const isPublicPage = PUBLIC_PAGES.includes(pathname)
```

- [x] **Step 2: Bypass session gating only for exact public pages**

Immediately after computing `pathname`, `isAuthPage`, and `isPublicPage`, before `getSessionCookie(request)`, add:

```ts
  if (isPublicPage) return NextResponse.next()
```

Remove the later `isPublicHome` branch from the no-session block. Keep the root branch unchanged:

```ts
    if (pathname === "/") {
      const dest = request.cookies.has("has_account") ? "/login" : "/home"
      return NextResponse.redirect(new URL(dest, request.url))
    }
```

This ordering makes the exact public routes work with no cookie, `has_account`, a valid session, or an invalid session cookie. Because matching uses `includes(pathname)`, `/home/anything` and `/request-access/anything` still proceed through the normal gate.

- [x] **Step 3: Run the focused Cypress specs and verify the route matrix**

Run:

```bash
pnpm exec cypress run --spec cypress/e2e/homepage-redirect.cy.ts,cypress/e2e/homepage-landing.cy.ts,cypress/e2e/request-access.cy.ts
```

Expected: the root-routing assertions, public-page assertions, authenticated public-page assertions, cookie cases, and nested-route denial pass. The existing mobile tab-bar assertion may remain independent of this route change.

## Task 3: Adversarial implementation review and verification

- [x] **Step 1: Inspect the diff against the route contract**

Run:

```bash
git diff -- src/proxy.ts cypress/e2e/homepage-redirect.cy.ts cypress/e2e/homepage-landing.cy.ts cypress/e2e/request-access.cy.ts
```

Check each route explicitly: `/`, `/home`, `/request-access`, `/home/anything`, and `/request-access/anything`. Confirm no broad `startsWith()` check was introduced for the public allowlist and no existing root redirect was changed.

- [x] **Step 2: Run static verification**

Run:

```bash
pnpm exec tsc --noEmit
pnpm exec eslint src/proxy.ts cypress/e2e/homepage-redirect.cy.ts cypress/e2e/homepage-landing.cy.ts cypress/e2e/request-access.cy.ts
```

Expected: both commands exit with status 0.

- [x] **Step 3: Run the final focused Cypress verification**

Run:

```bash
pnpm exec cypress run --spec cypress/e2e/homepage-landing.cy.ts,cypress/e2e/request-access.cy.ts
```

Expected: all public-route specs pass with zero failures. The root redirect spec was also run; its root-routing assertions passed, while its unrelated mobile tab-bar display assertion remains a pre-existing failure (`block` vs `flex`).

## Verification record

- `pnpm exec tsc --noEmit` passed.
- `pnpm exec eslint src/proxy.ts cypress/e2e/homepage-redirect.cy.ts cypress/e2e/homepage-landing.cy.ts cypress/e2e/request-access.cy.ts` passed.
- Final `homepage-landing.cy.ts` and `request-access.cy.ts` run passed 12/12 tests, including authenticated `/home`, authenticated `/request-access`, returning-cookie cases, and nested-route denial.
