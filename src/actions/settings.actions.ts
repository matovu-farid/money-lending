"use server"

import { withAction } from "@/lib/with-action"
import { getAllSettings, upsertSetting, type SystemSetting } from "@/services/settings.service"

const VALID_SETTING_KEYS = ["default_interest_rate", "default_min_interest_days"] as const
type SettingKey = (typeof VALID_SETTING_KEYS)[number]

interface UpdateSettingInput {
  key: string
  value: string
}

type GetSettingsResult = { data: SystemSetting[] } | { error: string }
type UpdateSettingResult = { data: SystemSetting } | { error: string }

export const getSettingsAction = withAction({
  permission: "settings:read",
  action: async (): Promise<GetSettingsResult> => {
    try {
      return { data: await getAllSettings() }
    } catch {
      return { error: "Failed to load settings" }
    }
  },
})

export const updateSettingAction = withAction<UpdateSettingInput, UpdateSettingResult>({
  permission: "settings:update",
  forbiddenMessage: "Only Super Admin can edit system settings",
  action: async (session, input): Promise<UpdateSettingResult> => {
    if (!VALID_SETTING_KEYS.includes(input.key as SettingKey)) {
      return { error: "Invalid setting key. Must be one of: " + VALID_SETTING_KEYS.join(", ") }
    }
    if (!input.value?.trim()) {
      return { error: "Setting value is required" }
    }

    try {
      const result = await upsertSetting({
        key: input.key,
        value: input.value,
        updatedBy: session.user.id,
      })
      return { data: result }
    } catch {
      return { error: "Failed to update setting" }
    }
  },
})
