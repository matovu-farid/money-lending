import { describe, it, expect } from "vitest"
import {
  customerStatusVariant,
  customerStatusLabel,
  loanStatusVariant,
  loanStatusLabel,
  approvalStatusBadgeVariant,
} from "../status"

describe("customerStatusVariant", () => {
  it("returns correct variants for all known statuses", () => {
    expect(customerStatusVariant("active")).toBe("default")
    expect(customerStatusVariant("blacklisted")).toBe("destructive")
    expect(customerStatusVariant("inactive")).toBe("secondary")
  })

  it("returns 'secondary' for unknown status", () => {
    expect(customerStatusVariant("unknown")).toBe("secondary")
  })
})

describe("customerStatusLabel", () => {
  it("returns correct labels for all known statuses", () => {
    expect(customerStatusLabel("active")).toBe("Active")
    expect(customerStatusLabel("blacklisted")).toBe("Blacklisted")
    expect(customerStatusLabel("inactive")).toBe("Inactive")
  })

  it("returns 'Inactive' for unknown status", () => {
    expect(customerStatusLabel("unknown")).toBe("Inactive")
  })
})

describe("loanStatusVariant", () => {
  it("returns correct variants for all known statuses", () => {
    expect(loanStatusVariant("active")).toBe("default")
    expect(loanStatusVariant("pending")).toBe("outline")
    expect(loanStatusVariant("fully_paid")).toBe("outline")
    expect(loanStatusVariant("settled_with_collateral")).toBe("outline")
    expect(loanStatusVariant("rolled_over")).toBe("outline")
  })

  it("returns 'outline' for unknown status", () => {
    expect(loanStatusVariant("unknown")).toBe("outline")
  })
})

describe("loanStatusLabel", () => {
  it("returns correct labels for all known statuses", () => {
    expect(loanStatusLabel("active")).toBe("Active")
    expect(loanStatusLabel("pending")).toBe("Pending")
    expect(loanStatusLabel("fully_paid")).toBe("Fully Paid")
    expect(loanStatusLabel("settled_with_collateral")).toBe("Settled (Collateral)")
    expect(loanStatusLabel("rolled_over")).toBe("Rolled Over")
  })

  it("capitalizes unknown status", () => {
    expect(loanStatusLabel("defaulted")).toBe("Defaulted")
    expect(loanStatusLabel("custom")).toBe("Custom")
  })
})

describe("approvalStatusBadgeVariant", () => {
  it("returns correct variants for all known statuses", () => {
    expect(approvalStatusBadgeVariant("pending")).toBe("default")
    expect(approvalStatusBadgeVariant("approved")).toBe("secondary")
    expect(approvalStatusBadgeVariant("rejected")).toBe("destructive")
  })

  it("returns 'outline' for unknown status", () => {
    expect(approvalStatusBadgeVariant("unknown")).toBe("outline")
  })
})
