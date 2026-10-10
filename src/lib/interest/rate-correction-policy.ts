export type RateCorrectionLockReason = "payment" | "waiver" | "rollover"

export type RateCorrectionEvents = {
  paymentRecorded: boolean
  waiverRecorded: boolean
  rolledOver: boolean
  successorRecorded: boolean
}

export function rateCorrectionLockReason(
  events: RateCorrectionEvents,
): RateCorrectionLockReason | null {
  if (events.paymentRecorded) return "payment"
  if (events.waiverRecorded) return "waiver"
  if (events.rolledOver || events.successorRecorded) return "rollover"
  return null
}
