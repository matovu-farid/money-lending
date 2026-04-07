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

/** Common amount presets for payment forms */
export const AMOUNT_PRESETS = [
  { label: "50K", value: "50000" },
  { label: "100K", value: "100000" },
  { label: "200K", value: "200000" },
  { label: "500K", value: "500000" },
  { label: "1M", value: "1000000" },
  { label: "2M", value: "2000000" },
] as const
