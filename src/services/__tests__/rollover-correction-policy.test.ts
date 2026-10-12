import { describe, expect, it } from "vitest";
import type { CorrectionPlan } from "@/lib/interest/rollover-correction";
import { ROLLOVER_CORRECTION_POLICY_VERSION } from "@/lib/interest/rollover-correction";
import { applyRolloverCorrection, reviewRolloverCorrection } from
  "../rollover-correction-apply.service";

const oldPlan = { policyVersion: "v3", classification: "ready",
  edges: [{ predecessorId: "root", successorId: "next", classification: "ready" }] } as CorrectionPlan;

describe("rollover correction policy gate", () => {
  it("uses v4 and rejects old v3 review and apply attempts", async () => {
    expect(ROLLOVER_CORRECTION_POLICY_VERSION).toBe("v4");
    await expect(reviewRolloverCorrection(oldPlan, "agent:reviewer", "run-v3"))
      .rejects.toThrow(/policy v4/i);
    await expect(applyRolloverCorrection(oldPlan, "agent:executor", {
      manifestPath: "/private/tmp/unused.dump.manifest.json",
      expectedDumpSha256: "a".repeat(64), primaryUrl: "", directUrl: "",
    })).rejects.toThrow(/policy v4/i);
  });
});
