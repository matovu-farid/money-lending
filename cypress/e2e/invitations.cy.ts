describe("Invitation System", () => {
  const password = "TestPass123!"
  let adminEmail: string

  beforeEach(() => {
    cy.task("db:reset")
  })

  /**
   * Register a user via the form, promote to a role, then clear cookies.
   * Uses the same pattern as the registration test and admin-panel test.
   */
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
   * Fill and submit the invitation form in the Invitations section.
   * The role Select uses a SelectTrigger with placeholder "Select role".
   */
  function sendInvite(name: string, email: string, roleLabel: string) {
    cy.get("#invite-name").type(name)
    cy.get("#invite-email").type(email)

    // The role Select is inside the Invitations <section>
    cy.contains("section", "Invitations").within(() => {
      cy.get("[data-slot=select-trigger]").click()
    })
    // SelectContent renders in a portal outside the section
    cy.get("[data-slot=select-content]", { timeout: 5000 }).should("exist")
    cy.contains("[data-slot=select-item]", roleLabel).click()

    cy.contains("button", "Send Invite").click()
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

      sendInvite("John Doe", "john@example.com", "Loan Officer")

      // Toast says "Invitation sent to john@example.com"
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

      sendInvite("Duplicate Admin", adminEmail, "Loan Officer")

      // The service throws "This user already has an account"
      cy.contains("already has an account", { timeout: 10000 }).should("be.visible")
    })

    it("revokes a pending invitation", () => {
      cy.visit("/admin")
      cy.contains("Invitations", { timeout: 10000 }).should("be.visible")

      sendInvite("To Revoke", "revoke@example.com", "Loan Officer")
      cy.contains("Invitation sent", { timeout: 10000 }).should("be.visible")

      // Click the Revoke button in the invitations table row
      cy.contains("section", "Invitations").within(() => {
        cy.contains("tr", "revoke@example.com").within(() => {
          cy.contains("button", "Revoke").click()
        })
      })

      cy.contains("Invitation revoked", { timeout: 10000 }).should("be.visible")
    })

    it("filters invitations by status", () => {
      cy.visit("/admin")
      cy.contains("Invitations", { timeout: 10000 }).should("be.visible")

      sendInvite("Filter Test", "filter@example.com", "Loan Officer")
      cy.contains("Invitation sent", { timeout: 10000 }).should("be.visible")

      // Filter to Accepted (should be empty since all invitations are pending)
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

      sendInvite("New Officer", "officer@example.com", "Loan Officer")
      cy.contains("Invitation sent", { timeout: 10000 }).should("be.visible")

      // Sign out and visit the invite URL
      cy.clearCookies()

      cy.task("db:getInviteUrl", { email: "officer@example.com" }).then(
        (url) => {
          expect(url).to.not.be.null
          const parsed = new URL(url as string)
          cy.visit(parsed.pathname + parsed.search)
        }
      )

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
    it("hides invitations section from loan officers", () => {
      adminEmail = `admin-${Date.now()}@fidexa.org`
      const officerEmail = `officer-${Date.now()}@fidexa.org`

      registerAndPromote(adminEmail, "Super Admin", "superAdmin")
      registerAndPromote(officerEmail, "LO User", "loanOfficer")

      loginAs(officerEmail)
      cy.visit("/admin")

      // Loan officers do not have user:list permission, so they see "Access denied"
      cy.contains("Access denied", { timeout: 10000 }).should("be.visible")
    })
  })
})
