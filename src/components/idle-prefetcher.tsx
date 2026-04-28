"use client"

import { useEffect } from "react"
import { useSession } from "@/lib/auth-client"
import { scheduleIdlePrefetch } from "@/lib/idle-prefetch"

/**
 * Renders nothing. Schedules an idle-time data-prefetch pass once per page
 * load, gated on auth being established — otherwise the prefetched server
 * actions would 401 (or worse, succeed empty and pollute the cache).
 */
export function IdlePrefetcher(): null {
  const { data: session, isPending } = useSession()
  useEffect(() => {
    if (isPending || !session) return
    scheduleIdlePrefetch()
  }, [isPending, session])
  return null
}
