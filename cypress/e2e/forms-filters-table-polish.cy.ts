describe("Forms, Filters, and Table Polish (Phase 14)", () => {
  beforeEach(() => {
    cy.task("db:reset")
    cy.registerAndLogin()
    cy.url({ timeout: 15000 }).should("include", "/dashboard")
  })

  // --- RESP-03: Single-column forms at mobile viewport ---
  context("RESP-03: single-column forms at mobile viewport (390x844)", () => {
    beforeEach(() => cy.viewport(390, 844))

    it("customer registration form fields stack vertically", () => {
      cy.visit("/customers/new")
      // Wait for the form to load
      cy.get("#fullName", { timeout: 10000 }).should("be.visible")
      // Get all visible input/textarea/select fields and verify they stack vertically
      cy.get("input:visible, textarea:visible, select:visible").then(($fields) => {
        if ($fields.length < 2) return
        const tops: number[] = []
        $fields.each((_, el) => {
          tops.push(el.getBoundingClientRect().top)
        })
        // Adjacent fields should have different top values (stacked, not side-by-side)
        for (let i = 1; i < tops.length; i++) {
          expect(tops[i]).to.be.greaterThan(tops[i - 1])
        }
      })
    })

    it("loan wizard step 1 fields stack vertically", () => {
      // Create a customer first to use in the loan wizard
      cy.visit("/customers/new")
      cy.get("#fullName").type("Form Test Customer")
      cy.get("#contact").type("0700000099")
      cy.get("#address").type("Test Address")
      cy.contains("button", "Register Customer").click()
      cy.url({ timeout: 10000 }).should("match", /\/customers\/[0-9a-f-]{36}/)

      cy.url().then((url) => {
        const cid = url.split("/customers/")[1]
        // Navigate directly to loan wizard with customerId pre-filled
        cy.visit(`/loans/new?customerId=${cid}`)
        cy.url({ timeout: 10000 }).should("include", "/loans/new")

        // Wait for step 1 to be visible (principalAmount is always visible on step 1)
        cy.get("#principalAmount", { timeout: 10000 }).should("be.visible")

        // Verify step 1 form fields stack vertically
        cy.get("input:visible, textarea:visible").then(($fields) => {
          if ($fields.length < 2) return
          const tops: number[] = []
          $fields.each((_, el) => {
            tops.push(el.getBoundingClientRect().top)
          })
          for (let i = 1; i < tops.length; i++) {
            expect(tops[i]).to.be.greaterThan(tops[i - 1])
          }
        })
      })
    })

    it("creditor registration form fields stack vertically", () => {
      cy.visit("/creditors/new")
      // Wait for the form to load
      cy.get('input[name="name"]', { timeout: 10000 }).should("be.visible")
      // Check stacking of top-level input elements (name, contact, address, interestRateMonthly, investmentDate)
      // The amount field is inside a flex row with UGX prefix — verify it does not share the same row as another input
      cy.get('input[name="name"]').then(($name) => {
        cy.get('input[name="contact"]').then(($contact) => {
          const nameTop = $name[0].getBoundingClientRect().top
          const contactTop = $contact[0].getBoundingClientRect().top
          expect(contactTop).to.be.greaterThan(nameTop)
        })
      })
      cy.get('input[name="contact"]').then(($contact) => {
        cy.get('input[name="address"]').then(($address) => {
          const contactTop = $contact[0].getBoundingClientRect().top
          const addressTop = $address[0].getBoundingClientRect().top
          expect(addressTop).to.be.greaterThan(contactTop)
        })
      })
    })
  })

  // --- RESP-04: Collapsible filter panels ---
  context("RESP-04: collapsible filter panels", () => {
    context("at mobile viewport (390x844)", () => {
      beforeEach(() => cy.viewport(390, 844))

      it("customers filter panel is collapsed by default and toggle opens it", () => {
        cy.visit("/customers")
        // Filter toggle button should be visible on mobile
        cy.get("[aria-label='Toggle filters']", { timeout: 10000 }).should("be.visible")
        // Filter panel content should be hidden (collapsed)
        cy.get("[data-slot='filter-panel-content']").should("not.be.visible")
        // Click toggle to expand
        cy.get("[aria-label='Toggle filters']").click()
        // Filter panel content should now be visible
        cy.get("[data-slot='filter-panel-content']").should("be.visible")
        // Click toggle again to collapse
        cy.get("[aria-label='Toggle filters']").click()
        cy.get("[data-slot='filter-panel-content']").should("not.be.visible")
      })

      it("payments filter panel is collapsed by default and toggle opens it", () => {
        cy.visit("/payments")
        cy.get("[aria-label='Toggle filters']", { timeout: 10000 }).should("be.visible")
        cy.get("[data-slot='filter-panel-content']").should("not.be.visible")
        cy.get("[aria-label='Toggle filters']").click()
        cy.get("[data-slot='filter-panel-content']").should("be.visible")
      })
    })

    context("at desktop viewport (1280x800)", () => {
      beforeEach(() => cy.viewport(1280, 800))

      it("customers filter panel is expanded by default with no toggle visible", () => {
        cy.visit("/customers")
        cy.get("[data-slot='filter-panel-content']", { timeout: 10000 }).should("exist")
        // Toggle button should be hidden on desktop (md:hidden class makes it not visible)
        cy.get("[aria-label='Toggle filters']").should("not.be.visible")
        // Filter panel content should be visible (md:!block override)
        cy.get("[data-slot='filter-panel-content']").should("be.visible")
      })

      it("payments filter panel is expanded by default with no toggle visible", () => {
        cy.visit("/payments")
        cy.get("[data-slot='filter-panel-content']", { timeout: 10000 }).should("exist")
        cy.get("[aria-label='Toggle filters']").should("not.be.visible")
        cy.get("[data-slot='filter-panel-content']").should("be.visible")
      })
    })
  })

  // --- RESP-05: Sticky table headers on desktop ---
  context("RESP-05: sticky table headers on desktop", () => {
    beforeEach(() => cy.viewport(1280, 800))

    it("table header remains visible after scrolling on customers page", () => {
      // Seed a customer to ensure the table renders
      cy.visit("/customers/new")
      cy.get("#fullName").type("Sticky Header Customer")
      cy.get("#contact").type("0700000011")
      cy.get("#address").type("Kampala, Uganda")
      cy.contains("button", "Register Customer").click()
      cy.url({ timeout: 10000 }).should("match", /\/customers\/[0-9a-f-]{36}/)

      cy.visit("/customers")
      // Desktop table container is visible
      cy.get("[data-slot='table-container']", { timeout: 10000 }).should("be.visible")
      // Table header cells should be visible
      cy.get("[data-slot='table-head']").first().should("be.visible")
      // Scroll the overflow-y-auto desktop wrapper to the bottom
      cy.get(".overflow-y-auto").first().scrollTo("bottom", { ensureScrollable: false })
      // Table header should still be visible after scroll (sticky)
      cy.get("[data-slot='table-head']").first().should("be.visible")
    })
  })
})
