export function generateReceiptNumber(): string {
  const now = new Date()
  const date = now.toISOString().slice(0, 10).replace(/-/g, "")
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789"
  const rand = Array.from({ length: 4 }, () => chars[Math.floor(Math.random() * chars.length)]).join("")
  return `RCP-${date}-${rand}`
}
