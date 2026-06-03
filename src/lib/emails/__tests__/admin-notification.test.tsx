import { describe, it, expect } from "vitest"
import { renderToStaticMarkup } from "react-dom/server"
import { AdminNotificationTemplate } from "@/lib/emails/admin-notification"

function render(element: React.ReactElement): string {
  return renderToStaticMarkup(element)
}

describe("AdminNotificationTemplate", () => {
  const basePayload = {
    eventLabel: "Loan disbursed",
    actorName: "Jane Officer",
    actorEmail: "jane@example.com",
    entityRef: "LOAN-ABCD1234",
    amount: "5,000,000",
    formattedTimestamp: "Wednesday, 3 June 2026 at 10:30",
    deepLink: "https://app.example.com/loans/abcd1234",
  }

  it("renders header, actor, amount, and reference", async () => {
    const html = await render(
      AdminNotificationTemplate({
        ...basePayload,
        counterpartyHeading: "Paid to",
        counterpartyLabel: "Customer",
        counterpartyName: "John Borrower",
      }),
    )
    expect(html).toContain("Kaks Credit")
    expect(html).toContain("Loan disbursed")
    expect(html).toContain("Jane Officer")
    expect(html).toContain("jane@example.com")
    expect(html).toContain("LOAN-ABCD1234")
    expect(html).toContain("5,000,000")
    expect(html).toContain("Wednesday, 3 June 2026")
  })

  it("includes a clickable deep link into the app", async () => {
    const html = await render(AdminNotificationTemplate(basePayload))
    expect(html).toContain('href="https://app.example.com/loans/abcd1234"')
    expect(html).toContain("Open in app")
  })

  it("shows the counterparty row when name is provided", async () => {
    const html = await render(
      AdminNotificationTemplate({
        ...basePayload,
        counterpartyHeading: "Paid to",
        counterpartyLabel: "Creditor",
        counterpartyName: "Acme Capital",
      }),
    )
    expect(html).toContain("Paid to")
    expect(html).toContain("Creditor: Acme Capital")
  })

  it("omits the counterparty row when name is missing (internal events)", async () => {
    const html = await render(AdminNotificationTemplate(basePayload))
    expect(html).not.toContain("Paid to")
    expect(html).not.toContain("Received from")
  })

  it("includes notes when provided", async () => {
    const html = await render(
      AdminNotificationTemplate({
        ...basePayload,
        notes: "Office rent for June",
      }),
    )
    expect(html).toContain("Office rent for June")
  })
})
