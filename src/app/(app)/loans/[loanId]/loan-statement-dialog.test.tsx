// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest"
import { render, screen } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"
import type { LoanStatement } from "@/lib/loan-statement"
import { LoanStatementDialog } from "./loan-statement-dialog"

vi.mock("@/components/ui/drawer-dialog", () => ({
  DrawerDialog: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  DrawerDialogContent: ({ children, className, ...props }: { children: React.ReactNode; className?: string }) => (
    <div className={className} {...props}>{children}</div>
  ),
}))

vi.mock("@/components/ui/dialog", () => ({
  DialogHeader: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  DialogTitle: ({ children }: { children: React.ReactNode }) => <h2>{children}</h2>,
}))

const statement: LoanStatement = {
  loanId: "loan-1",
  generatedAt: new Date("2026-08-03T00:00:00Z"),
  startDate: new Date("2025-01-22T00:00:00Z"),
  today: new Date("2026-08-03T00:00:00Z"),
  daysSinceStart: 558,
  terms: {
    principal: "6000000",
    baseRate: "0.10",
    penaltyMultiplier: "0.1000",
    effectiveRate: "0.1100",
    penaltyThresholdDays: 60,
    minInterestDays: 30,
    loanType: "perpetual",
    issuanceFee: "50000",
    backdated: true,
  },
  events: [],
  cycles: [],
  finalState: {
    principalBalance: "4849841",
    cumulativeInterestAccrued: "11275634",
    cumulativeInterestPaid: "5149841",
    cumulativeInterestWaived: "0",
    netAccruedUnpaidInterest: "6125793",
    minimumInterestAdjustment: "0",
    netUnpaidInterest: "6125793",
    totalDue: "10975634",
    daysOverdue: 378,
    penaltyActive: true,
  },
}

describe("LoanStatementDialog print layout", () => {
  it("removes the fixed viewport and overflow constraints for printing", () => {
    render(
      <LoanStatementDialog
        open
        onOpenChange={vi.fn()}
        statement={statement}
        customerName="Mbuga Wilber"
        loanRef="LOAN-BD0138FB"
      />,
    )

    const content = screen.getByTestId("loan-statement-dialog-content")
    expect(content).toHaveClass("loan-statement-dialog-content")
    expect(content).toHaveClass("print:static")
    expect(content).toHaveClass("print:overflow-visible")
    expect(content).toHaveClass("print:max-h-none")
  })

  it("identifies rollover interest as capitalized principal rather than a payment", () => {
    render(
      <LoanStatementDialog
        open
        onOpenChange={vi.fn()}
        statement={{
          ...statement,
          events: [{ kind: "rollover_settled", day: 0, date: statement.startDate, amount: "308500" }],
          finalState: { ...statement.finalState, cumulativeInterestPaid: "0" },
        }}
        customerName="Rollover Borrower"
        loanRef="LOAN-ROLLOVER"
      />,
    )

    expect(screen.getByText("Interest Capitalized at Rollover")).toBeInTheDocument()
    expect(screen.getByText(/included in the opening principal; no cash payment/)).toBeInTheDocument()
    expect(screen.getByText("Cumulative Interest Paid").parentElement).toHaveTextContent("UGX 0")
  })

  it("labels an unreconciled predecessor receivable without claiming the loan is settled", () => {
    render(
      <LoanStatementDialog
        open
        onOpenChange={vi.fn()}
        statement={{
          ...statement,
          closingTransfer: "1000000",
          closingReceivable: "500000",
          finalState: { ...statement.finalState, totalDue: "10975634" },
        }}
        customerName="Rollover Borrower"
        loanRef="LOAN-PENDING"
      />,
    )

    expect(screen.getByText("Unresolved Receivable on This Loan").parentElement)
      .toHaveTextContent("UGX 500,000")
    expect(screen.getByText("Calculated Due at Transfer")).toBeInTheDocument()
    expect(screen.queryByText("Still Collectible on This Loan")).not.toBeInTheDocument()
  })
})
