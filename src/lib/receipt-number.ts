import { randomBytes } from "crypto"

export function generateReceiptNumber(): string {
  const now = new Date()
  const date = now.toISOString().slice(0, 10).replace(/-/g, "")
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789" // 32 chars (power of 2) — no bias
  const bytes = randomBytes(4)
  const rand = Array.from(bytes, (b) => chars[b % chars.length]).join("")
  return `RCP-${date}-${rand}`
}
