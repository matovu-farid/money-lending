// Custom Cypress commands for auth and test helpers
import type { CreatedTestUser, SessionCookie } from "./types"

declare global {
  namespace Cypress {
    interface Chainable {
      /** Register a new user, promote to superAdmin if needed, and land on dashboard. Returns email. */
      registerAndLogin(opts?: {
        name?: string
        email?: string
        password?: string
      }): Chainable<string>

      /** Sign in with existing credentials */
      login(email: string, password: string): Chainable<void>

      /** Promote a user to a specific role via db task */
      promoteUser(email: string, role: string): Chainable<null>

      /** Dismiss the POS receipt modal that appears after loan creation */
      dismissReceiptModal(): Chainable<void>

      /**
       * Create a test user via better-auth testUtils and set session cookies.
       * No UI registration, no password hashing, no rate limits.
       * Returns { email, userId, role, cookies }.
       */
      createTestUser(opts: {
        name: string
        role: string
        email?: string
      }): Chainable<CreatedTestUser>

      /**
       * Switch the browser session to a previously created test user.
       * Clears existing cookies and sets the new user's session cookies.
       */
      loginAsTestUser(cookies: SessionCookie[]): Chainable<void>

      /**
       * Clear all client-side state for the app origin: cookies,
       * localStorage, sessionStorage, AND IndexedDB. Cypress's default
       * test isolation already clears the first three between tests, but
       * NOT IndexedDB — and the TanStack DB collections persist Electric
       * shape handles + offsets there. After cy.task("db:reset") the DB
       * is empty but the cached offsets are far ahead of the now-empty
       * server, so live-queries long-poll forever and form `tx.isPersisted`
       * promises never resolve. Call this after `db:reset` to break the
       * stale-offset loop.
       */
      clearAppPersistence(): Chainable<void>

      /** Insert/update the ip_allowlist_enabled toggle directly in DB */
      setIpAllowlistEnabled(enabled: boolean): Chainable<null>

      /** Seed an entry in the admin_ip_allowlist table */
      seedAllowlistEntry(userId: string, ip: string): Chainable<null>

      /** Wipe admin_ip_allowlist and ip_block_log */
      clearAllowlist(): Chainable<null>

      /** Count entries in admin_ip_allowlist for one admin */
      countAllowlistFor(userId: string): Chainable<number>

      /** Clear the in-process IP allowlist toggle/IP caches in the dev server */
      clearIpCaches(): Chainable<null>

      /**
       * Pick a date in a shadcn DatePicker by id. Opens the popover, navigates
       * months via chevrons from the current displayed month, and clicks the
       * day cell. Date must be in yyyy-MM-dd format.
       */
      pickDate(triggerSelector: string, dateString: string): Chainable<void>
    }
  }
}

Cypress.Commands.add(
  "registerAndLogin",
  (opts?: { name?: string; email?: string; password?: string }) => {
    const email = opts?.email ?? `test-${Date.now()}@fidexa.org`
    const name = opts?.name ?? "Test User"
    const password = opts?.password ?? "TestPass123!"

    cy.visit("/register")
    cy.get("#name").type(name)
    cy.get("#email").type(email)
    cy.get("#password").type(password)
    cy.get("#confirmPassword").type(password)
    cy.get("button[type=submit]").click()

    // Registration may redirect to /verify-email (email verification required)
    // or /pending-approval / /dashboard (when CYPRESS=true disables verification).
    cy.url({ timeout: 15000 }).should("satisfy", (url: string) =>
      url.includes("/dashboard") ||
      url.includes("/pending-approval") ||
      url.includes("/verify-email")
    )

    cy.url().then((url) => {
      if (url.includes("/verify-email")) {
        // Email verification required: promote user (sets email_verified=true, invalidates session)
        // then log in fresh
        cy.task("db:promoteUser", { email, role: "superAdmin" })
        cy.clearCookies()
        cy.visit("/login")
        cy.get("#email").type(email)
        cy.get("#password").type(password)
        cy.get("button[type=submit]").click()
        cy.url({ timeout: 15000 }).should("include", "/dashboard")
      } else if (url.includes("/pending-approval")) {
        // User registered but needs role promotion
        cy.task("db:promoteUser", { email, role: "superAdmin" })
        cy.clearCookies()
        cy.visit("/login")
        cy.get("#email").type(email)
        cy.get("#password").type(password)
        cy.get("button[type=submit]").click()
        cy.url({ timeout: 15000 }).should("include", "/dashboard")
      }
      // else: already on /dashboard — first user auto-promoted, no action needed
    })

    cy.wrap(email)
  }
)

Cypress.Commands.add("login", (email: string, password: string) => {
  cy.visit("/login")
  cy.get("#email").type(email)
  cy.get("#password").type(password)
  cy.get("button[type=submit]").click()
  cy.url({ timeout: 15000 }).should("not.include", "/login")
})

Cypress.Commands.add("promoteUser", (email: string, role: string) => {
  return cy.task("db:promoteUser", { email, role })
})

Cypress.Commands.add("dismissReceiptModal", () => {
  cy.contains("KAKS CREDIT", { timeout: 10000 }).should("be.visible")
  cy.contains("button", "Close").click()
})

type CreateTestUserTaskResult = {
  email: string
  userId: string
  role: string
  cookies: SessionCookie[]
}

Cypress.Commands.add(
  "createTestUser",
  (opts: { name: string; role: string; email?: string }) => {
    return cy
      .task<CreateTestUserTaskResult>("auth:createUser", opts)
      .then((result) => {
        // Store cookies for later use with loginAsTestUser
        const userData: CreatedTestUser = {
          email: result.email,
          userId: result.userId,
          role: result.role,
          _cookies: result.cookies,
        }
        // Set session cookies immediately so the user is logged in
        cy.clearCookies()
        for (const cookie of result.cookies) {
          const sameSite = cookie.sameSite?.toLowerCase()
          cy.setCookie(cookie.name, cookie.value, {
            domain: cookie.domain || undefined,
            path: cookie.path || "/",
            httpOnly: cookie.httpOnly ?? true,
            secure: cookie.secure ?? false,
            sameSite:
              sameSite === "strict" || sameSite === "lax" || sameSite === "no_restriction"
                ? sameSite
                : undefined,
          })
        }
        return cy.wrap(userData)
      })
  }
)

Cypress.Commands.add(
  "loginAsTestUser",
  (cookies: SessionCookie[]) => {
    cy.clearCookies()
    for (const cookie of cookies) {
      cy.setCookie(cookie.name, cookie.value, {
        domain: cookie.domain || undefined,
        path: cookie.path || "/",
        httpOnly: true,
        secure: false,
      })
    }
  }
)

Cypress.Commands.add("clearAppPersistence", () => {
  cy.clearAllCookies()
  cy.clearAllLocalStorage()
  cy.clearAllSessionStorage()

  // IndexedDB cleanup: Cypress doesn't have a built-in helper. We need an
  // existing window context with a same-origin document — visit a static
  // route first, then enumerate and delete every database the app stored.
  cy.visit("/login")
  cy.window({ log: false }).then((win) => {
    if (typeof win.indexedDB?.databases !== "function") return
    return new Cypress.Promise<void>((resolve) => {
      win.indexedDB.databases().then((dbs) => {
        if (!dbs.length) return resolve()
        let remaining = dbs.length
        const done = () => {
          remaining -= 1
          if (remaining <= 0) resolve()
        }
        for (const db of dbs) {
          if (!db.name) {
            done()
            continue
          }
          const req = win.indexedDB.deleteDatabase(db.name)
          req.onsuccess = done
          req.onerror = done
          req.onblocked = done
        }
      }, () => resolve())
    })
  })
})

Cypress.Commands.add("setIpAllowlistEnabled", (enabled: boolean) => {
  return cy.task("db:setIpAllowlistEnabled", { enabled })
})

Cypress.Commands.add("seedAllowlistEntry", (userId: string, ip: string) => {
  return cy.task("db:seedAllowlistEntry", { userId, ip })
})

Cypress.Commands.add("clearAllowlist", () => {
  return cy.task("db:clearAllowlist")
})

Cypress.Commands.add("countAllowlistFor", (userId: string) => {
  return cy.task("db:countAllowlistFor", { userId })
})

Cypress.Commands.add("clearIpCaches", () => {
  return cy.task("ip:clearCaches")
})

Cypress.Commands.add("pickDate", (triggerSelector: string, dateString: string) => {
  // react-day-picker v9 sets data-day={isoDate} on each day's <td>. Targeting
  // by ISO date is locale-independent. We still need to navigate to the
  // correct month if the target isn't currently rendered.
  const [yearStr, monthStr] = dateString.split("-")
  const targetMonthMs = new Date(Number(yearStr), Number(monthStr) - 1, 1).getTime()

  cy.get(triggerSelector).click()
  cy.get('[data-slot="popover-content"] [data-slot="calendar"]', { timeout: 5000 })
    .should("be.visible")

  function ensureMonthVisible(): void {
    cy.get('[data-slot="popover-content"]').then(($content) => {
      // If the target day is already rendered (and not from an outside month
      // unless the current month doesn't show it), we're done.
      const found = $content.find(`td[data-day="${dateString}"]:not([data-outside])`)
      if (found.length > 0) return

      // Pick the first visible day cell to determine displayed month.
      const firstNonOutside = $content.find('td[data-day]:not([data-outside])').first()
      const isoDate = firstNonOutside.attr("data-day")
      if (!isoDate) {
        throw new Error("pickDate: could not determine current displayed month")
      }
      const [y, m] = isoDate.split("-")
      const currentMs = new Date(Number(y), Number(m) - 1, 1).getTime()
      const button =
        targetMonthMs < currentMs
          ? '[data-slot="popover-content"] .rdp-button_previous'
          : '[data-slot="popover-content"] .rdp-button_next'
      cy.get(button).click()
      ensureMonthVisible()
    })
  }
  ensureMonthVisible()

  cy.get(`[data-slot="popover-content"] td[data-day="${dateString}"]:not([data-outside]) button`)
    .click()

  cy.get('[data-slot="popover-content"]').should("not.exist")
})

export {}
