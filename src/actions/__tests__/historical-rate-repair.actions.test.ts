import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/auth", () => ({ auth: { api: { getSession: vi.fn() } } }));
vi.mock("next/headers", () => ({ headers: vi.fn().mockResolvedValue(new Headers()) }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/services/historical-rate-repair.service", () => ({
  loadHistoricalRateRepairPlan: vi.fn(),
}));
vi.mock("@/services/historical-rate-repair-apply.service", () => ({
  approveHistoricalRateRepair: vi.fn(),
}));

import { auth } from "@/lib/auth";
import { loadHistoricalRateRepairPlan } from "@/services/historical-rate-repair.service";
import { approveHistoricalRateRepair } from "@/services/historical-rate-repair-apply.service";
import { approveHistoricalRateRepairAction } from "../historical-rate-repair.actions";

const input = {
  loanId: "10b5f8b9-42eb-44bd-aac3-d9d6e6657022",
  asOf: "2026-10-10T15:44:00.000Z",
  policyVersion: "v1",
  planHash: "d7a73e51b426e3e1c70a1c3300af20ba102680ee8e5e6feab4f39bbe079d1fe4",
  inputFingerprint: "9925662cdc5f48779e63ac5aa5affb0b1d8c6906bb0993740f1dabf0e883435f",
  reviewNote: "Reviewed Daglas's four payments and non-cash correction.",
};
const plan = { ...input, classification: "review", asOf: new Date(input.asOf) };

describe("approveHistoricalRateRepairAction", () => {
  beforeEach(() => vi.clearAllMocks());

  it("requires a signed-in administrator", async () => {
    vi.mocked(auth.api.getSession).mockResolvedValue(null as never);
    expect(await approveHistoricalRateRepairAction(input)).toEqual({ error: "Unauthorized" });
    vi.mocked(auth.api.getSession).mockResolvedValue({
      user: { id: "officer-1", role: "loanOfficer" },
    } as never);
    expect(await approveHistoricalRateRepairAction(input)).toEqual({ error: "Forbidden" });
    expect(approveHistoricalRateRepair).not.toHaveBeenCalled();
  });

  it("rejects a stale exact plan without creating approval", async () => {
    vi.mocked(auth.api.getSession).mockResolvedValue({
      user: { id: "admin-1", role: "admin" },
    } as never);
    vi.mocked(loadHistoricalRateRepairPlan).mockResolvedValue({
      ...plan, planHash: "a".repeat(64),
    } as never);
    expect(await approveHistoricalRateRepairAction(input)).toEqual({
      error: "Reviewed plan has changed; generate and review a new preview",
    });
    expect(approveHistoricalRateRepair).not.toHaveBeenCalled();
  });

  it("rejects a missing review note before loading the plan", async () => {
    vi.mocked(auth.api.getSession).mockResolvedValue({
      user: { id: "admin-1", role: "admin" },
    } as never);
    expect(await approveHistoricalRateRepairAction({
      ...input, reviewNote: undefined,
    } as never)).toEqual({
      error: "An exact reviewed plan and substantive note are required",
    });
    expect(loadHistoricalRateRepairPlan).not.toHaveBeenCalled();
  });

  it("records the authenticated actor only for the matching reviewed plan", async () => {
    vi.mocked(auth.api.getSession).mockResolvedValue({
      user: { id: "admin-1", role: "admin" },
    } as never);
    vi.mocked(loadHistoricalRateRepairPlan).mockResolvedValue(plan as never);
    vi.mocked(approveHistoricalRateRepair).mockResolvedValue("approval-1");
    expect(await approveHistoricalRateRepairAction(input)).toEqual({
      data: { approvalId: "approval-1", planHash: input.planHash },
    });
    expect(approveHistoricalRateRepair).toHaveBeenCalledWith(
      plan, "admin-1", input.reviewNote,
    );
  });
});
