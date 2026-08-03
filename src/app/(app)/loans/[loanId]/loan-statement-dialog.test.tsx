// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest"
import { render, screen } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"
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

const statement = {
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
    netUnpaidInterest: "6125793",
    totalDue: "10975634",
    daysOverdue: 378,
    penaltyActive: true,
  },
} as any

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
})
