import { db } from "@/lib/db"
import { systemSettings } from "@/lib/db/schema/settings"

export type SystemSetting = typeof systemSettings.$inferSelect

export async function getAllSettings(): Promise<SystemSetting[]> {
  return db.select().from(systemSettings)
}

export interface UpsertSettingInput {
  key: string
  value: string
  updatedBy: string
}

export async function upsertSetting(input: UpsertSettingInput): Promise<SystemSetting> {
  const [result] = await db
    .insert(systemSettings)
    .values({
      key: input.key,
      value: input.value,
      updatedBy: input.updatedBy,
    })
    .onConflictDoUpdate({
      target: systemSettings.key,
      set: {
        value: input.value,
        updatedBy: input.updatedBy,
        updatedAt: new Date(),
      },
    })
    .returning()
  return result
}
