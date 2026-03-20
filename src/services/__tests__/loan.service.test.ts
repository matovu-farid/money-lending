import { describe, it } from "vitest"

describe("Loan Service", () => {
  it.todo("creates loan with collateral in single transaction (LOAN-01, CUST-03)")
  it.todo("writes audit log in same transaction as loan creation (INFR-01)")
  it.todo("blocks loan if customer details incomplete (CUST-04)")
  it.todo("stores principal as string, not float (INFR-05)")
})
