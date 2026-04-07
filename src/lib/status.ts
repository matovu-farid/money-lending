/**
 * Shared status variant and label mappers used across customer and loan UI.
 */

export function customerStatusVariant(status: string): "default" | "destructive" | "secondary" {
  if (status === "active") return "default"
  if (status === "blacklisted") return "destructive"
  return "secondary"
}

export function customerStatusLabel(status: string): string {
  if (status === "active") return "Active"
  if (status === "blacklisted") return "Blacklisted"
  return "Inactive"
}

export function loanStatusVariant(status: string): "default" | "outline" {
  if (status === "active") return "default"
  return "outline"
}

export function loanStatusLabel(status: string): string {
  if (status === "fully_paid") return "Fully Paid"
  if (status === "settled_with_collateral") return "Settled (Collateral)"
  if (status === "rolled_over") return "Rolled Over"
  return status.charAt(0).toUpperCase() + status.slice(1)
}

export function approvalStatusBadgeVariant(status: string): "default" | "outline" | "secondary" | "destructive" {
  if (status === "pending") return "default"
  if (status === "approved") return "secondary"
  if (status === "rejected") return "destructive"
  return "outline"
}
