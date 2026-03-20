import { describe, it } from "vitest"

describe("Interest Engine", () => {
  it.todo("calculates correct interest for 30-day period (LOAN-03)")
  it.todo("enforces minimum 30-day interest period (LOAN-10)")
  it.todo("uses BigNumber for all arithmetic -- no native float (LOAN-04)")
  it.todo("supports custom minimum period override (LOAN-11)")
  it.todo("calculates days overdue from unpaid interest and daily rate (RISK-01)")
})
