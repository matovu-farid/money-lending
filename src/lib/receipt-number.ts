export function generateReceiptNumber(): string {
  const now = new Date()
  const date = now.toISOString().slice(0, 10).replace(/-/g, "")
  const rand = Math.random().toString(36).substring(2, 6).toUpperCase()
  return `RCP-${date}-${rand}`
}
