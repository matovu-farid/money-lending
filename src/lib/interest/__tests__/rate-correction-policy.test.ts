import { describe, expect, it } from "vitest"
import { rateCorrectionLockReason } from "../rate-correction-policy"

const eligible = {
  paymentRecorded: false,
  waiverRecorded: false,
  rolledOver: false,
  successorRecorded: false,
}

describe("rateCorrectionLockReason", () => {
  it("permits a loan with no crystallizing event", () => {
    expect(rateCorrectionLockReason(eligible)).toBeNull()
  })

  it("locks after any payment was recorded, regardless of its later status", () => {
    expect(rateCorrectionLockReason({ ...eligible, paymentRecorded: true })).toBe("payment")
  })

  it("locks after any waiver was recorded, even if it was undone", () => {
    expect(rateCorrectionLockReason({ ...eligible, waiverRecorded: true })).toBe("waiver")
  })

  it("locks a rolled-over predecessor", () => {
    expect(rateCorrectionLockReason({ ...eligible, rolledOver: true })).toBe("rollover")
    expect(rateCorrectionLockReason({ ...eligible, successorRecorded: true })).toBe("rollover")
  })

  it("does not lock a successor merely because it was created from a predecessor", () => {
    expect(rateCorrectionLockReason(eligible)).toBeNull()
  })
})
