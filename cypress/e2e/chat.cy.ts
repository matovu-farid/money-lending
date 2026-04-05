describe("Chat", () => {
  let adminEmail: string

  beforeEach(() => {
    cy.task("db:reset")
    cy.registerAndLogin({ name: "Admin User" }).then((email) => {
      adminEmail = email as unknown as string
    })
    cy.url({ timeout: 15000 }).should("include", "/dashboard")
  })

  describe("Chat Page Rendering", () => {
    it("visits /chat and shows Messages heading and Select a conversation empty state", () => {
      cy.visit("/chat")
      cy.contains("Messages").should("be.visible")
      cy.contains("Select a conversation").should("be.visible")
    })

    it("shows no conversations yet empty state in conversation list", () => {
      cy.visit("/chat")
      cy.contains("No conversations yet. Start a new chat!").should("be.visible")
    })

    it("shows the new conversation button", () => {
      cy.visit("/chat")
      cy.get("[aria-label='New conversation']").should("be.visible")
    })

    it("shows the search conversations input", () => {
      cy.visit("/chat")
      cy.get("input[placeholder='Search conversations...']").should("be.visible")
    })
  })

  describe("Navigation", () => {
    it("shows Chat link in the sidebar", () => {
      cy.visit("/dashboard")
      cy.get("[data-testid='sidebar-nav']").contains("Chat").should("be.visible")
    })

    it("clicking Chat link in sidebar navigates to /chat", () => {
      cy.visit("/dashboard")
      cy.get("[data-testid='sidebar-nav']").contains("Chat").click()
      cy.url({ timeout: 10000 }).should("include", "/chat")
    })
  })

  describe("New 1:1 Conversation", () => {
    beforeEach(() => {
      // Register second user in a separate session
      cy.clearCookies()
      cy.registerAndLogin({ name: "Loan Officer", email: "officer@test.com" })
      cy.task("db:promoteUser", { email: "officer@test.com", role: "loanOfficer" })

      // Log back in as admin
      cy.clearCookies()
      cy.login(adminEmail, "TestPass123!")
      cy.url({ timeout: 15000 }).should("include", "/dashboard")
    })

    it("opens new conversation dialog and starts a 1:1 chat", () => {
      cy.visit("/chat")

      // Open new conversation dialog
      cy.get("[aria-label='New conversation']").click()
      cy.contains("New Conversation").should("be.visible")

      // Search for the other user
      cy.get("input[placeholder='Search by name...']").type("Loan Officer")

      // Wait for results and click the user
      cy.contains("Loan Officer", { timeout: 10000 }).click()

      // Start chat
      cy.contains("button", "Start Chat").click()

      // Conversation should be created and visible in list
      cy.contains("Loan Officer", { timeout: 10000 }).should("be.visible")
    })

    it("shows message input after selecting a conversation", () => {
      cy.visit("/chat")

      cy.get("[aria-label='New conversation']").click()
      cy.get("input[placeholder='Search by name...']").type("Loan Officer")
      cy.contains("Loan Officer", { timeout: 10000 }).click()
      cy.contains("button", "Start Chat").click()

      // Message input should appear in the right panel
      cy.get("textarea[placeholder*='Type a message']", { timeout: 10000 }).should("be.visible")
    })
  })

  describe("Send Message", () => {
    beforeEach(() => {
      // Register second user
      cy.clearCookies()
      cy.registerAndLogin({ name: "Loan Officer", email: "officer@test.com" })
      cy.task("db:promoteUser", { email: "officer@test.com", role: "loanOfficer" })

      // Log back in as admin and create conversation
      cy.clearCookies()
      cy.login(adminEmail, "TestPass123!")
      cy.url({ timeout: 15000 }).should("include", "/dashboard")

      cy.visit("/chat")
      cy.get("[aria-label='New conversation']").click()
      cy.get("input[placeholder='Search by name...']").type("Loan Officer")
      cy.contains("Loan Officer", { timeout: 10000 }).click()
      cy.contains("button", "Start Chat").click()

      // Wait for conversation to be active and message input visible
      cy.get("textarea[placeholder*='Type a message']", { timeout: 10000 }).should("be.visible")
    })

    it("types a message and sends it with Enter key, message appears in thread", () => {
      cy.get("textarea[placeholder*='Type a message']").type("Hello from admin{enter}")

      // Message should appear in the thread (polling may take up to 5s)
      cy.contains("Hello from admin", { timeout: 10000 }).should("be.visible")
    })

    it("sends a message using the send button", () => {
      cy.get("textarea[placeholder*='Type a message']").type("Button send test")
      cy.get("[aria-label='Send message']").click()

      cy.contains("Button send test", { timeout: 10000 }).should("be.visible")
    })

    it("textarea is cleared after sending a message", () => {
      cy.get("textarea[placeholder*='Type a message']").type("Clear after send{enter}")
      cy.get("textarea[placeholder*='Type a message']", { timeout: 5000 }).should("have.value", "")
    })
  })

  describe("Conversation Search", () => {
    beforeEach(() => {
      // Register two other users
      cy.clearCookies()
      cy.registerAndLogin({ name: "Alice Smith", email: "alice@test.com" })
      cy.task("db:promoteUser", { email: "alice@test.com", role: "loanOfficer" })

      cy.clearCookies()
      cy.registerAndLogin({ name: "Bob Jones", email: "bob@test.com" })
      cy.task("db:promoteUser", { email: "bob@test.com", role: "loanOfficer" })

      // Log back in as admin
      cy.clearCookies()
      cy.login(adminEmail, "TestPass123!")
      cy.url({ timeout: 15000 }).should("include", "/dashboard")
      cy.visit("/chat")

      // Create conversation with Alice
      cy.get("[aria-label='New conversation']").click()
      cy.get("input[placeholder='Search by name...']").type("Alice Smith")
      cy.contains("Alice Smith", { timeout: 10000 }).click()
      cy.contains("button", "Start Chat").click()
      cy.contains("Alice Smith", { timeout: 10000 }).should("be.visible")

      // Create conversation with Bob
      cy.get("[aria-label='New conversation']").click()
      cy.get("input[placeholder='Search by name...']").type("Bob Jones")
      cy.contains("Bob Jones", { timeout: 10000 }).click()
      cy.contains("button", "Start Chat").click()
      cy.contains("Bob Jones", { timeout: 10000 }).should("be.visible")
    })

    it("search box filters conversations by participant name", () => {
      cy.get("input[placeholder='Search conversations...']").type("Alice")

      // Alice should be visible, Bob should not
      cy.contains("Alice Smith").should("be.visible")
      cy.contains("Bob Jones").should("not.exist")
    })

    it("clearing search shows all conversations again", () => {
      cy.get("input[placeholder='Search conversations...']").type("Alice")
      cy.contains("Bob Jones").should("not.exist")

      cy.get("input[placeholder='Search conversations...']").clear()

      cy.contains("Alice Smith").should("be.visible")
      cy.contains("Bob Jones").should("be.visible")
    })

    it("shows no conversations match your search for unmatched query", () => {
      cy.get("input[placeholder='Search conversations...']").type("zzznomatch")
      cy.contains("No conversations match your search").should("be.visible")
    })
  })

  describe("Access Control", () => {
    it("unassigned user visiting /chat is redirected to /pending-approval", () => {
      cy.clearCookies()

      // Register a second (unassigned) user manually — not using registerAndLogin (which auto-promotes)
      const email = `unassigned-chat-${Date.now()}@fidexa.org`
      cy.visit("/register")
      cy.get("#name").type("Unassigned User")
      cy.get("#email").type(email)
      cy.get("#password").type("TestPass123!")
      cy.get("#confirmPassword").type("TestPass123!")
      cy.get("button[type=submit]").click()

      cy.url({ timeout: 15000 }).should("include", "/pending-approval")

      // Attempting to visit /chat should still redirect to /pending-approval
      cy.visit("/chat")
      cy.url({ timeout: 10000 }).should("include", "/pending-approval")
    })

    it("unauthenticated user visiting /chat is redirected to /login", () => {
      cy.clearCookies()
      cy.visit("/chat")
      cy.url({ timeout: 10000 }).should("include", "/login")
    })
  })
})
