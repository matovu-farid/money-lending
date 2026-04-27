"use client"

import { useCallback, useEffect, useRef } from "react"
import Link from "next/link"
import { usePathname, useRouter } from "next/navigation"
import { Drawer } from "@base-ui/react/drawer"
import {
  Landmark,
  Receipt,
  TrendingUp,
  BarChart3,
  Shield,
} from "lucide-react"
import { cn } from "@/lib/utils"

const MORE_ITEMS = [
  { label: "Creditors", href: "/creditors", icon: Landmark },
  { label: "Expenses", href: "/expenses", icon: Receipt },
  { label: "Income", href: "/income", icon: TrendingUp },
  { label: "Reports", href: "/reports", icon: BarChart3 },
  { label: "Admin", href: "/admin", icon: Shield },
]

interface MoreSheetProps {
  open: boolean
  onOpenChange: (open: boolean) => void
}

export function MoreSheet({ open, onOpenChange }: MoreSheetProps) {
  const pathname = usePathname()
  const router = useRouter()
  const prefetchTimerRef = useRef<ReturnType<typeof setTimeout>>(undefined)

  // Prefetch route on hover with debounce
  const handlePrefetch = useCallback((href: string) => {
    clearTimeout(prefetchTimerRef.current)
    prefetchTimerRef.current = setTimeout(() => {
      router.prefetch(href)
    }, 100)
  }, [router])

  const cancelPrefetch = useCallback(() => {
    clearTimeout(prefetchTimerRef.current)
  }, [])

  useEffect(() => {
    return () => {
      clearTimeout(prefetchTimerRef.current)
    }
  }, [])

  return (
    <Drawer.Root open={open} onOpenChange={onOpenChange} swipeDirection="down">
      <Drawer.Portal>
        <Drawer.Backdrop className="fixed inset-0 z-50 bg-black/20" />
        <Drawer.Viewport className="fixed inset-0 z-50 flex items-end pointer-events-none">
        <Drawer.Popup
          data-testid="more-sheet"
          className="w-full bg-background rounded-t-2xl safe-area-bottom pointer-events-auto"
        >
          <div className="mx-auto mt-2 h-2 w-12 rounded-full bg-muted-foreground/30" />
          <nav aria-label="More navigation" className="p-4 space-y-1">
            {MORE_ITEMS.map((item) => {
              const Icon = item.icon
              const isActive =
                pathname === item.href || pathname.startsWith(item.href + "/")

              return (
                <Link
                  key={item.href}
                  href={item.href}
                  data-testid={`more-item-${item.label.toLowerCase()}`}
                  onClick={() => onOpenChange(false)}
                  onMouseEnter={() => handlePrefetch(item.href)}
                  onFocus={() => handlePrefetch(item.href)}
                  onTouchStart={() => handlePrefetch(item.href)}
                  onMouseLeave={cancelPrefetch}
                  aria-current={isActive ? "page" : undefined}
                  className={cn(
                    "flex items-center gap-3 rounded-md px-3 py-3 text-sm transition-colors",
                    isActive
                      ? "bg-sidebar-accent text-sidebar-accent-foreground font-medium"
                      : "text-foreground hover:bg-accent"
                  )}
                >
                  <Icon className="h-5 w-5 shrink-0" />
                  {item.label}
                </Link>
              )
            })}
          </nav>
        </Drawer.Popup>
        </Drawer.Viewport>
      </Drawer.Portal>
    </Drawer.Root>
  )
}
