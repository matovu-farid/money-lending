import { beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("@/lib/auth", () => ({ auth: { api: { getSession: vi.fn() } } }))
vi.mock("next/headers", () => ({ headers: vi.fn().mockResolvedValue(new Headers()) }))
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }))

import { auth } from "@/lib/auth"
import { approveHistoricalRateRepairAction } from "../historical-rate-repair.actions"

describe("legacy historical-rate human approval endpoint", () => {
  beforeEach(() => vi.clearAllMocks())

  it("requires a session and an administrator", async () => {
    vi.mocked(auth.api.getSession).mockResolvedValue(null as never)
    expect(await approveHistoricalRateRepairAction({} as never))
      .toEqual({ error: "Unauthorized" })
    vi.mocked(auth.api.getSession).mockResolvedValue({
      user: { id: "officer-1", role: "loanOfficer" },
    } as never)
    expect(await approveHistoricalRateRepairAction({} as never))
      .toEqual({ error: "Forbidden" })
  })

  it("never records human sign-off even for an administrator", async () => {
    vi.mocked(auth.api.getSession).mockResolvedValue({
      user: { id: "admin-1", role: "admin" },
    } as never)
    expect(await approveHistoricalRateRepairAction({} as never))
      .toEqual({ error: "Financial corrections require a separate agent review" })
  })
})
