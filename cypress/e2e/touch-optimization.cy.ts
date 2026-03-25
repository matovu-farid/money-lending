/**
 * Touch Optimization E2E Tests
 *
 * Covers TOUCH-01 (44px touch targets), TOUCH-02 (DrawerDialog responsive behavior),
 * and TOUCH-03 (MoreSheet swipe-to-close).
 */

/**
 * Simulates a touch swipe-down gesture to dismiss a Base UI Drawer.
 *
 * Base UI's DrawerViewport uses React's onTouchStart/onTouchMove/onTouchEnd for
 * touch-based swipe dismissal. The canStart() check requires:
 * 1. The touch coordinates must be within the popup element
 * 2. The element at those coordinates must not be a swipe-ignored target
 *    (buttons/links/inputs) — unless ignoreSelectorWhenTouch is false
 *    (DrawerViewport uses ignoreSelectorWhenTouch: false, so touch on buttons is OK)
 *
 * We dispatch on the Drawer.Viewport (parent of popup), targeting coordinates
 * that fall within the popup itself (near its top edge where the drag handle is).
 */
function swipeDownToDismiss(drawerSelector: string, distance = 300) {
  cy.get(drawerSelector).then(($popup) => {
    const popup = $popup[0]
    const viewport = popup.parentElement!

    const popupRect = popup.getBoundingClientRect()
    // Start near the top of the popup (drag handle area) to be within the popup bounds
    const startX = popupRect.left + popupRect.width / 2
    const startY = popupRect.top + 10 // 10px from top of popup

    cy.window().then((win) => {
      const makeTouch = (x: number, y: number) =>
        new win.Touch({
          identifier: 1,
          target: viewport,
          clientX: x,
          clientY: y,
          screenX: x,
          screenY: y,
          pageX: x,
          pageY: y,
          radiusX: 1,
          radiusY: 1,
          rotationAngle: 0,
          force: 0.5,
        })

      const dispatchTouchEvent = (type: string, touch: Touch) => {
        const touchList = type === "touchend" ? [] : [touch]
        viewport.dispatchEvent(
          new win.TouchEvent(type, {
            bubbles: true,
            cancelable: true,
            composed: true,
            touches: touchList,
            changedTouches: [touch],
            targetTouches: touchList,
          })
        )
      }

      const startTouch = makeTouch(startX, startY)
      dispatchTouchEvent("touchstart", startTouch)

      // Move down in increments to simulate swipe
      for (let i = 20; i <= distance; i += 20) {
        const moveTouch = makeTouch(startX, startY + i)
        dispatchTouchEvent("touchmove", moveTouch)
      }

      const endTouch = makeTouch(startX, startY + distance)
      dispatchTouchEvent("touchend", endTouch)
    })
  })
}

// Shared helper to create a customer + loan for tests that need an action menu
function createCustomerAndLoan() {
  cy.visit("/customers/new")
  cy.get("#fullName").type("Touch Test Customer")
  cy.get("#contact").type("0771234567")
  cy.get("#address").type("Kampala, Uganda")
  cy.contains("button", "Register Customer").click()
  cy.url({ timeout: 10000 }).should("match", /\/customers\/[0-9a-f-]{36}/)

  cy.url().then((url) => {
    const cid = url.split("/customers/")[1]
    cy.visit(`/loans/new?customerId=${cid}`)
    cy.get("#principalAmount").type("500000")
    cy.contains("button", "Next").click()
    cy.get("#collateralNature").type("Vehicle")
    cy.contains("button", "Next").click()
    cy.contains("button", "Issue Loan").click()
    cy.url({ timeout: 10000 }).should("include", `/customers/${cid}`)
  })
}

describe("Touch Optimization", () => {
  describe("TOUCH-01: 44px touch targets", () => {
    beforeEach(() => {
      cy.task("db:reset")
      cy.registerAndLogin({ name: "Touch Target Tester" })
      cy.url({ timeout: 15000 }).should("include", "/dashboard")
    })

    it("default Button has min 44px height at mobile viewport", () => {
      cy.viewport(390, 844)
      cy.visit("/loans")
      cy.contains("a", "New Loan", { timeout: 10000 }).should("be.visible")
      cy.contains("a", "New Loan")
        .invoke("outerHeight")
        .should("be.gte", 44)
    })

    it("DropdownMenuTrigger action button has min 44x44px at mobile viewport", () => {
      // Create a loan so the actions column appears
      createCustomerAndLoan()

      cy.viewport(390, 844)
      cy.visit("/loans")
      // Mobile cards are visible at 390px - find the loan action trigger
      cy.get('[data-testid="data-row"]', { timeout: 10000 }).filter(":visible").first().within(() => {
        cy.get('button[aria-label="Loan actions"]').then(($btn) => {
          expect($btn.outerHeight()).to.be.gte(44)
          expect($btn.outerWidth()).to.be.gte(44)
        })
      })
    })
  })

  describe("TOUCH-02: DrawerDialog responsive behavior", () => {
    beforeEach(() => {
      cy.task("db:reset")
      cy.registerAndLogin({ name: "Drawer Dialog Tester" })
      cy.url({ timeout: 15000 }).should("include", "/dashboard")
      createCustomerAndLoan()
    })

    it("opens as bottom drawer at mobile viewport", () => {
      cy.viewport(390, 844)
      cy.visit("/loans")
      cy.get('[data-testid="data-row"]', { timeout: 10000 }).filter(":visible").first().within(() => {
        cy.get('button[aria-label="Loan actions"]').click()
      })
      cy.contains("[role=menuitem]", "Delete").click()
      // At mobile viewport, DrawerDialog renders Drawer.Popup with data-slot="drawer-dialog-content"
      cy.get('[data-slot="drawer-dialog-content"]', { timeout: 5000 }).should("be.visible")
    })

    it("opens as centered modal at desktop viewport", () => {
      cy.viewport(1280, 900)
      cy.visit("/loans")
      cy.get('[data-testid="data-row"]', { timeout: 10000 }).first().within(() => {
        cy.get('button[aria-label="Loan actions"]').click()
      })
      cy.contains("[role=menuitem]", "Delete").click()
      // At desktop viewport, DrawerDialog renders Dialog with data-slot="dialog-content"
      cy.get('[data-slot="dialog-content"]', { timeout: 5000 }).should("be.visible")
    })

    it("drawer closes on swipe-down gesture", () => {
      cy.viewport(390, 844)
      cy.visit("/loans")
      cy.get('[data-testid="data-row"]', { timeout: 10000 }).filter(":visible").first().within(() => {
        cy.get('button[aria-label="Loan actions"]').click()
      })
      cy.contains("[role=menuitem]", "Delete").click()
      cy.get('[data-slot="drawer-dialog-content"]', { timeout: 5000 }).should("be.visible")

      // Swipe down from within the popup to dismiss
      // Targets coordinates within the popup (top edge = drag handle area)
      swipeDownToDismiss('[data-slot="drawer-dialog-content"]', 300)

      // Drawer should be dismissed
      cy.get('[data-slot="drawer-dialog-content"]').should("not.exist")
    })
  })

  describe("TOUCH-03: MoreSheet swipe-to-close", () => {
    beforeEach(() => {
      cy.task("db:reset")
      cy.viewport(390, 844)
      cy.registerAndLogin({ name: "MoreSheet Tester" })
      cy.url({ timeout: 15000 }).should("include", "/dashboard")
    })

    it("MoreSheet opens on tap of More tab", () => {
      cy.get('[data-testid="bottom-tab-more"]', { timeout: 10000 }).click()
      cy.get('[data-testid="more-sheet"]', { timeout: 5000 }).should("be.visible")
    })

    it("MoreSheet has visible drag handle", () => {
      cy.get('[data-testid="bottom-tab-more"]', { timeout: 10000 }).click()
      cy.get('[data-testid="more-sheet"]', { timeout: 5000 }).should("be.visible")
      // Drag handle is a div inside the drawer popup with rounded-full class
      cy.get('[data-testid="more-sheet"] div.rounded-full').should("exist")
    })

    it("MoreSheet dismisses on swipe-down gesture", () => {
      cy.get('[data-testid="bottom-tab-more"]', { timeout: 10000 }).click()
      cy.get('[data-testid="more-sheet"]', { timeout: 5000 }).should("be.visible")

      // Swipe down from within the popup to dismiss
      swipeDownToDismiss('[data-testid="more-sheet"]', 300)

      // Sheet should be dismissed
      cy.get('[data-testid="more-sheet"]').should("not.exist")
    })
  })
})
