import { describe, it, expect } from "vitest"
import { queryKeys } from "../query-keys"

describe("queryKeys", () => {
  describe("dashboard", () => {
    it("all is the root tuple", () => {
      expect(queryKeys.dashboard.all).toEqual(["dashboard"])
    })

    it("kpis extends all with 'kpis'", () => {
      const key = queryKeys.dashboard.kpis()
      expect(key).toEqual(["dashboard", "kpis"])
      expect(key.slice(0, 1)).toEqual(queryKeys.dashboard.all)
    })

    it("activity extends all with 'activity'", () => {
      const key = queryKeys.dashboard.activity()
      expect(key).toEqual(["dashboard", "activity"])
    })
  })

  describe("customers", () => {
    it("all is the root tuple", () => {
      expect(queryKeys.customers.all).toEqual(["customers"])
    })

    it("detail includes customer id", () => {
      expect(queryKeys.customers.detail("c-1")).toEqual(["customers", "c-1"])
    })

    it("search includes params and page", () => {
      const params = { name: "John" }
      const key = queryKeys.customers.search(params, 2)
      expect(key).toEqual(["customers", { name: "John" }, 2])
      // Hierarchical: starts with all prefix
      expect(key[0]).toBe("customers")
    })

    it("recent extends all with 'recent'", () => {
      expect(queryKeys.customers.recent()).toEqual(["customers", "recent"])
    })

    it("different params produce different keys", () => {
      const a = queryKeys.customers.search({ name: "A" }, 1)
      const b = queryKeys.customers.search({ name: "B" }, 1)
      expect(a).not.toEqual(b)
    })

    it("different pages produce different keys", () => {
      const params = { name: "A" }
      const a = queryKeys.customers.search(params, 1)
      const b = queryKeys.customers.search(params, 2)
      expect(a).not.toEqual(b)
    })
  })

  describe("loans", () => {
    it("all is the root tuple", () => {
      expect(queryKeys.loans.all).toEqual(["loans"])
    })

    it("detail includes loan id", () => {
      expect(queryKeys.loans.detail("l-1")).toEqual(["loans", "l-1"])
    })

    it("balance extends detail with 'balance'", () => {
      const key = queryKeys.loans.balance("l-1")
      expect(key).toEqual(["loans", "l-1", "balance"])
      // Contains the detail prefix
      expect(key.slice(0, 2)).toEqual(queryKeys.loans.detail("l-1"))
    })

    it("paymentContext extends detail with 'paymentContext'", () => {
      expect(queryKeys.loans.paymentContext("l-1")).toEqual([
        "loans",
        "l-1",
        "paymentContext",
      ])
    })

    it("byCustomer includes customer id", () => {
      expect(queryKeys.loans.byCustomer("c-1")).toEqual([
        "loans",
        "byCustomer",
        "c-1",
      ])
    })

    it("searchActive includes the query string", () => {
      expect(queryKeys.loans.searchActive("foo")).toEqual([
        "loans",
        "searchActive",
        "foo",
      ])
    })
  })

  describe("dailyCollections", () => {
    it("all is the root tuple", () => {
      expect(queryKeys.dailyCollections.all).toEqual(["daily-collections"])
    })

    it("byDate includes the date", () => {
      expect(queryKeys.dailyCollections.byDate("2026-01-01")).toEqual([
        "daily-collections",
        "2026-01-01",
      ])
    })
  })

  describe("loansDueToday", () => {
    it("all is the root tuple", () => {
      expect(queryKeys.loansDueToday.all).toEqual(["loans-due-today"])
    })
  })

  describe("payments", () => {
    it("all is the root tuple", () => {
      expect(queryKeys.payments.all).toEqual(["payments"])
    })

    it("list includes params and page", () => {
      const params = { dateFrom: "2026-01-01" }
      expect(queryKeys.payments.list(params, 1)).toEqual([
        "payments",
        { dateFrom: "2026-01-01" },
        1,
      ])
    })

    it("detail includes payment id", () => {
      expect(queryKeys.payments.detail("p-1")).toEqual(["payments", "p-1"])
    })

    it("byLoan includes loan id", () => {
      expect(queryKeys.payments.byLoan("l-1")).toEqual([
        "payments",
        "byLoan",
        "l-1",
      ])
    })

    it("portions includes loan id", () => {
      expect(queryKeys.payments.portions("l-1")).toEqual([
        "payments",
        "portions",
        "l-1",
      ])
    })
  })

  describe("adminUsers", () => {
    it("all is the root tuple", () => {
      expect(queryKeys.adminUsers.all).toEqual(["admin-users"])
    })

    it("list extends all with 'list'", () => {
      expect(queryKeys.adminUsers.list()).toEqual(["admin-users", "list"])
    })
  })

  describe("recentLoans", () => {
    it("all is the root tuple", () => {
      expect(queryKeys.recentLoans.all).toEqual(["recent-loans"])
    })

    it("list extends all with 'list'", () => {
      expect(queryKeys.recentLoans.list()).toEqual(["recent-loans", "list"])
    })
  })

  describe("income", () => {
    it("all is the root tuple", () => {
      expect(queryKeys.income.all).toEqual(["income"])
    })

    it("list includes params and page", () => {
      const params = { year: 2026 }
      expect(queryKeys.income.list(params, 3)).toEqual([
        "income",
        { year: 2026 },
        3,
      ])
    })
  })

  describe("expenses", () => {
    it("all is the root tuple", () => {
      expect(queryKeys.expenses.all).toEqual(["expenses"])
    })

    it("list includes params and page", () => {
      expect(queryKeys.expenses.list({}, 1)).toEqual(["expenses", {}, 1])
    })

    it("categories extends all", () => {
      expect(queryKeys.expenses.categories()).toEqual([
        "expenses",
        "categories",
      ])
    })
  })

  describe("creditors", () => {
    it("all is the root tuple", () => {
      expect(queryKeys.creditors.all).toEqual(["creditors"])
    })

    it("detail includes creditor id", () => {
      expect(queryKeys.creditors.detail("cr-1")).toEqual(["creditors", "cr-1"])
    })

    it("capital extends all", () => {
      expect(queryKeys.creditors.capital()).toEqual(["creditors", "capital"])
    })
  })

  describe("rateChangeRequests", () => {
    it("all is the root tuple", () => {
      expect(queryKeys.rateChangeRequests.all).toEqual([
        "rate-change-requests",
      ])
    })

    it("pending extends all", () => {
      expect(queryKeys.rateChangeRequests.pending()).toEqual([
        "rate-change-requests",
        "pending",
      ])
    })

    it("byLoan includes loan id", () => {
      expect(queryKeys.rateChangeRequests.byLoan("l-1")).toEqual([
        "rate-change-requests",
        "byLoan",
        "l-1",
      ])
    })

    it("pendingCount extends all", () => {
      expect(queryKeys.rateChangeRequests.pendingCount()).toEqual([
        "rate-change-requests",
        "pending-count",
      ])
    })
  })

  describe("fundTransfers", () => {
    it("all is the root tuple", () => {
      expect(queryKeys.fundTransfers.all).toEqual(["fund-transfers"])
    })
  })

  describe("hierarchical key invariants", () => {
    it("all child keys start with the parent all prefix", () => {
      // Loans hierarchy: all > detail > balance/paymentContext
      const detail = queryKeys.loans.detail("x")
      const balance = queryKeys.loans.balance("x")
      const ctx = queryKeys.loans.paymentContext("x")
      expect(balance.slice(0, detail.length)).toEqual(detail)
      expect(ctx.slice(0, detail.length)).toEqual(detail)
    })

    it("keys are arrays (as const enforces readonly at type level)", () => {
      const key = queryKeys.dashboard.kpis()
      expect(Array.isArray(key)).toBe(true)
      // as const makes tuples readonly at the TypeScript level;
      // at runtime they are still plain arrays (not frozen).
      expect(key.length).toBeGreaterThan(0)
    })
  })
})
