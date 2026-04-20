import { randomBytes } from "crypto"
import { localDateString } from "@/lib/utils"

export function generateReceiptNumber(): string {
  const date = localDateString(new Date()).replace(/-/g, "")
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789" // 32 chars (power of 2) — no bias
  const bytes = randomBytes(4)
  const rand = Array.from(bytes, (b) => chars[b % chars.length]).join("")
  return `RCP-${date}-${rand}`
}
