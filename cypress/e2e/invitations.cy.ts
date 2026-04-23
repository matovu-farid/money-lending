describe("Invitation System", () => {
  const password = "TestPass123!"
  let adminEmail: string

  beforeEach(() => {
    cy.task("db:reset")
  })

  function registerAndPromote(email: string, name: string, role: string) {
    cy.visit("/register")
    cy.get("#name").type(name)
    cy.get("#email").type(email)
    cy.get("#password").type(password)
    cy.get("#confirmPassword").type(password)
    cy.get("button[type=submit]").click()

    cy.url({ timeout: 15000 }).should("satisfy", (url: string) =>
      url.includes("/dashboard") ||
      url.includes("/pending-approval") ||
      url.includes("/verify-email")
    )

    cy.task("db:promoteUser", { email, role })
    cy.clearCookies()
  }

  function loginAs(email: string) {
    cy.visit("/login")
    cy.get("#email").type(email)
    cy.get("#password").type(password)
    cy.get("button[type=submit]").click()
    cy.url({ timeout: 15000 }).should("not.include", "/login")
  }

  /**
   * Fill and submit the invitation form.
   * Uses keyboard selection (type first letter + enter) following admin-panel.cy.ts pattern.
   */
  function sendInvite(name: string, email: string, roleFirstLetter: string) {
    cy.get("#invite-name").clear().type(name)
    cy.get("#invite-email").clear().type(email)

    // Open the role Select inside the Invitations section
    cy.contains("section", "Invitations").within(() => {
      cy.get("[data-slot=select-trigger]").click()
    })
    // SelectContent renders in a portal — use keyboard to select
    cy.get("[data-slot=select-content]", { timeout: 5000 }).should("exist")
    cy.focused().type(`${roleFirstLetter}{enter}`)

    // Wait for the button to become enabled (role state updated)
    cy.contains("button", "Send Invite").should("not.be.disabled").click()
  }

  /**
   * Wait for server-side processing to complete after an optimistic insert.
   * Checks the DB for the invitation row to confirm server processed it.
   */
  function waitForInviteProcessed(email: string) {
    cy.task("db:getInvitations").then((rows: any) => {
      const found = rows.find((r: any) => r.email === email)
      if (!found) {
        // Retry after a short delay
        cy.wait(500)
        cy.task("db:getInvitations").then((rows2: any) => {
          expect(rows2.find((r: any) => r.email === email)).to.not.be.undefined
        })
      }
    })
  }

  describe("Sending Invitations", () => {
    beforeEach(() => {
      adminEmail = `admin-${Date.now()}@fidexa.org`
      registerAndPromote(adminEmail, "Test Admin", "superAdmin")
      loginAs(adminEmail)
    })

    it("sends an invitation and shows it in the table", () => {
      cy.visit("/admin")
      cy.contains("Invitations", { timeout: 10000 }).should("be.visible")

      sendInvite("John Doe", "john@example.com", "l")

      // Toast confirms the invite was sent
      cy.contains("Invitation sent", { timeout: 10000 }).should("be.visible")

      // Verify invitation appears in the invitations table
      cy.contains("section", "Invitations").within(() => {
        cy.contains("john@example.com").should("be.visible")
        cy.contains("John Doe").should("be.visible")
        cy.contains("Pending").should("be.visible")
      })
    })

    it("rejects duplicate email for registered user", () => {
      cy.visit("/admin")
      cy.contains("Invitations", { timeout: 10000 }).should("be.visible")

      sendInvite("Duplicate Admin", adminEmail, "l")

      // The optimistic insert succeeds but onInsert fails server-side.
      // The invitation row should be rolled back — verify it doesn't persist.
      cy.wait(2000) // Allow onInsert to fail and rollback
      cy.contains("section", "Invitations").within(() => {
        cy.contains(adminEmail).should("not.exist")
      })
    })

    it("revokes a pending invitation", () => {
      cy.visit("/admin")
      cy.contains("Invitations", { timeout: 10000 }).should("be.visible")

      sendInvite("To Revoke", "revoke@example.com", "l")
      cy.contains("Invitation sent", { timeout: 10000 }).should("be.visible")

      // Wait for server processing before trying to revoke
      waitForInviteProcessed("revoke@example.com")

      // Click the Revoke action button inside the invitations table
      cy.contains("section", "Invitations")
        .find("table")
        .contains("button", "Revoke")
        .click()

      // Verify the invitation was revoked by checking the DB
      cy.wait(2000) // Allow server-side onDelete to process
      cy.task("db:getInvitations").then((rows: any) => {
        const invite = rows.find((r: any) => r.email === "revoke@example.com")
        expect(invite).to.not.be.undefined
        expect(invite.status).to.equal("revoked")
      })
    })

    it("filters invitations by status", () => {
      cy.visit("/admin")
      cy.contains("Invitations", { timeout: 10000 }).should("be.visible")

      sendInvite("Filter Test", "filter@example.com", "l")
      cy.contains("Invitation sent", { timeout: 10000 }).should("be.visible")

      // Filter to Accepted (should be empty)
      cy.contains("section", "Invitations").within(() => {
        cy.contains("button", "Accepted").click()
        cy.contains("No invitations found").should("be.visible")

        // Filter back to Pending
        cy.contains("button", "Pending").click()
        cy.contains("filter@example.com").should("be.visible")

        // Filter to All
        cy.contains("button", "All").click()
        cy.contains("filter@example.com").should("be.visible")
      })
    })
  })

  describe("Accepting Invitations", () => {
    beforeEach(() => {
      adminEmail = `admin-${Date.now()}@fidexa.org`
      registerAndPromote(adminEmail, "Test Admin", "superAdmin")
    })

    it("accepts an invitation and creates an account with the assigned role", () => {
      loginAs(adminEmail)
      cy.visit("/admin")
      cy.contains("Invitations", { timeout: 10000 }).should("be.visible")

      sendInvite("New Officer", "officer@example.com", "l")
      cy.contains("Invitation sent", { timeout: 10000 }).should("be.visible")

      // Wait for the server to process the invite and store the URL
      waitForInviteProcessed("officer@example.com")

      // Sign out
      cy.clearCookies()

      // Get the invite URL — retry since the in-memory map may not be populated yet
      function getInviteUrlWithRetry(email: string, retries = 5): void {
        cy.task("db:getInviteUrl", { email }).then((url) => {
          if (!url && retries > 0) {
            cy.wait(1000)
            getInviteUrlWithRetry(email, retries - 1)
          } else {
            expect(url).to.not.be.null
            const parsed = new URL(url as string)
            cy.visit(parsed.pathname + parsed.search)
          }
        })
      }
      getInviteUrlWithRetry("officer@example.com")

      // Accept invite page shows the invitee's name and role
      cy.contains("Welcome, New Officer", { timeout: 10000 }).should(
        "be.visible"
      )
      cy.contains("Loan Officer").should("be.visible")

      // Set password
      cy.get("#password").type("OfficerPass123!")
      cy.get("#confirmPassword").type("OfficerPass123!")
      cy.get("button[type=submit]").click()

      // Should redirect away from accept-invite after account creation
      cy.url({ timeout: 15000 }).should("not.include", "/accept-invite")

      // Verify the user was created with the correct role
      cy.task("db:getUserRole", { email: "officer@example.com" }).then(
        (result: any) => {
          expect(result).to.not.be.null
          expect(result.role).to.equal("loanOfficer")
        }
      )
    })

    it("shows error for invalid token", () => {
      cy.visit("/accept-invite?token=invalid-token-123")
      cy.contains("Invitation Invalid", { timeout: 10000 }).should(
        "be.visible"
      )
      cy.contains("Invalid invitation link").should("be.visible")
    })

    it("shows error when no token is provided", () => {
      cy.visit("/accept-invite")
      cy.contains("Invitation Invalid", { timeout: 10000 }).should(
        "be.visible"
      )
      cy.contains("No invitation token provided").should("be.visible")
    })
  })

  describe("Permission Enforcement", () => {
    it("redirects loan officers away from admin page", () => {
      adminEmail = `admin-${Date.now()}@fidexa.org`
      const officerEmail = `officer-${Date.now()}@fidexa.org`

      registerAndPromote(adminEmail, "Super Admin", "superAdmin")
      registerAndPromote(officerEmail, "LO User", "loanOfficer")

      loginAs(officerEmail)
      cy.visit("/admin")

      // Admin layout redirects users without user:list permission to /dashboard
      cy.url({ timeout: 10000 }).should("include", "/dashboard")
    })
  })
})
