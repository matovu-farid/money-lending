"use client"

import { useEffect, useState } from "react"
import { WifiOff } from "lucide-react"

/**
 * Belt-and-suspenders: swallow `FetchError`-shaped unhandled rejections that
 * leak from background sync clients (Electric ShapeStream etc.) when the user
 * is offline or the proxy is briefly unavailable. Each ShapeStream already has
 * its own `onError` handler that retries, but if any one is missed we don't
 * want the whole page to be marked as crashed by Next's dev overlay.
 */
function isFetchLikeRejection(reason: unknown): boolean {
  if (!reason || typeof reason !== "object") return false
  const r = reason as { name?: string; status?: number; url?: string }
  if (r.name === "FetchError") return true
  if (r.name === "TypeError" && typeof r.url === "string") return true
  if (typeof r.status === "number" && typeof r.url === "string") return true
  return false
}

/**
 * Fixed-position banner shown when the browser reports it has lost network
 * connectivity. Backed by the standard `navigator.onLine` + `online`/`offline`
 * events — no extra dependency. This catches the common case where a request
 * fails because the user's internet dropped (the symptom we were seeing as
 * spurious "Failed to get session" / CONNECT_TIMEOUT errors).
 *
 * Note: `navigator.onLine === true` only means the device has *some* network
 * link, not that our server is reachable. So this is a hint, not a guarantee.
 */
export function OfflineIndicator() {
  // Default to `true` (online) so SSR matches the optimistic case; the effect
  // below corrects it on mount if the device is actually offline.
  const [online, setOnline] = useState(true)

  useEffect(() => {
    const update = () => setOnline(navigator.onLine)
    update()
    window.addEventListener("online", update)
    window.addEventListener("offline", update)

    const onUnhandled = (event: PromiseRejectionEvent) => {
      if (isFetchLikeRejection(event.reason)) {
        // The shape stream / fetch client will retry automatically. Don't let
        // the rejection surface as an unhandled error.
        console.warn("[network] swallowing transient fetch rejection:", event.reason)
        event.preventDefault()
      }
    }
    window.addEventListener("unhandledrejection", onUnhandled)

    return () => {
      window.removeEventListener("online", update)
      window.removeEventListener("offline", update)
      window.removeEventListener("unhandledrejection", onUnhandled)
    }
  }, [])

  if (online) return null

  return (
    <div
      role="status"
      aria-live="polite"
      className="fixed inset-x-0 top-0 z-[100] flex items-center justify-center gap-2 bg-amber-500 px-4 py-2 text-sm font-medium text-amber-950 shadow-md"
    >
      <WifiOff className="h-4 w-4" />
      You&apos;re offline. Changes won&apos;t sync until your connection is restored.
    </div>
  )
}
