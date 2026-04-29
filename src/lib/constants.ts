import type { DepositLocation } from "@/types"

/** Human-readable labels for deposit locations */
export const DEPOSIT_LOCATION_LABELS: Record<DepositLocation, string> = {
  cash: "Cash on Hand",
  bank: "Bank",
  strong_room: "Strong Room",
}

/** Short labels for deposit locations (used in tables) */
export const DEPOSIT_LOCATION_SHORT_LABELS: Record<DepositLocation, string> = {
  cash: "Cash",
  bank: "Bank",
  strong_room: "Strong Room",
}

/** All deposit location options for <Select> components */
export const DEPOSIT_LOCATION_OPTIONS: { value: DepositLocation; label: string }[] = [
  { value: "cash", label: "Cash on Hand" },
  { value: "bank", label: "Bank" },
  { value: "strong_room", label: "Strong Room" },
]

/** Valid deposit locations for runtime validation */
export const VALID_DEPOSIT_LOCATIONS: string[] = DEPOSIT_LOCATION_OPTIONS.map((o) => o.value)

/** Short ID length for truncated UUID references */
export const SHORT_ID_LENGTH = 8

/** Valid loan types */
export const VALID_LOAN_TYPES = ["perpetual", "fixed_rate", "reducing_balance"] as const

/** Minimum principal amount (UGX) required for perpetual loans */
export const PERPETUAL_LOAN_MIN_AMOUNT = 2_000_000

/** Valid customer statuses */
export const VALID_CUSTOMER_STATUSES = ["active", "blacklisted", "inactive"] as const

/** Common amount presets for payment forms */
export const AMOUNT_PRESETS = [
  { label: "50K", value: "50000" },
  { label: "100K", value: "100000" },
  { label: "200K", value: "200000" },
  { label: "500K", value: "500000" },
  { label: "1M", value: "1000000" },
  { label: "2M", value: "2000000" },
] as const

/** Larger amount presets for principal-sized money (loans, investments, capital movements) */
export const PRINCIPAL_AMOUNT_PRESETS = [
  { label: "1M", value: "1000000" },
  { label: "2M", value: "2000000" },
  { label: "5M", value: "5000000" },
  { label: "10M", value: "10000000" },
  { label: "20M", value: "20000000" },
  { label: "50M", value: "50000000" },
] as const
