import { describe, expect, it } from "vitest"
import { renderToStaticMarkup } from "react-dom/server"
import { DashboardOverview } from "./dashboard-overview"
import { previewKpis, previewActivity } from "@/app/home/dashboard-preview-data"

function render({ isAdmin = true, readOnly = false, activityReady = true, empty = false } = {}) {
  return renderToStaticMarkup(
    <DashboardOverview kpis={previewKpis} isAdmin={isAdmin} has={() => true}
      activity={empty ? [] : previewActivity} activityReady={activityReady}
      charts={<div>Example chart content</div>} readOnly={readOnly}
      headingAs={readOnly ? "h2" : "h1"} formatActivityTime={() => "10 minutes ago"} />,
  )
}

describe("Shared dashboard presentation", () => {
  it("keeps the authenticated admin dashboard's six metrics and action destinations", () => {
    const html = render()
    expect(html.match(/data-testid="kpi-card"/g)).toHaveLength(6)
    for (const label of ["Loans Outstanding", "Active Borrowers", "Overdue Count", "Repayments Collected", "Interest Earned", "Cash Available"]) expect(html).toContain(label)
    for (const href of ["/payments", "/customers/new", "/loans/new", "/loans?filter=overdue", "/activities"]) expect(html).toContain(`href="${href.replace("&", "&amp;")}"`)
    expect(html).toContain("Example chart content")
  })

  it("preserves the real non-admin dashboard's restricted financial presentation", () => {
    const html = render({ isAdmin: false })
    expect(html.match(/data-testid="kpi-card"/g)).toHaveLength(3)
    for (const label of ["Repayments Collected", "Interest Earned", "Cash Available", "Example chart content"]) expect(html).not.toContain(label)
    expect(html).toContain("Recent Activity")
  })

  it("renders identical metric values for a read-only public example with no private route links", () => {
    const html = render({ readOnly: true })
    expect(html.match(/data-testid="kpi-card"/g)).toHaveLength(6)
    expect(html).toContain("UGX 8,750,000")
    expect(html).toContain("Example Borrower A")
    expect(html).not.toContain("href=")
    expect(html).not.toContain("<h1")
    expect(html).toContain("<h2")
  })

  it("preserves loading and empty activity states", () => {
    expect(render({ activityReady: false })).not.toContain("Example Borrower A")
    expect(render({ empty: true })).toContain("No recent activity")
  })
})
