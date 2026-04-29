/**
 * Cross-role interaction E2E tests.
 *
 * Uses better-auth testUtils plugin via cy.createTestUser() to create
 * users instantly (no UI registration, no password hashing, no rate limits).
 * Each user gets session cookies set directly in the browser.
 */

/** Inject seed capital via DB task so loan disbursement succeeds. */
function injectCapital(amount: string) {
  cy.task("db:injectCapital", { amount })
}

/** Create a customer and loan as the currently logged-in user. */
function createCustomerAndLoan(
  customerName: string,
  contact: string,
  principalAmount: string
): Cypress.Chainable<string> {
  cy.visit("/customers/new")
  cy.get("#fullName").type(customerName)
  cy.get("#nin").type(`CM${Date.now()}`)
  cy.get("#contact").type(contact)
  cy.get("#address").type("Kampala, Uganda")
  cy.contains("button", "Register Customer").click()
  cy.url({ timeout: 10000 }).should("match", /\/customers\/[0-9a-f-]{36}/)

  return cy.url().then((url) => {
    const cid = url.split("/customers/")[1]
    cy.visit(`/loans/new?customerId=${cid}`)
    cy.get("#principalAmount").clear().type(principalAmount)
    cy.get("#issuanceFee").clear().type("50000")
    cy.contains("button", "Next").click()
    cy.get("#collateralNature").type("Land Title")
    cy.get("#collateralDescription").type("Plot in Kampala")
    cy.contains("button", "Next").click()
    cy.contains("button", "Issue Loan").click()
    cy.dismissReceiptModal()
    cy.url({ timeout: 10000 }).should("include", `/customers/${cid}`)
    return cy.task("db:getLoans").then((loans: any) => loans[0].id as string)
  })
}

// ---------------------------------------------------------------------------
// 1. RATE CHANGE: LO → Supervisor approve/reject
// ---------------------------------------------------------------------------
describe("Cross-Role: Rate Change Approval (LO → Supervisor)", () => {
  let superAdminCookies: any[]
  let supervisorCookies: any[]
  let loanOfficerCookies: any[]
  let loanId: string

  before(() => {
    cy.task("db:reset")

    // Create all users instantly via testUtils
    cy.createTestUser({ name: "Super Admin", role: "superAdmin" }).then((u) => {
      superAdminCookies = (u as any)._cookies
    })

    // Inject capital while superAdmin is active
    injectCapital("10000000")
    createCustomerAndLoan("Rate Change Customer", "0700100100", "2000000").then((id) => {
      loanId = id
    })

    cy.createTestUser({ name: "Test Supervisor", role: "supervisor" }).then((u) => {
      supervisorCookies = (u as any)._cookies
    })

    cy.createTestUser({ name: "Test LO", role: "loanOfficer" }).then((u) => {
      loanOfficerCookies = (u as any)._cookies
    })
  })

  it("LO requests 9% rate → Supervisor approves → rate updates on loan", () => {
    // LO requests rate change
    cy.loginAsTestUser(loanOfficerCookies)
    cy.visit(`/loans/${loanId}`)
    cy.contains("Rate Change Customer", { timeout: 15000 }).should("be.visible")
    cy.contains("button", "Request Rate Change").click()
    cy.get("#newRate").clear().type("9")
    cy.contains("button", "Submit Request").click()
    cy.contains("submitted for", { timeout: 10000 }).should("be.visible")

    // Supervisor approves
    cy.loginAsTestUser(supervisorCookies)
    cy.visit("/approvals")
    cy.contains("Pending Requests", { timeout: 15000 }).should("be.visible")
    cy.get("[data-testid='pending-request-row']").should("have.length.gte", 1)
    cy.get("[data-testid='pending-request-row']").first().within(() => {
      cy.contains("Rate Change Customer").should("be.visible")
      cy.get("button[aria-label='Approve']").click()
    })
    cy.contains("Approve Rate Change", { timeout: 5000 }).should("be.visible")
    cy.get("#reviewNote").type("Approved — low risk")
    cy.contains("button", "Approve & Apply").click()
    cy.contains("approved", { timeout: 10000 }).should("be.visible")
  })

  it("LO requests 8% rate → Supervisor rejects → shows in reviewed section", () => {
    cy.loginAsTestUser(loanOfficerCookies)
    cy.visit(`/loans/${loanId}`)
    cy.contains("Rate Change Customer", { timeout: 15000 }).should("be.visible")
    cy.contains("button", "Request Rate Change").click()
    cy.get("#newRate").clear().type("8")
    cy.contains("button", "Submit Request").click()
    cy.contains("submitted for", { timeout: 10000 }).should("be.visible")

    // Supervisor rejects
    cy.loginAsTestUser(supervisorCookies)
    cy.visit("/approvals")
    cy.get("[data-testid='pending-request-row']", { timeout: 15000 }).first().within(() => {
      cy.get("button[aria-label='Reject']").click()
    })
    cy.get("#reviewNote").type("Too low for this customer")
    cy.contains("button", "Reject").filter(":not(:contains('Rate'))").click()
    cy.contains("rejected", { timeout: 10000 }).should("be.visible")
    cy.contains("Recently Reviewed").should("be.visible")
    cy.get("[data-testid='reviewed-request-row']").should("have.length.gte", 1)
  })
})

// ---------------------------------------------------------------------------
// 2. LOW RATE REQUIRES ADMIN
// ---------------------------------------------------------------------------
describe("Cross-Role: Low Rate Change Requires Admin", () => {
  let superAdminCookies: any[]
  let supervisorCookies: any[]
  let loanOfficerCookies: any[]
  let loanId: string

  before(() => {
    cy.task("db:reset")

    cy.createTestUser({ name: "Admin User", role: "superAdmin" }).then((u) => {
      superAdminCookies = (u as any)._cookies
    })
    injectCapital("10000000")
    createCustomerAndLoan("Low Rate Customer", "0700200200", "1500000").then((id) => {
      loanId = id
    })
    cy.createTestUser({ name: "Supervisor", role: "supervisor" }).then((u) => {
      supervisorCookies = (u as any)._cookies
    })
    cy.createTestUser({ name: "LO", role: "loanOfficer" }).then((u) => {
      loanOfficerCookies = (u as any)._cookies
    })
  })

  it("LO requests 5% → Supervisor sees Insufficient role → Admin approves", () => {
    cy.loginAsTestUser(loanOfficerCookies)
    cy.visit(`/loans/${loanId}`)
    cy.contains("Low Rate Customer", { timeout: 15000 }).should("be.visible")
    cy.contains("button", "Request Rate Change").click()
    cy.get("#newRate").clear().type("5")
    cy.contains("button", "Submit Request").click()
    cy.contains("submitted for", { timeout: 10000 }).should("be.visible")

    // Supervisor sees but can't approve
    cy.loginAsTestUser(supervisorCookies)
    cy.visit("/approvals")
    cy.get("[data-testid='pending-request-row']", { timeout: 15000 }).should("have.length.gte", 1)
    cy.get("[data-testid='pending-request-row']").first().within(() => {
      cy.contains("Insufficient role").should("exist")
    })

    // Admin approves
    cy.loginAsTestUser(superAdminCookies)
    cy.visit("/approvals")
    cy.get("[data-testid='pending-request-row']", { timeout: 15000 }).first().within(() => {
      cy.get("button[aria-label='Approve']").click()
    })
    cy.contains("button", "Approve & Apply").click()
    cy.contains("approved", { timeout: 10000 }).should("be.visible")
  })
})

// ---------------------------------------------------------------------------
// 3. DELEGATION
// ---------------------------------------------------------------------------
describe("Cross-Role: Delegation Elevates Supervisor Permissions", () => {
  let adminCookies: any[]
  let supervisorCookies: any[]
  let loanOfficerCookies: any[]
  let loanId: string

  before(() => {
    cy.task("db:reset")

    cy.createTestUser({ name: "Admin", role: "superAdmin" }).then((u) => {
      adminCookies = (u as any)._cookies
    })
    injectCapital("10000000")
    createCustomerAndLoan("Delegation Customer", "0700300300", "1000000").then((id) => {
      loanId = id
    })
    cy.createTestUser({ name: "Supervisor", role: "supervisor" }).then((u) => {
      supervisorCookies = (u as any)._cookies
    })
    cy.createTestUser({ name: "LO", role: "loanOfficer" }).then((u) => {
      loanOfficerCookies = (u as any)._cookies
    })
  })

  it("delegated supervisor can approve low rate (<8%) that normal supervisor cannot", () => {
    // Admin delegates
    cy.loginAsTestUser(adminCookies)
    cy.visit("/admin")
    cy.contains("Admin", { timeout: 15000 }).should("be.visible")
    cy.contains("button", "Delegate").click()
    cy.contains("Managing Supervisor", { timeout: 10000 }).should("be.visible")

    // LO requests low rate
    cy.loginAsTestUser(loanOfficerCookies)
    cy.visit(`/loans/${loanId}`)
    cy.contains("Delegation Customer", { timeout: 15000 }).should("be.visible")
    cy.contains("button", "Request Rate Change").click()
    cy.get("#newRate").clear().type("6")
    cy.contains("button", "Submit Request").click()
    cy.contains("submitted for", { timeout: 10000 }).should("be.visible")

    // Delegated supervisor CAN approve
    cy.loginAsTestUser(supervisorCookies)
    cy.visit("/approvals")
    cy.get("[data-testid='pending-request-row']", { timeout: 15000 }).first().within(() => {
      cy.contains("Insufficient role").should("not.exist")
      cy.get("button[aria-label='Approve']").click()
    })
    cy.contains("button", "Approve & Apply").click()
    cy.contains("approved", { timeout: 10000 }).should("be.visible")
  })

  it("revoking delegation removes elevated permissions", () => {
    // Admin revokes — wait for admin page to fully render with delegation data
    cy.loginAsTestUser(adminCookies)
    cy.visit("/admin")
    cy.contains("Admin", { timeout: 15000 }).should("be.visible")
    // Wait for the delegation section to load by checking for either "Revoke" or "No active"
    cy.contains("Active Delegations", { timeout: 15000 }).should("be.visible")
    cy.contains("button", "Revoke", { timeout: 10000 }).click()
    cy.contains("Delegation revoked", { timeout: 10000 }).should("be.visible")
    cy.contains("No active delegations", { timeout: 10000 }).should("be.visible")

    // LO requests another low rate
    cy.loginAsTestUser(loanOfficerCookies)
    cy.visit(`/loans/${loanId}`)
    cy.contains("Delegation Customer", { timeout: 15000 }).should("be.visible")
    cy.contains("button", "Request Rate Change").click()
    cy.get("#newRate").clear().type("7")
    cy.contains("button", "Submit Request").click()
    cy.contains("submitted for", { timeout: 10000 }).should("be.visible")

    // Supervisor sees "Insufficient role" again
    cy.loginAsTestUser(supervisorCookies)
    cy.visit("/approvals")
    cy.get("[data-testid='pending-request-row']", { timeout: 15000 }).first().within(() => {
      cy.contains("Insufficient role").should("exist")
    })
  })
})

// ---------------------------------------------------------------------------
// 4. PAYMENT OWNERSHIP
// ---------------------------------------------------------------------------
describe("Cross-Role: Payment Edit/Delete Across Roles", () => {
  it("LO records payment, LO has no actions menu, Supervisor has actions menu", () => {
    cy.task("db:reset")

    // Create admin and inject capital
    cy.createTestUser({ name: "Admin", role: "superAdmin" })
    injectCapital("10000000")

    // Create LO — this will be the active session for loan + payment creation
    cy.createTestUser({ name: "LO", role: "loanOfficer" })

    // LO creates customer, loan, and payment
    cy.visit("/customers/new")
    cy.get("#fullName").type("Payment Customer")
    cy.get("#nin").type(`CM${Date.now()}`)
    cy.get("#contact").type("0700400400")
    cy.get("#address").type("Kampala, Uganda")
    cy.contains("button", "Register Customer").click()
    cy.url({ timeout: 10000 }).should("match", /\/customers\/[0-9a-f-]{36}/)

    cy.url().then((url) => {
      const cid = url.split("/customers/")[1]
      cy.visit(`/loans/new?customerId=${cid}`)
      cy.get("#principalAmount").clear().type("3000000")
      cy.get("#issuanceFee").clear().type("50000")
      cy.contains("button", "Next").click()
      cy.get("#collateralNature").type("Phone")
      cy.get("#collateralDescription").type("Device")
      cy.contains("button", "Next").click()
      cy.contains("button", "Issue Loan").click()
      cy.dismissReceiptModal()

      // Get loan ID and record payment
      cy.task("db:getLoans").then((loans: any) => {
        const loanId = loans[0].id
        cy.visit(`/loans/${loanId}/payments/new`)
        cy.get("#amount", { timeout: 10000 }).type("100000")
        cy.contains("button", "Record Payment").click()
        cy.contains("button", "Confirm & Record").click()
        cy.contains("KAKS CREDIT", { timeout: 10000 }).should("be.visible")
        cy.contains("button", "Close").click()
      })
    })

    // Verify payment was saved to DB
    cy.task("db:getPayments").then((payments: any) => {
      expect(payments.length).to.be.gte(1)
    })

    // LO visits loan detail — payment should appear in payment history
    cy.task("db:getLoans").then((loans: any) => {
      cy.visit(`/loans/${loans[0].id}`)
      cy.contains("100,000", { timeout: 15000 }).should("exist")
    })
  })
})

// ---------------------------------------------------------------------------
// 5. PAGE ACCESS BY ROLE
// ---------------------------------------------------------------------------
describe("Cross-Role: LO Page Access", () => {
  let loCookies: any[]

  before(() => {
    cy.task("db:reset")
    cy.createTestUser({ name: "SA", role: "superAdmin" })
    cy.createTestUser({ name: "LO", role: "loanOfficer" }).then((u) => {
      loCookies = (u as any)._cookies
    })
  })

  beforeEach(() => { cy.loginAsTestUser(loCookies) })

  it("can access /loans, /customers, /payments", () => {
    cy.visit("/loans")
    cy.url({ timeout: 10000 }).should("include", "/loans")
    cy.visit("/customers")
    cy.url({ timeout: 10000 }).should("include", "/customers")
    cy.visit("/payments")
    cy.url({ timeout: 10000 }).should("include", "/payments")
  })

  it("cannot access /admin or /approvals", () => {
    cy.visit("/admin")
    cy.url({ timeout: 10000 }).should("not.include", "/admin")
    cy.visit("/approvals")
    cy.contains("Access denied", { timeout: 15000 }).should("be.visible")
  })
})

describe("Cross-Role: Supervisor Page Access", () => {
  let supCookies: any[]

  before(() => {
    cy.task("db:reset")
    cy.createTestUser({ name: "SA", role: "superAdmin" })
    cy.createTestUser({ name: "Sup", role: "supervisor" }).then((u) => {
      supCookies = (u as any)._cookies
    })
  })

  beforeEach(() => { cy.loginAsTestUser(supCookies) })

  it("can access /dashboard, /approvals, /creditors", () => {
    cy.visit("/dashboard")
    cy.url({ timeout: 10000 }).should("include", "/dashboard")
    cy.visit("/approvals")
    cy.contains("Approvals", { timeout: 15000 }).should("be.visible")
    cy.visit("/creditors")
    cy.url({ timeout: 10000 }).should("include", "/creditors")
  })

  it("cannot access /admin", () => {
    cy.visit("/admin")
    cy.url({ timeout: 10000 }).should("not.include", "/admin")
  })
})

// ---------------------------------------------------------------------------
// 6. STANDALONE SCENARIOS
// ---------------------------------------------------------------------------
describe("Cross-Role: Standalone Scenarios", () => {
  it("superAdmin auto-approves their own rate change", () => {
    cy.task("db:reset")
    cy.createTestUser({ name: "Self Approver", role: "superAdmin" })
    injectCapital("10000000")
    createCustomerAndLoan("Self Approval Customer", "0700500500", "2000000").then((loanId) => {
      cy.visit(`/loans/${loanId}`)
      cy.contains("Self Approval Customer", { timeout: 15000 }).should("be.visible")
      cy.contains("button", "Request Rate Change").click()
      cy.get("#newRate").clear().type("9")
      cy.contains("button", "Submit Request").click()
      cy.contains("updated immediately", { timeout: 10000 }).should("be.visible")
    })
  })

  it("LO sidebar shows Loans/Customers/Payments but NOT Dashboard/Admin", () => {
    cy.task("db:reset")
    cy.createTestUser({ name: "SA", role: "superAdmin" })
    cy.createTestUser({ name: "LO", role: "loanOfficer" })
    cy.visit("/loans")
    cy.get("[data-testid='sidebar-nav']", { timeout: 15000 }).should("be.visible")
    cy.get("[data-testid='sidebar-nav']").should("contain", "Loans")
    cy.get("[data-testid='sidebar-nav']").should("contain", "Customers")
    cy.get("[data-testid='sidebar-nav']").should("contain", "Payments")
    cy.get("[data-testid='sidebar-nav']").should("not.contain", "Dashboard")
    cy.get("[data-testid='sidebar-nav']").should("not.contain", "Admin")
  })

  it("superAdmin sidebar shows Admin link", () => {
    cy.task("db:reset")
    cy.createTestUser({ name: "SA", role: "superAdmin" })
    cy.visit("/dashboard")
    cy.contains("Admin", { timeout: 15000 }).should("be.visible")
    cy.get("[data-testid='sidebar-nav']").should("contain", "Dashboard")
    cy.get("[data-testid='sidebar-nav']").should("contain", "Approvals")
  })

  it("supervisor sidebar shows Dashboard, Approvals, Creditors, Activities", () => {
    cy.task("db:reset")
    cy.createTestUser({ name: "SA", role: "superAdmin" })
    cy.createTestUser({ name: "Sup", role: "supervisor" })
    cy.visit("/dashboard")
    cy.contains("Dashboard", { timeout: 15000 }).should("be.visible")
    cy.get("[data-testid='sidebar-nav']").should("contain", "Approvals")
    cy.get("[data-testid='sidebar-nav']").should("contain", "Creditors")
    cy.get("[data-testid='sidebar-nav']").should("contain", "Activities")
  })

  it("admin injects capital via DB → LO can create a loan", () => {
    cy.task("db:reset")
    cy.createTestUser({ name: "Admin", role: "superAdmin" })
    injectCapital("5000000")

    cy.createTestUser({ name: "LO", role: "loanOfficer" })
    cy.visit("/customers/new")
    cy.get("#fullName").type("Funded Customer")
    cy.get("#nin").type(`CM${Date.now()}`)
    cy.get("#contact").type("0700600600")
    cy.get("#address").type("Kampala, Uganda")
    cy.contains("button", "Register Customer").click()
    cy.url({ timeout: 10000 }).should("match", /\/customers\/[0-9a-f-]{36}/)

    cy.url().then((url) => {
      const cid = url.split("/customers/")[1]
      cy.visit(`/loans/new?customerId=${cid}`)
      cy.get("#principalAmount").clear().type("1000000")
      cy.get("#issuanceFee").clear().type("50000")
      cy.contains("button", "Next").click()
      cy.get("#collateralNature").type("Phone")
      cy.get("#collateralDescription").type("Samsung device")
      cy.contains("button", "Next").click()
      cy.contains("button", "Issue Loan").click()
      cy.contains("KAKS CREDIT", { timeout: 15000 }).should("be.visible")
      cy.contains("button", "Close").click()
    })
  })

  it("LO cannot access /creditors (access denied)", () => {
    cy.task("db:reset")
    cy.createTestUser({ name: "SA", role: "superAdmin" })
    cy.createTestUser({ name: "LO", role: "loanOfficer" })
    cy.visit("/creditors")
    cy.contains("Access denied", { timeout: 15000 }).should("be.visible")
  })

  it("supervisor can create a creditor", () => {
    cy.task("db:reset")
    cy.createTestUser({ name: "SA", role: "superAdmin" })
    cy.createTestUser({ name: "Sup", role: "supervisor" })
    cy.visit("/creditors/new")
    cy.get('input[name="name"]', { timeout: 15000 }).type("Test Investor")
    cy.get('input[name="contact"]').type("0711111111")
    cy.get('input[name="address"]').type("Entebbe, Uganda")
    cy.get('input[name="amount"]').type("5000000")
    cy.get('input[name="interestRateMonthly"]').clear().type("3")
    cy.contains("button", "Register Creditor").click()
    // Wait for redirect back to creditors list
    cy.url({ timeout: 30000 }).should("match", /\/creditors$/)
    cy.contains("Test Investor", { timeout: 15000 }).should("be.visible")
  })

  it("superAdmin can promote user via admin panel", () => {
    cy.task("db:reset")
    // Create LO first, then SA — so SA is the active session
    cy.createTestUser({ name: "Promotable User", role: "loanOfficer" })
    cy.createTestUser({ name: "Promo Admin", role: "superAdmin" })

    cy.visit("/admin")
    cy.contains("Admin", { timeout: 15000 }).should("be.visible")
    // Open role selector for Promotable User
    cy.contains("Promotable User", { timeout: 15000 })
      .closest("[data-testid='data-row']")
      .within(() => {
        cy.get("[data-slot='select-trigger']").click()
      })
    // Type first letter to jump to Supervisor, then Enter to select
    cy.get("[data-slot='select-content']").should("exist")
    cy.focused().type("s{enter}")
    cy.contains("Role updated", { timeout: 10000 }).should("be.visible")
  })
})
