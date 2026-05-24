/**
 * @vitest-environment jsdom
 *
 * Regression net for the Sentry crash:
 *   TypeError: e.paymentDate.getTime is not a function
 *   at src/app/(app)/loans/[loanId]/loan-detail-client.tsx:210
 *
 * `@electric-sql/client`'s default value parser has no `timestamp` /
 * `timestamptz` entry, so Drizzle timestamp columns reached the client as ISO
 * strings. The schema's `z.coerce.date()` only runs for client-side mutations,
 * never for synced rows, so any consumer that called `.getTime()` on the
 * column would throw on cold render. Fixed by wiring `electricDateParsers`
 * into every Electric collection's `shapeOptions.parser` via the shared
 * `electricShapeOptionsFor(table)` helper.
 */

import { describe, it, expect } from "vitest"
import {
  electricDateParsers,
  electricShapeOptionsFor,
} from "@/lib/electric"

describe("electricDateParsers — Postgres timestamp coercion at the sync boundary", () => {
  it("exposes a parser for each timestamp-shaped Postgres type", () => {
    expect(typeof electricDateParsers.timestamp).toBe("function")
    expect(typeof electricDateParsers.timestamptz).toBe("function")
    expect(typeof electricDateParsers.date).toBe("function")
  })

  it("coerces a timestamptz ISO string into a Date with the same epoch", () => {
    const iso = "2026-05-13T16:01:48Z"
    const out = electricDateParsers.timestamptz(iso) as Date
    expect(out).toBeInstanceOf(Date)
    expect(out.getTime()).toBe(new Date(iso).getTime())
  })

  it("coerces a plain timestamp (no tz) into a valid Date", () => {
    const out = electricDateParsers.timestamp("2026-05-13 16:01:48") as Date
    expect(out).toBeInstanceOf(Date)
    expect(Number.isNaN(out.getTime())).toBe(false)
  })

  it("coerces a date-only string into a valid Date", () => {
    const out = electricDateParsers.date("2026-05-13") as Date
    expect(out).toBeInstanceOf(Date)
    expect(Number.isNaN(out.getTime())).toBe(false)
  })
})

describe("electricShapeOptionsFor — every Electric collection wires the date parsers", () => {
  it("returns url / columnMapper / onError / parser bundled together", () => {
    const opts = electricShapeOptionsFor("payments")
    expect(opts.url).toContain("/api/electric/payments")
    expect(opts.columnMapper).toBeDefined()
    expect(opts.onError).toBeTypeOf("function")
    expect(opts.parser).toBe(electricDateParsers)
  })

  it("threads the same parser identity for every table — no per-table drift", () => {
    expect(electricShapeOptionsFor("payments").parser).toBe(electricDateParsers)
    expect(electricShapeOptionsFor("loans").parser).toBe(electricDateParsers)
    expect(electricShapeOptionsFor("customers").parser).toBe(electricDateParsers)
  })
})
