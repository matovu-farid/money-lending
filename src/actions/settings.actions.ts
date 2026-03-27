"use server"

import { db } from "@/lib/db"
import { systemSettings } from "@/lib/db/schema/settings"
import { auth } from "@/lib/auth"
import { headers } from "next/headers"
import { ROLE_LEVELS, type UserRole } from "@/types"

// LOAN-11 vs AUTH-03 resolution:
// - Per-loan overrides (interestRateOverride, minPeriodOverride columns on the loan record)
//   are available to Admin+ via createLoanAction (see loan.actions.ts).
// - Global system defaults (default_interest_rate, default_min_interest_days in system_settings)
//   require Super Admin per AUTH-03 capability table.
// LOAN-11's "Admin can override globally" is interpreted as "Admin can override per-loan";
// true global default changes require Super Admin.

const VALID_SETTING_KEYS = ["default_interest_rate", "default_min_interest_days"] as const
type SettingKey = (typeof VALID_SETTING_KEYS)[number]

interface UpdateSettingInput {
  key: string
  value: string
}

export async function getSettingsAction() {
  const session = await auth.api.getSession({ headers: await headers() })
  if (!session?.user) {
    return { error: "Unauthorized" }
  }

  const settings = await db.select().from(systemSettings)
  return { data: settings }
}

export async function updateSettingAction(input: UpdateSettingInput) {
  const session = await auth.api.getSession({ headers: await headers() })
  if (!session?.user) {
    return { error: "Unauthorized" }
  }

  // Only superAdmin can edit system settings (AUTH-03 capability table)
  // Per-loan overrides are admin+ (handled in createLoanAction), but global defaults are superAdmin only
  const role = (session.user.role ?? "unassigned") as UserRole
  if (ROLE_LEVELS[role] < ROLE_LEVELS.superAdmin) {
    return { error: "Only Super Admin can edit system settings" }
  }

  // Runtime validation
  if (!VALID_SETTING_KEYS.includes(input.key as SettingKey)) {
    return { error: "Invalid setting key. Must be one of: " + VALID_SETTING_KEYS.join(", ") }
  }
  if (!input.value?.trim()) {
    return { error: "Setting value is required" }
  }

  const [result] = await db
    .insert(systemSettings)
    .values({
      key: input.key,
      value: input.value,
      updatedBy: session.user.id,
    })
    .onConflictDoUpdate({
      target: systemSettings.key,
      set: {
        value: input.value,
        updatedBy: session.user.id,
        updatedAt: new Date(),
      },
    })
    .returning()
  return { data: result }
}
