import { describe, it, expect, vi } from "vitest"

// Mock the server action before importing the hook
vi.mock("@/actions/dashboard.actions", () => ({
  getDashboardAction: vi.fn(),
}))

import { getDashboardAction } from "@/actions/dashboard.actions"
import { useDashboard } from "../use-dashboard"

describe("useDashboard", () => {
  it("is exported as a function", () => {
    expect(typeof useDashboard).toBe("function")
  })

  it("getDashboardAction mock is callable", () => {
    expect(typeof getDashboardAction).toBe("function")
  })
})
