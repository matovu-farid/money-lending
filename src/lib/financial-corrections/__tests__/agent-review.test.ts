import { describe, expect, it } from "vitest"
import { assertMatchingPassingAgentReview, hashReviewEvidence } from "../agent-review"

const identity = {
  kind: "portfolio_accrual",
  subjectId: "loan-123",
  planHash: "a".repeat(64),
  inputFingerprint: "b".repeat(64),
  policyVersion: "v1",
}

function review(overrides: Record<string, unknown> = {}) {
  const evidenceJson = JSON.stringify({ checkpoints: [{ date: "2026-10-01", expected: "100.00" }] })
  return {
    ...identity,
    reviewerAgentId: "agent:reviewer-1",
    reviewRunId: "review-run-1",
    evidenceJson,
    evidenceSha256: hashReviewEvidence(JSON.parse(evidenceJson)),
    verdict: "pass",
    findingsJson: JSON.stringify({ checks: ["source", "checkpoint", "journal"], issues: [] }),
    ...overrides,
  }
}

describe("financial correction agent review contract", () => {
  it("hashes equivalent evidence independently of object key order", () => {
    expect(hashReviewEvidence({ b: 2, a: { y: 3, x: 1 } }))
      .toBe(hashReviewEvidence({ a: { x: 1, y: 3 }, b: 2 }))
  })

  it("accepts only a passing exact review by a distinct agent", () => {
    expect(() => assertMatchingPassingAgentReview(review(), identity, "agent:executor-1"))
      .not.toThrow()
  })

  it.each([
    [{ planHash: "c".repeat(64) }, /plan/i],
    [{ inputFingerprint: "c".repeat(64) }, /fingerprint/i],
    [{ policyVersion: "v2" }, /policy/i],
    [{ subjectId: "other-loan" }, /subject/i],
    [{ kind: "historical_rate" }, /kind/i],
    [{ verdict: "fail" }, /pass/i],
    [{ reviewerAgentId: "" }, /reviewer/i],
    [{ reviewRunId: "" }, /run/i],
    [{ findingsJson: JSON.stringify({ checks: [], issues: ["mismatch"] }) }, /issue/i],
    [{ evidenceSha256: "c".repeat(64) }, /evidence/i],
  ] as const)("rejects a mismatched or failed review %#", (change, error) => {
    expect(() => assertMatchingPassingAgentReview(review(change), identity, "agent:executor-1"))
      .toThrow(error)
  })

  it("refuses self-review and human-looking executor identifiers", () => {
    expect(() => assertMatchingPassingAgentReview(review(), identity, "agent:reviewer-1"))
      .toThrow(/distinct/i)
    expect(() => assertMatchingPassingAgentReview(review(), identity, "admin-1"))
      .toThrow(/agent/i)
  })

  it("refuses a review already consumed by another run", () => {
    expect(() => assertMatchingPassingAgentReview(review({
      consumedAt: new Date("2026-10-11T00:00:00.000Z"),
      consumedByRunId: "prior-run",
    }), identity, "agent:executor-1")).toThrow(/consumed/i)
  })
})
