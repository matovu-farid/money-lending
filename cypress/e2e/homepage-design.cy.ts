function luminance(document: Document, color: string) {
  const canvas = document.createElement("canvas")
  canvas.width = canvas.height = 1
  const context = canvas.getContext("2d")!
  context.fillStyle = color
  context.fillRect(0, 0, 1, 1)
  const [r, g, b] = Array.from(context.getImageData(0, 0, 1, 1).data).map((value) => {
    const channel = value / 255
    return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4
  })
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}

function checkTextContrast(selector: string, minimum = 4.5) {
  cy.get(selector).each(($element) => {
    const element = $element[0]
    const foreground = getComputedStyle(element).color
    let parent: HTMLElement | null = element
    let background = "rgba(0, 0, 0, 0)"
    while (parent && background === "rgba(0, 0, 0, 0)") {
      background = getComputedStyle(parent).backgroundColor
      parent = parent.parentElement
    }
    const lightness = [luminance(element.ownerDocument, foreground), luminance(element.ownerDocument, background)].sort((a, b) => b - a)
    expect((lightness[0] + 0.05) / (lightness[1] + 0.05), `contrast for ${selector}`).to.be.at.least(minimum)
  })
}

describe("Public homepage design", () => {
  beforeEach(() => {
    cy.viewport(1440, 1000)
    cy.visit("/home")
  })

  it("explains the product and clearly labels illustrative data", () => {
    cy.get("h1").should("have.length", 1).and("contain", "Every loan.").and("contain", "Every payment.")
    cy.get('figure[aria-label="Kaks Credit dashboard with fictional data"]').should("be.visible")
    cy.contains("All data is fictional").should("be.visible")
    cy.contains("Portfolio visibility").should("be.visible")
    cy.contains("Record the loan").should("be.visible")
    cy.get("footer").should("contain", "Kaks Credit")
  })

  it("connects navigation to the product and workflow sections", () => {
    cy.get('nav a[href="#workspace"]').click()
    cy.location("hash").should("eq", "#workspace")
    cy.get(".home-preview-label").should("be.visible")
    cy.get('nav a[href="#workflow"]').click()
    cy.location("hash").should("eq", "#workflow")
    cy.get("#home-workflow-title").should("be.visible")
  })

  it("routes both primary actions correctly", () => {
    cy.get('.home-hero a[href="/login"]').click()
    cy.location("pathname").should("eq", "/login")
    cy.visit("/home")
    cy.get('.home-hero a[href="/request-access"]').click()
    cy.location("pathname").should("eq", "/request-access")
    cy.contains("h1", "Request access").should("be.visible")
  })

  it("provides a keyboard skip link and visible focus", () => {
    cy.get(".home-skip-link").focus().should("be.visible")
    cy.focused().should("have.css", "outline-style", "solid")
    cy.get(".home-skip-link").click()
    cy.location("hash").should("eq", "#main-content")
  })

  it("keeps an explicit homepage visit public for returning visitors", () => {
    cy.setCookie("has_account", "1")
    cy.reload()
    cy.location("pathname").should("eq", "/home")
    cy.get("h1").should("be.visible")
  })

  it("keeps preview text readable on a small phone", () => {
    cy.viewport(360, 844)
    cy.get(".home-preview-label, .home-preview-caption, .home-preview [data-kpi-label] p").each(($element) => {
      expect(parseFloat(getComputedStyle($element[0]).fontSize), $element[0].textContent ?? "preview text").to.be.at.least(12)
    })
  })

  it("offers a complete mobile snapshot and full dashboard without nested scrolling", () => {
    cy.viewport(390, 844)
    cy.get('.home-preview [data-kpi-label]:visible').should("have.length", 3)
    cy.get('.home-preview [data-kpi-label="Overdue Count"]').should("be.visible")
    cy.get('.home-preview [data-kpi-label="Repayments Collected"]').should("not.be.visible")
    cy.get(".home-preview-main").should(($main) => {
      expect($main[0].scrollHeight).to.be.lte($main[0].clientHeight + 1)
    })
    cy.contains("button", "Expand dashboard").click()
    cy.get('.home-preview [data-kpi-label]:visible').should("have.length", 6)
    cy.contains(".home-preview", "Recent Activity").scrollIntoView().should("be.visible")
    cy.get(".home-preview .recharts-surface").should("have.length", 2)
    cy.contains("button", "Collapse dashboard").should("be.visible").click()
    cy.get(".home-preview-topbar").should(($bar) => {
      // Browser scroll anchoring may round to a fractional pixel above the viewport.
      expect($bar[0].getBoundingClientRect().top).to.be.within(-1, 32)
    })
    cy.get('.home-preview [data-kpi-label]:visible').should("have.length", 3)
  })

  it("keeps the brand and the primary action clear on the narrowest phone", () => {
    cy.viewport(320, 844)
    cy.get('.home-nav > a').should("contain", "Kaks Credit")
    cy.get('.home-nav > a .font-semibold').should("be.visible")
    cy.get('.home-nav-sign-in').should("not.be.visible")
    cy.get('.home-hero a[href="/login"]').should("be.visible")
  })

  for (const width of [610, 700, 767]) {
    it(`keeps the headline and compact snapshot composed at ${width}px`, () => {
      cy.viewport(width, 900)
      cy.get(".home-hero h1 span").each(($line) => {
        const range = $line[0].ownerDocument.createRange()
        range.selectNodeContents($line[0])
        expect(range.getClientRects().length, "headline phrase stays on one line").to.equal(1)
      })
      cy.get('.home-preview [data-kpi-label]:visible').should("have.length", 3)
      cy.get('.home-preview [data-dashboard-section="actions"]').should("not.be.visible")
      if (width === 610) cy.get(".home-hero").screenshot("homepage-610-hero", { disableTimersAndAnimations: false })
      cy.contains("button", "Expand dashboard").should("be.enabled").click()
      cy.get('.home-preview [data-kpi-label]:visible').should("have.length", 6)
      cy.get('.home-preview [data-dashboard-section="actions"]').should("be.visible")
    })

    it(`keeps workflow typography and steps readable at ${width}px`, () => {
      cy.viewport(width, 900)
      cy.get("#home-workflow-title").should(($heading) => {
        for (const textNode of Array.from($heading[0].childNodes).filter((node) => node.nodeType === Node.TEXT_NODE)) {
          const range = $heading[0].ownerDocument.createRange()
          range.selectNodeContents(textNode)
          expect(range.getClientRects().length, "workflow heading phrase stays together").to.equal(1)
        }
      })
      cy.get(".home-workflow-item").then(($steps) => {
        for (let index = 1; index < $steps.length; index++) {
          const previous = $steps[index - 1].getBoundingClientRect()
          const current = $steps[index].getBoundingClientRect()
          expect(current.top, "steps form a readable vertical sequence").to.be.greaterThan(previous.bottom + 16)
        }
      })
      if (width === 610) cy.get(".home-workflow-band").screenshot("homepage-610-workflow", { disableTimersAndAnimations: false })
    })
  }

  it("shows the real dashboard sections and fictional KPI values", () => {
    cy.contains("button", "Expand dashboard").should("be.enabled").click()
    cy.get(".home-preview").within(() => {
      cy.contains("h2", "Dashboard").should("be.visible")
      cy.contains("Portfolio health at a glance").should("be.visible")
      cy.get('[data-kpi-label="Loans Outstanding"]').should("contain", "UGX 8,750,000")
      cy.get('[data-kpi-label="Active Borrowers"]').should("contain", "18")
      cy.get('[data-kpi-label="Overdue Count"]').should("contain", "3")
      cy.get('[data-kpi-label="Repayments Collected"]').should("contain", "UGX 3,200,000")
      cy.get('[data-kpi-label="Interest Earned"]').should("contain", "UGX 640,000")
      cy.get('[data-kpi-label="Cash Available"]').should("contain", "UGX 2,500,000")
      for (const label of ["Record Payment", "New Customer", "New Loan", "View Overdue", "Daily Collections", "Loan Distribution", "Recent Activity"]) {
        cy.contains(label).scrollIntoView().should("be.visible")
      }
      cy.contains("Payment of UGX 150,000 recorded for Example Borrower A").scrollIntoView().should("be.visible")
      cy.contains("Upcoming collections").should("not.exist")
    })
    cy.get(".home-preview .recharts-surface").should("have.length", 2)
    cy.contains("button", "Collapse dashboard").should("have.attr", "aria-expanded", "true")
    cy.get(".home-preview .recharts-area-area").should("have.attr", "d").and("not.be.empty")
    cy.get(".home-preview .recharts-pie-sector .recharts-sector").should("have.length", 5)
    cy.get(".home-preview").screenshot("kaks-credit-dashboard-fictional", { disableTimersAndAnimations: false })
    cy.contains("button", "Collapse dashboard").click()
  })

  it("lets visitors expand and collapse the complete product preview", () => {
    cy.get('.home-preview [data-dashboard-section="charts"]').should("not.be.visible")
    cy.contains("button", "Expand dashboard").should("be.enabled").and("have.attr", "aria-expanded", "false").click()
    cy.get(".home-preview .recharts-surface").should("have.length", 2)
    cy.get(".home-preview-main").should(($main) => {
      expect($main[0].scrollHeight).to.be.lte($main[0].clientHeight + 1)
    })
    cy.contains("button", "Collapse dashboard").focus().should("have.focus")
    // cy.press sends keyCode 0 for Enter in Electron; dispatch the complete native key.
    cy.then(async () => {
      const key = { key: "Enter", code: "Enter", windowsVirtualKeyCode: 13, nativeVirtualKeyCode: 13 }
      const dispatch = (params: Record<string, unknown>) =>
        Cypress.automation("remote:debugger:protocol", { command: "Input.dispatchKeyEvent", params })
      await dispatch({ type: "rawKeyDown", ...key })
      await dispatch({ type: "char", text: "\r", unmodifiedText: "\r" })
      await dispatch({ type: "keyUp", ...key })
    })
    cy.contains("button", "Expand dashboard").should("have.attr", "aria-expanded", "false")
    cy.get(".home-preview-main").should(($main) => {
      expect($main[0].scrollHeight).to.be.lte($main[0].clientHeight + 1)
    })
  })

  it("uses the real KPI explanation controls without contacting live data", () => {
    cy.get(".home-preview-expand").should("be.enabled")
    cy.get('.home-preview [data-kpi-label="Loans Outstanding"] [aria-label="More information"]').click()
    cy.contains("Total principal still owed across all active loans.").should("be.visible")
    cy.get("body").type("{esc}")
  })

  it("makes KPI explanations easy to tap on a narrow phone", () => {
    cy.viewport(320, 844)
    cy.get(".home-preview-expand").should("be.enabled")
    cy.get('.home-preview [aria-label="More information"]:visible').each(($trigger) => {
      const bounds = $trigger[0].getBoundingClientRect()
      expect(bounds.width, "information tap width").to.be.at.least(44)
      expect(bounds.height, "information tap height").to.be.at.least(44)
    })
    cy.get('.home-preview [aria-label="More information"]').first().click()
    cy.contains("Total principal still owed across all active loans.").should("be.visible")
    cy.get("body").type("{esc}")
  })

  it("uses only local fictional data for the preview", () => {
    const liveRequests: string[] = []
    cy.intercept("**/api/electric/**", (request) => {
      liveRequests.push(request.url)
      request.reply({ statusCode: 500, body: "Public preview must not request live data" })
    })
    cy.intercept("POST", "**/home", (request) => {
      liveRequests.push(request.url)
      request.reply({ statusCode: 500, body: "Public preview must not call server actions" })
    })
    cy.reload()
    cy.get('.home-preview [data-kpi-label="Loans Outstanding"]').should("contain", "UGX 8,750,000")
    cy.contains("button", "Expand dashboard").should("be.enabled").click()
    cy.get(".home-preview .recharts-surface").should("have.length", 2)
    cy.then(() => expect(liveRequests).to.deep.equal([]))
    cy.get(".home-preview a[href^='/loans'], .home-preview a[href^='/customers'], .home-preview a[href^='/creditors']").should("not.exist")
  })

  it("explains who can use the workspace and how access works", () => {
    cy.contains("For lending teams").should("be.visible")
    cy.contains("Already have access?").should("be.visible")
    cy.contains("Tell us about your team").should("be.visible")
  })

  it("keeps request access primary throughout the page", () => {
    cy.get('.home-nav .home-button-primary, .home-hero .home-button-primary, .home-cta .home-button-inverse')
      .should("have.length", 3)
      .each(($link) => expect($link.attr("href")).to.equal("/request-access"))
    cy.get('.home-nav-sign-in, .home-hero-note a').each(($link) => {
      expect($link.attr("href")).to.equal("/login")
      expect($link.hasClass("home-button-primary")).to.equal(false)
    })
  })

  it("keeps the main action in the opening view and introduces the dashboard", () => {
    cy.viewport(1280, 720)
    cy.get("h1").should(($heading) => expect($heading[0].getBoundingClientRect().top).to.be.at.most(180))
    cy.get('.home-hero .home-button-primary').should(($action) => expect($action[0].getBoundingClientRect().bottom).to.be.at.most(720))
    cy.get(".home-preview").should(($preview) => expect($preview[0].getBoundingClientRect().top).to.be.at.most(720))
  })

  it("introduces real product content within the tablet opening view", () => {
    cy.viewport(820, 900)
    cy.get('.home-preview [data-kpi-label="Loans Outstanding"]').should(($card) => {
      expect($card[0].getBoundingClientRect().top).to.be.lessThan(720)
    })
  })

  it("provides readable text contrast in light mode", () => {
    checkTextContrast(".home-hero-copy, .home-hero-note, .home-nav-sign-in, .home-preview-label, .home-preview-caption, .home-cta p")
    checkTextContrast(".home-nav .home-button, .home-hero-actions .home-button, .home-cta .home-button")
    checkTextContrast(".home-hero h1 em", 3)
    checkTextContrast(".home-section-intro, .home-capability p, .home-workflow-item p, .home-capabilities .home-text-link")
    checkTextContrast(".home-capability > svg", 3)
  })

  it("aligns editorial columns and keeps chapter gaps deliberate", () => {
    cy.get(".home-capabilities .home-section-intro").then(($intro) => {
      const columnStart = $intro[0].getBoundingClientRect().left
      cy.get(".home-capability p").each(($description) => {
        expect(Math.abs($description[0].getBoundingClientRect().left - columnStart)).to.be.lessThan(1)
      })
    })
    cy.get(".home-preview").then(($preview) => {
      const previewEnd = $preview[0].getBoundingClientRect().bottom
      cy.get("#home-capabilities-title").should(($title) => {
        expect($title[0].getBoundingClientRect().top - previewEnd).to.be.within(80, 160)
      })
    })
    cy.get(".home-capability").last().then(($last) => {
      const capabilitiesEnd = $last[0].getBoundingClientRect().bottom
      cy.get("#home-workflow-title").should(($title) => {
        expect($title[0].getBoundingClientRect().top - capabilitiesEnd).to.be.within(64, 120)
      })
    })
  })

  it("groups secondary hero actions together on phones", () => {
    cy.viewport(390, 844)
    cy.get('.home-hero-actions a[href="#workspace"]').then(($explore) => {
      const top = $explore[0].getBoundingClientRect().top
      cy.get('.home-hero-actions a[href="/login"]').should(($signIn) => {
        expect(Math.abs($signIn[0].getBoundingClientRect().top - top)).to.be.lessThan(2)
      })
    })
  })

  for (const width of [320, 360, 390, 820, 1024, 1440]) {
    it(`fits content and touch targets at ${width}px`, () => {
      cy.viewport(width, 900)
      cy.get("h1").should("be.visible")
      cy.get('.home-nav a[href="/login"]').should(width <= 600 ? "not.be.visible" : "be.visible")
      cy.get('.home-nav a[href="/request-access"]').should("be.visible")
      cy.get(".home-nav-sign-in:visible, .home-nav .home-button").each(($link) => {
        expect($link[0].getBoundingClientRect().width).to.be.at.least(44)
        const textNode = Array.from($link[0].childNodes).find((node) => node.nodeType === Node.TEXT_NODE && node.textContent?.trim())
        const range = $link[0].ownerDocument.createRange()
        range.selectNodeContents(textNode!)
        expect(range.getClientRects().length, "header label stays on one line").to.equal(1)
      })
      cy.get(".home-button").each(($button) => {
        expect($button[0].getBoundingClientRect().height).to.be.at.least(44)
      })
      cy.get(".home-preview").should(($preview) => {
        const bounds = $preview[0].getBoundingClientRect()
        expect(bounds.left).to.be.at.least(0)
        expect(bounds.right).to.be.at.most(width)
      })
      cy.get(".home-preview-main").should(($main) => {
        expect($main[0].scrollWidth).to.be.lte($main[0].clientWidth + 1)
      })
      cy.document().then((doc) => {
        expect(doc.documentElement.scrollWidth).to.be.lte(doc.documentElement.clientWidth + 1)
      })
      if (width === 1440 || width === 390) {
        cy.get(".home-preview-expand").should("be.enabled")
        cy.screenshot(`homepage-${width}`, {
          capture: "fullPage",
          disableTimersAndAnimations: false,
          onBeforeScreenshot: ($body) => $body.find("nextjs-portal").css("visibility", "hidden"),
          onAfterScreenshot: ($body) => $body.find("nextjs-portal").css("visibility", ""),
        })
      }
    })
  }

  it("retains legible surfaces in dark mode", () => {
    cy.window().then((win) => win.localStorage.setItem("theme", "dark"))
    cy.reload()
    cy.get("html").should("have.class", "dark")
    cy.get("h1").should("be.visible")
    cy.get(".home-page").should(($page) => {
      const styles = getComputedStyle($page[0])
      expect(styles.color).not.to.equal(styles.backgroundColor)
    })
    cy.get('.home-hero a[href="/login"]').should("be.visible")
    checkTextContrast(".home-hero-copy, .home-hero-note, .home-nav-sign-in, .home-preview-label, .home-preview-caption, .home-cta p")
    checkTextContrast(".home-nav .home-button, .home-hero-actions .home-button, .home-cta .home-button")
    checkTextContrast(".home-hero h1 em", 3)
    checkTextContrast(".home-section-intro, .home-capability p, .home-workflow-item p, .home-capabilities .home-text-link")
    checkTextContrast(".home-capability > svg", 3)
  })
})
