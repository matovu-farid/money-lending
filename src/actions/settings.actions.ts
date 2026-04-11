"use server"

import { db } from "@/lib/db"
import { systemSettings } from "@/lib/db/schema/settings"
import { getSession, requireRole } from "@/lib/action-utils"

const VALID_SETTING_KEYS = ["default_interest_rate", "default_min_interest_days"] as const
type SettingKey = (typeof VALID_SETTING_KEYS)[number]

interface UpdateSettingInput {
  key: string
  value: string
}

export async function getSettingsAction() {
  const session = await getSession()
  if (!session) {
    return { error: "Unauthorized" }
  }

  try {
    const settings = await db.select().from(systemSettings)
    return { data: settings }
  } catch {
    return { error: "Failed to load settings" }
  }
}

export async function updateSettingAction(input: UpdateSettingInput) {
  const session = await getSession()
  if (!session) {
    return { error: "Unauthorized" }
  }

  const forbidden = requireRole(session, "superAdmin", "Only Super Admin can edit system settings")
  if (forbidden) return { error: forbidden }

  if (!VALID_SETTING_KEYS.includes(input.key as SettingKey)) {
    return { error: "Invalid setting key. Must be one of: " + VALID_SETTING_KEYS.join(", ") }
  }
  if (!input.value?.trim()) {
    return { error: "Setting value is required" }
  }

  try {
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
  } catch {
    return { error: "Failed to update setting" }
  }
}
