import { describe, it } from "vitest"

describe("Interest Engine - calculateDaysOverdue", () => {
  it.todo("returns 0 when interest is fully paid")
  it.todo("returns positive days when interest is unpaid")
  it.todo("handles zero daily rate gracefully")
})

describe("Interest Engine - allocatePayment", () => {
  it.todo("allocates interest first then principal")
  it.todo("marks loan as fully paid when balance reaches zero")
  it.todo("handles minimum interest days correctly")
})
