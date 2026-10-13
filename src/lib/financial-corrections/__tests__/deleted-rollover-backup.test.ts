import { describe, expect, it } from "vitest"
import { validDeletedRolloverRestoreProof } from "../deleted-rollover-backup"

const now = Date.parse("2026-10-13T10:00:00.000Z")
const expected = {
  dumpSha256: "a".repeat(64), sourceHost: "production.example",
  sourceDatabase: "neondb", predecessorId: "13acf40f-e93a-406e-8895-b0b465520e4d",
  successorId: "ffabf86d-5f8e-4051-8678-5b83d72107df",
  planHash: "b".repeat(64), inputFingerprint: "c".repeat(64),
  reviewEvidenceSha256: "d".repeat(64),
  amount: "3636606.34", effectiveDate: "2025-02-21T00:00:00.000Z",
  sourceGroupId: "1dd6afad-e61c-48eb-81c6-d770d117d9be",
}
const proof = {
  ...expected, restoredAt: new Date(now - 60_000).toISOString(),
  restoredDatabase: `money_lending_rehearsal_deleted_${expected.dumpSha256.slice(0, 12)}`,
  reviewVerdict: "pass", reviewId: "aeda3af4-2dbf-41c7-abdd-5c294c11c1c2",
  runId: "aeda3af4-2dbf-41c7-abdd-5c294c11c1c3", applied: true,
  journalGroupId: "aeda3af4-2dbf-41c7-abdd-5c294c11c1c5",
  reconciled: true, cashUnchanged: true, paymentsUnchanged: true,
  snapshotsUnchanged: true,
  originalJournalsUnchanged: true, journalGroupsBalanced: true,
  nonCashCorrection: true,
}

describe("deleted rollover restore proof", () => {
  it("accepts only an exact recent isolated restoration", () => {
    expect(validDeletedRolloverRestoreProof(proof, expected, now)).toBe(true)
    for (const changed of [
      { planHash: "e".repeat(64) }, { restoredDatabase: "neondb" },
      { cashUnchanged: false }, { reviewVerdict: "fail" },
      { restoredAt: new Date(now - 25 * 60 * 60 * 1000).toISOString() },
    ]) {
      expect(validDeletedRolloverRestoreProof({ ...proof, ...changed }, expected, now))
        .toBe(false)
    }
  })
})
