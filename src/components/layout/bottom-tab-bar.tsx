"use client"

import Link from "next/link"
import { usePathname } from "next/navigation"
import {
  LayoutDashboard,
  Users,
  CreditCard,
  Banknote,
  MoreHorizontal,
} from "lucide-react"
import { cn } from "@/lib/utils"

const PRIMARY_TABS = [
  { label: "Dashboard", href: "/dashboard", icon: LayoutDashboard },
  { label: "Customers", href: "/customers", icon: Users },
  { label: "Payments", href: "/payments", icon: CreditCard },
  { label: "Loans", href: "/loans", icon: Banknote },
  { label: "More", href: null, icon: MoreHorizontal },
] as const

interface BottomTabBarProps {
  onMoreClick: () => void
  className?: string
}

export function BottomTabBar({ onMoreClick, className }: BottomTabBarProps) {
  const pathname = usePathname()

  return (
    <nav
      aria-label="Main navigation"
      data-testid="bottom-tab-bar"
      className={cn(
        "fixed bottom-0 inset-x-0 z-40 bg-background border-t border-border safe-area-bottom",
        className
      )}
    >
      <div className="flex h-14 items-stretch">
        {PRIMARY_TABS.map((tab) => {
          const Icon = tab.icon
          const isActive = tab.href
            ? pathname === tab.href || pathname.startsWith(tab.href + "/")
            : false

          if (tab.href === null) {
            return (
              <button
                key={tab.label}
                data-testid="bottom-tab-more"
                onClick={onMoreClick}
                aria-label="Open more navigation options"
                className={cn(
                  "flex-1 flex flex-col items-center justify-center gap-1 relative",
                  "text-muted-foreground transition-colors duration-200"
                )}
              >
                <Icon className="h-5 w-5" />
                <span className="text-[10px] font-medium">{tab.label}</span>
              </button>
            )
          }

          return (
            <Link
              key={tab.href}
              href={tab.href}
              data-testid={`bottom-tab-${tab.label.toLowerCase()}`}
              aria-current={isActive ? "page" : undefined}
              className={cn(
                "flex-1 flex flex-col items-center justify-center gap-1 relative",
                "transition-colors duration-200",
                isActive ? "text-primary font-semibold" : "text-muted-foreground"
              )}
            >
              <Icon className="h-5 w-5" />
              <span className="text-[10px] font-medium">{tab.label}</span>
              <span
                className={cn(
                  "absolute bottom-0 h-0.5 w-8 rounded-full bg-primary",
                  "transition-opacity duration-200",
                  isActive ? "opacity-100" : "opacity-0"
                )}
              />
            </Link>
          )
        })}
      </div>
    </nav>
  )
}
