"use server"

import { withAction } from "@/lib/with-action"
import {
  getAllowlistState,
  setAllowlistEnabled,
  removeAllowlistEntry,
  clearAllowlist,
  type AllowlistState,
} from "@/services/ip-allowlist.service"

export const getIpAllowlistStateAction = withAction({
  permission: "ip-allowlist:manage",
  action: async (): Promise<{ data: AllowlistState }> => {
    return { data: await getAllowlistState() }
  },
})

interface ToggleInput {
  enabled: boolean
}

export const setIpAllowlistEnabledAction = withAction<ToggleInput, { data: { ok: true } }>({
  permission: "ip-allowlist:manage",
  action: async (session, input) => {
    await setAllowlistEnabled(input.enabled, session.user.id)
    return { data: { ok: true as const } }
  },
})

interface RemoveInput {
  entryId: string
}

export const removeAllowlistEntryAction = withAction<RemoveInput, { data: { ok: true } }>({
  permission: "ip-allowlist:manage",
  action: async (session, input) => {
    await removeAllowlistEntry(input.entryId, session.user.id)
    return { data: { ok: true as const } }
  },
})

export const clearAllowlistAction = withAction({
  permission: "ip-allowlist:manage",
  action: async (session): Promise<{ data: { ok: true } }> => {
    await clearAllowlist(session.user.id)
    return { data: { ok: true as const } }
  },
})
