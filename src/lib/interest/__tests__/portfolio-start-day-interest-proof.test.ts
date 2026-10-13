import { describe, expect, it } from "vitest"
import { proveStartDayInterestOnlyReplay } from "../portfolio-start-day-interest-proof"

const start = new Date("2026-06-27T00:00:00.000Z")
const payment = {
  id: "b1429e9c-106a-46be-ac76-736b2c0d3775",
  paymentDate: new Date("2026-06-27T12:00:00.000Z"),
  amount: "500000.00",
  interestPortion: "500000.00",
  principalPortion: "0.00",
}

function source() {
  return {
    loanStart: start,
    asOf: new Date("2026-10-13T04:05:30.000Z"),
    paymentId: payment.id,
    payments: [payment],
    waivers: [] as Array<{ waiverDate: Date }>,
    penaltyWaivedAt: null as Date | null,
    rateEvents: [] as Array<{ effectiveDate: Date }>,
    sourceExceptions: [] as string[],
  }
}

describe("start-day interest-only accrual replay proof", () => {
  it("accepts an exactly reconciled interest-only payment twelve hours after a backdated start", () => {
    expect(proveStartDayInterestOnlyReplay(source())).toBe(true)
  })

  it("rejects a start-day payment that reduces principal", () => {
    const input = source()
    input.payments = [{ ...payment, interestPortion: "499999.99", principalPortion: "0.01" }]
    expect(proveStartDayInterestOnlyReplay(input)).toBe(false)
  })

  it("uses the exact elapsed 24-hour interval, not calendar dates", () => {
    const within = source()
    within.loanStart = new Date("2026-06-27T13:00:00.000Z")
    within.payments = [{ ...payment,
      paymentDate: new Date("2026-06-28T12:59:59.999Z") }]
    expect(proveStartDayInterestOnlyReplay(within)).toBe(true)

    for (const date of [
      "2026-06-26T23:59:59.999Z",
      "2026-06-28T00:00:00.000Z",
    ]) {
      const outside = source()
      outside.payments = [{ ...payment, paymentDate: new Date(date) }]
      expect(proveStartDayInterestOnlyReplay(outside)).toBe(false)
    }
  })

  it("requires a positive cent-exact payment entirely allocated to interest", () => {
    for (const change of [
      { amount: "500000.00", interestPortion: "499999.99" },
      { amount: "0.00", interestPortion: "0.00" },
      { amount: "-1.00", interestPortion: "-1.00" },
      { amount: "0.001", interestPortion: "0.001" },
      { amount: "not-money", interestPortion: "not-money" },
    ]) {
      const input = source()
      input.payments = [{ ...payment, ...change }]
      expect(proveStartDayInterestOnlyReplay(input)).toBe(false)
    }
  })

  it("rejects another payment, waiver, or rate event in the same elapsed-day interval", () => {
    const duplicate = source()
    duplicate.payments = [payment, { ...payment, id: "other-payment" }]
    expect(proveStartDayInterestOnlyReplay(duplicate)).toBe(false)

    const waived = source()
    waived.waivers = [{ waiverDate: start }]
    expect(proveStartDayInterestOnlyReplay(waived)).toBe(false)

    const changedRate = source()
    changedRate.rateEvents = [{ effectiveDate: new Date("2026-06-27T18:00:00.000Z") }]
    expect(proveStartDayInterestOnlyReplay(changedRate)).toBe(false)
  })

  it("does not certify replay while snapshot cash, journal, or audit reconciliation has an exception", () => {
    const input = source()
    input.sourceExceptions = ["Payment Cash journal does not match amount and effective date"]
    expect(proveStartDayInterestOnlyReplay(input)).toBe(false)
  })

  it("fails closed on invalid dates anywhere in the proposed event timeline", () => {
    const badOtherPayment = source()
    badOtherPayment.payments = [payment, { ...payment, id: "other-payment",
      paymentDate: new Date(Number.NaN) }]
    expect(proveStartDayInterestOnlyReplay(badOtherPayment)).toBe(false)

    const badWaiver = source()
    badWaiver.waivers = [{ waiverDate: new Date(Number.NaN) }]
    expect(proveStartDayInterestOnlyReplay(badWaiver)).toBe(false)

    const badRate = source()
    badRate.rateEvents = [{ effectiveDate: new Date(Number.NaN) }]
    expect(proveStartDayInterestOnlyReplay(badRate)).toBe(false)
  })

  it("requires exactly one target payment identity in the reconciled timeline", () => {
    const duplicated = source()
    duplicated.payments = [payment, { ...payment,
      paymentDate: new Date("2026-07-03T12:00:00.000Z") }]
    expect(proveStartDayInterestOnlyReplay(duplicated)).toBe(false)

    const missing = source()
    missing.paymentId = "unknown-payment"
    expect(proveStartDayInterestOnlyReplay(missing)).toBe(false)

    const emptyIdentity = source()
    emptyIdentity.paymentId = ""
    emptyIdentity.payments = [{ ...payment, id: "" }]
    expect(proveStartDayInterestOnlyReplay(emptyIdentity)).toBe(false)
  })

  it("rejects a loan-level penalty waiver effective within the start-day interval", () => {
    const input = source()
    input.penaltyWaivedAt = new Date("2026-06-27T18:00:00.000Z")
    expect(proveStartDayInterestOnlyReplay(input)).toBe(false)
  })

  it("does not reject later principal payments, waivers, or rate events", () => {
    const input = source()
    input.payments = [payment, {
      id: "later-payment", paymentDate: new Date("2026-07-09T12:00:00.000Z"),
      amount: "750000.00", interestPortion: "670000.00", principalPortion: "80000.00",
    }]
    input.waivers = [{ waiverDate: new Date("2026-07-10T00:00:00.000Z") }]
    input.rateEvents = [{ effectiveDate: new Date("2026-06-28T00:00:00.000Z") }]
    expect(proveStartDayInterestOnlyReplay(input)).toBe(true)
  })
})
