/**
 * Shared status variant and label mappers used across customer and loan UI.
 */

const CUSTOMER_STATUS: Record<string, { variant: "default" | "destructive" | "secondary"; label: string }> = {
  active: { variant: "default", label: "Active" },
  blacklisted: { variant: "destructive", label: "Blacklisted" },
  inactive: { variant: "secondary", label: "Inactive" },
}

export function customerStatusVariant(status: string) {
  return CUSTOMER_STATUS[status]?.variant ?? "secondary"
}

export function customerStatusLabel(status: string) {
  return CUSTOMER_STATUS[status]?.label ?? "Inactive"
}

const LOAN_STATUS: Record<string, { variant: "default" | "outline"; label: string }> = {
  active: { variant: "default", label: "Active" },
  pending: { variant: "outline", label: "Pending" },
  fully_paid: { variant: "outline", label: "Fully Paid" },
  settled_with_collateral: { variant: "outline", label: "Settled (Collateral)" },
  rolled_over: { variant: "outline", label: "Rolled Over" },
}

export function loanStatusVariant(status: string) {
  return LOAN_STATUS[status]?.variant ?? "outline"
}

export function loanStatusLabel(status: string) {
  return LOAN_STATUS[status]?.label ?? status.charAt(0).toUpperCase() + status.slice(1)
}

const APPROVAL_STATUS: Record<string, "default" | "outline" | "secondary" | "destructive"> = {
  pending: "default",
  approved: "secondary",
  rejected: "destructive",
}

export function approvalStatusBadgeVariant(status: string) {
  return APPROVAL_STATUS[status] ?? "outline"
}
