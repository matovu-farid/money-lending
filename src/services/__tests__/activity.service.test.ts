import { describe, it, expect, vi } from "vitest"
import { Effect } from "effect"
import { PgDialect } from "drizzle-orm/pg-core"
import { formatActivityDescription, getActivityHref, getActivities } from "../activity.service"

const { mockSelect } = vi.hoisted(() => ({ mockSelect: vi.fn() }))
vi.mock("@/lib/db", () => ({ db: { select: mockSelect } }))

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

  it("formats loan.rate_change.admin_adjusted", () => {
    const result = formatActivityDescription("loan.rate_change.admin_adjusted", "loan", null, {}, new Map())
    expect(result).toBe("Loan rate changed")
  })

  it("formats an agent's historical rate correction", () => {
    expect(formatActivityDescription(
      "historical_rate_corrected_by_agent", "loan", null, {}, new Map(),
    )).toBe("Historical loan rate corrected by agent")
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

describe("getActivities", () => {
  it.each([
    {
      action: "historical_rate_corrected_by_agent",
      afterValue: { interestRateOverride: "0.08", executorAgentId: "agent:executor-1" },
      description: "Historical loan rate corrected by agent",
    },
    {
      action: "loan.rollover.correction",
      afterValue: { principalAmount: "1200000", runId: "run-1", reviewerAgentId: "agent:reviewer-1", executorAgentId: "agent:executor-1" },
      description: "Loan rollover corrected by agent",
    },
  ])("counts and displays a null-actor $action event with its executor identity", async ({ action, afterValue, description }) => {
    const joins: string[] = []
    const wheres: string[] = []
    const whereParams: unknown[][] = []
    mockSelect.mockImplementation(() => ({
      from: () => ({
        innerJoin: () => { joins.push("inner"); return query() },
        leftJoin: () => { joins.push("left"); return query() },
      }),
    }))
    function query() {
      return {
        where: (condition: Parameters<PgDialect["sqlToQuery"]>[0]) => {
          const query = new PgDialect().sqlToQuery(condition)
          wheres.push(query.sql)
          whereParams.push(query.params)
          return {
            then: (resolve: (rows: { count: number }[]) => unknown) => Promise.resolve([{ count: 1 }]).then(resolve),
            orderBy: () => ({ limit: () => ({ offset: () => Promise.resolve([{
              id: "audit-1", actorId: null, actorName: null, actorRole: null,
              action, entityType: "loan", entityId: "loan-1",
              beforeValue: JSON.stringify({ interestRate: "0.10" }),
              afterValue: JSON.stringify(afterValue),
              occurredAt: new Date("2026-10-11T10:00:00.000Z"),
            }]) }) }),
          }
        },
      }
    }

    const result = await Effect.runPromise(getActivities({ viewerRole: "admin", page: 1, pageSize: 20 }))

    expect(joins).toEqual(["left", "left"])
    expect(wheres).toHaveLength(2)
    expect(wheres[0]).toBe(wheres[1])
    expect(wheres[0]).toContain("actor_id")
    expect(whereParams[0]).toContain("historical_rate_corrected_by_agent")
    expect(whereParams[0]).toContain("loan.rollover.correction")
    expect(whereParams[0]).toContain("loan")
    expect(result.total).toBe(1)
    expect(result.items).toEqual([expect.objectContaining({
      actorName: "agent:executor-1", actorRole: "agent",
      description, href: "/loans/loan-1",
    })])
  })
})

describe("getActivityHref", () => {
  it("returns loan detail path", () => {
    expect(getActivityHref("loan", "loan-123", null)).toBe("/loans/loan-123")
  })

  it("prefers successor for loan.rollover", () => {
    expect(
      getActivityHref(
        "loan",
        "old-loan",
        { rolledIntoLoanId: "new-loan" },
        "loan.rollover",
      ),
    ).toBe("/loans/new-loan")
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
