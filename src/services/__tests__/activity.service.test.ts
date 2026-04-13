import { describe, it, expect } from "vitest"
import { formatActivityDescription, getActivityHref } from "../activity.service"

describe("formatActivityDescription", () => {
  it("formats loan.create with customer name and amount", () => {
    const result = formatActivityDescription("loan.create", "loan", null, {
      principalAmount: "500000",
      customerId: "c1",
    }, new Map([["c1", "John Mukasa"]]))
    expect(result).toBe("Loan issued to John Mukasa — UGX 500,000")
  })

  it("formats loan.create without customer name", () => {
    const result = formatActivityDescription("loan.create", "loan", null, {
      principalAmount: "500000",
      customerId: "c1",
    }, new Map())
    expect(result).toBe("Loan issued — UGX 500,000")
  })

  it("formats payment.create with amount", () => {
    const result = formatActivityDescription("payment.create", "payment", null, {
      amount: "50000",
    }, new Map())
    expect(result).toBe("Payment received — UGX 50,000")
  })

  it("formats customer.create with full name", () => {
    const result = formatActivityDescription("customer.create", "customer", null, {
      fullName: "Grace Atim",
    }, new Map())
    expect(result).toBe("Customer Grace Atim created")
  })

  it("formats customer.update with full name", () => {
    const result = formatActivityDescription("customer.update", "customer", null, {
      fullName: "Grace Atim",
    }, new Map())
    expect(result).toBe("Customer Grace Atim updated")
  })

  it("formats creditor.create with name", () => {
    const result = formatActivityDescription("creditor.create", "creditor", null, {
      name: "ABC Finance",
    }, new Map())
    expect(result).toBe("Creditor ABC Finance added")
  })

  it("formats fund_transfer.create with amount", () => {
    const result = formatActivityDescription("fund_transfer.create", "fund_transfer", null, {
      amount: "1000000",
    }, new Map())
    expect(result).toBe("Fund transfer — UGX 1,000,000")
  })

  it("formats loan.rollover with carried amount", () => {
    const result = formatActivityDescription("loan.rollover", "loan", {
      customerId: "c1",
    }, {
      carriedPrincipal: "400000",
      carriedInterest: "100000",
    }, new Map([["c1", "John Mukasa"]]))
    expect(result).toBe("Loan rolled over for John Mukasa — UGX 500,000")
  })

  it("formats loan.disburse", () => {
    const result = formatActivityDescription("loan.disburse", "loan", null, {}, new Map())
    expect(result).toBe("Loan disbursed")
  })

  it("formats loan.settle_with_collateral", () => {
    const result = formatActivityDescription("loan.settle_with_collateral", "loan", null, {}, new Map())
    expect(result).toBe("Loan settled with collateral")
  })

  it("formats loan.rate_change.approved", () => {
    const result = formatActivityDescription("loan.rate_change.approved", "loan", null, {}, new Map())
    expect(result).toBe("Loan rate change approved")
  })

  it("formats loan.rate_change.rejected", () => {
    const result = formatActivityDescription("loan.rate_change.rejected", "loan", null, {}, new Map())
    expect(result).toBe("Loan rate change rejected")
  })

  it("formats loan.rate_change.immediate", () => {
    const result = formatActivityDescription("loan.rate_change.immediate", "loan", null, {}, new Map())
    expect(result).toBe("Loan rate changed")
  })

  it("formats payment.delete", () => {
    const result = formatActivityDescription("payment.delete", "payment", null, {}, new Map())
    expect(result).toBe("Payment deleted")
  })

  it("formats payment.update", () => {
    const result = formatActivityDescription("payment.update", "payment", null, {}, new Map())
    expect(result).toBe("Payment updated")
  })

  it("formats loan.update", () => {
    const result = formatActivityDescription("loan.update", "loan", null, {}, new Map())
    expect(result).toBe("Loan details updated")
  })

  it("formats loan.delete", () => {
    const result = formatActivityDescription("loan.delete", "loan", null, {}, new Map())
    expect(result).toBe("Loan deleted")
  })

  it("falls back to entityType + action for unknown actions", () => {
    const result = formatActivityDescription("some.unknown", "widget", null, {}, new Map())
    expect(result).toBe("widget some.unknown")
  })
})

describe("getActivityHref", () => {
  it("returns loan detail path", () => {
    expect(getActivityHref("loan", "loan-123", null)).toBe("/loans/loan-123")
  })

  it("returns loan path for payment with loanId in afterValue", () => {
    expect(getActivityHref("payment", "pay-1", { loanId: "loan-456" })).toBe("/loans/loan-456")
  })

  it("returns null for payment without loanId", () => {
    expect(getActivityHref("payment", "pay-1", null)).toBeNull()
  })

  it("returns customer detail path", () => {
    expect(getActivityHref("customer", "cust-1", null)).toBe("/customers/cust-1")
  })

  it("returns creditor detail path", () => {
    expect(getActivityHref("creditor", "cred-1", null)).toBe("/creditors/cred-1")
  })

  it("returns null for unknown entity types", () => {
    expect(getActivityHref("transaction", "tx-1", null)).toBeNull()
  })
})
