import { describe, expect, it } from "vitest";
import { assertHistoricalRestoreProofMatchesPlan } from
  "../historical-rate-repair-apply.service";

const plan = {
  loanId: "11111111-1111-4111-8111-111111111111",
  planHash: "a".repeat(64), inputFingerprint: "b".repeat(64),
  policyVersion: "v2", asOf: new Date("2026-10-10T20:59:59.999Z"),
};

describe("historical production restore proof binding", () => {
  it("accepts only the exact reviewed plan identity", () => {
    const proof = { targetLoanId: plan.loanId, planHash: plan.planHash,
      inputFingerprint: plan.inputFingerprint, policyVersion: plan.policyVersion,
      asOf: plan.asOf.toISOString() };
    expect(() => assertHistoricalRestoreProofMatchesPlan(proof, plan)).not.toThrow();
    for (const changed of [
      { targetLoanId: "22222222-2222-4222-8222-222222222222" },
      { planHash: "c".repeat(64) },
      { inputFingerprint: "c".repeat(64) },
      { policyVersion: "v1" },
      { asOf: "2026-10-10T20:59:59.998Z" },
    ]) {
      expect(() => assertHistoricalRestoreProofMatchesPlan({ ...proof, ...changed }, plan))
        .toThrow(/restored.*plan|proof.*plan/i);
    }
  });
});
