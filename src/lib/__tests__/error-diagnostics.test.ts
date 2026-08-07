import { describe, expect, it } from "vitest"
import { getDiagnosticErrorMessage } from "../error-diagnostics"
import { DatabaseError } from "../errors"

describe("getDiagnosticErrorMessage", () => {
  it("preserves a useful Error message", () => {
    expect(getDiagnosticErrorMessage(new Error("duplicate key value violates constraint")))
      .toBe("duplicate key value violates constraint")
  })

  it("redacts PostgreSQL connection URLs and credential assignments", () => {
    const error = new Error(
      "connect failed postgres://db_user:super-secret@db.example/neondb?sslmode=require DATABASE_URL=postgresql://owner:another-secret@db.example/db",
    )

    const message = getDiagnosticErrorMessage(error)

    expect(message).toContain("connect failed")
    expect(message).not.toContain("super-secret")
    expect(message).not.toContain("another-secret")
    expect(message).not.toContain("postgres://")
    expect(message).not.toContain("postgresql://")
    expect(message).toContain("[redacted]")
  })

  it("unwraps the database error cause", () => {
    expect(getDiagnosticErrorMessage(new DatabaseError({ cause: new Error("connection refused") })))
      .toBe("connection refused")
  })

  it("caps oversized messages", () => {
    const message = getDiagnosticErrorMessage(new Error("x".repeat(800)))

    expect(message).toHaveLength(500)
    expect(message.endsWith("…")).toBe(true)
  })

  it("handles primitive and missing errors with safe messages", () => {
    expect(getDiagnosticErrorMessage("database unavailable")).toBe("database unavailable")
    expect(getDiagnosticErrorMessage(null)).toBe("Unexpected payment failure")
    expect(getDiagnosticErrorMessage(undefined)).toBe("Unexpected payment failure")
  })
})
