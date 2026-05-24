"use client"

import { Moon, Sun } from "lucide-react"
import { useTheme } from "next-themes"
import { useSyncExternalStore } from "react"

// Subscription that never fires — the server snapshot returning a different
// value than the client snapshot is exactly how `useSyncExternalStore` signals
// "hydration boundary", and the canonical React-19-recommended replacement for
// the older `useEffect(() => setMounted(true), [])` pattern.
const noopSubscribe = () => () => {}
const getMountedClient = () => true
const getMountedServer = () => false

export function ThemeToggle() {
  const { resolvedTheme, setTheme } = useTheme()
  const mounted = useSyncExternalStore(noopSubscribe, getMountedClient, getMountedServer)

  // Avoid hydration mismatch — render a stub until mounted on the client
  if (!mounted) {
    return (
      <div className="h-8 w-8 rounded-md" aria-hidden="true" />
    )
  }

  const isDark = resolvedTheme === "dark"

  return (
    <button
      onClick={() => setTheme(isDark ? "light" : "dark")}
      className="flex items-center justify-center h-8 w-8 rounded-md text-muted-foreground hover:bg-accent hover:text-accent-foreground transition-colors"
      aria-label={isDark ? "Switch to light mode" : "Switch to dark mode"}
    >
      {isDark ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
    </button>
  )
}
