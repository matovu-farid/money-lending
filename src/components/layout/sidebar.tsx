"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import Link from "next/link"
import { usePathname, useRouter } from "next/navigation"
import {
  LayoutDashboard,
  Users,
  Banknote,
  CreditCard,
  Landmark,
  Receipt,
  BarChart3,
  Shield,
  LogOut,
  ClipboardCheck,
  ArrowRightLeft,
  Activity,
} from "lucide-react"
import { cn } from "@/lib/utils"
import type { Permission } from "@/types"
import { usePermissions } from "@/hooks/use-permissions"
import { signOut, useSession } from "@/lib/auth-client"
import { useSidebarStore } from "@/lib/stores/sidebar"
import { Button } from "@/components/ui/button"
import { ChangeNameDialog } from "@/components/layout/change-name-dialog"
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip"

interface NavItem {
  label: string
  href: string
  icon: React.ElementType
  disabled?: boolean
}

interface NavGroup {
  label?: string
  items: NavItem[]
}

function getNavGroups(has: (p: Permission) => boolean): NavGroup[] {
  const operationsItems: NavItem[] = [
    { label: "Customers", href: "/customers", icon: Users },
    { label: "Loans", href: "/loans", icon: Banknote },
    { label: "Payments", href: "/payments", icon: CreditCard },
  ]
  if (has("rate-change:approve-standard")) {
    operationsItems.push({ label: "Approvals", href: "/approvals", icon: ClipboardCheck })
  }

  const topItems: NavItem[] = []
  if (has("dashboard:read")) {
    topItems.push({ label: "Dashboard", href: "/dashboard", icon: LayoutDashboard })
  }

  const capitalItems: NavItem[] = []
  if (has("expense:read")) {
    capitalItems.push({ label: "Expenses", href: "/expenses", icon: Receipt })
  }
  if (has("fund-transfer:read")) {
    capitalItems.push({ label: "Fund Transfers", href: "/fund-transfers", icon: ArrowRightLeft })
  }
  if (has("creditor:read")) {
    capitalItems.push({ label: "Creditors", href: "/creditors", icon: Landmark })
  }

  const systemItems: NavItem[] = []
  if (has("user:list")) {
    systemItems.push({ label: "Admin", href: "/admin", icon: Shield })
  }

  return [
    { items: topItems },
    { label: "Operations", items: operationsItems },
    { label: "Capital", items: capitalItems },
    { label: "Insights", items: [
      { label: "Reports", href: "/reports", icon: BarChart3 },
      ...(has("activity:read") ? [{ label: "Activities", href: "/activities", icon: Activity }] : []),
    ] },
    ...(systemItems.length > 0 ? [{ label: "System", items: systemItems }] : []),
  ]
}

interface SidebarProps {
  open?: boolean
  onClose?: () => void
}

export function Sidebar({ onClose }: SidebarProps) {
  const { collapsed } = useSidebarStore()
  const pathname = usePathname()
  const router = useRouter()
  const { data: session } = useSession()
  const prefetchTimerRef = useRef<ReturnType<typeof setTimeout>>(undefined)
  const [changeNameOpen, setChangeNameOpen] = useState(false)

  const user = session?.user
  const { has } = usePermissions()

  // Prefetch routes on mount
  useEffect(() => {
    if (has("dashboard:read")) {
      router.prefetch("/dashboard")
    }
    router.prefetch("/customers")
    router.prefetch("/loans")
    router.prefetch("/payments")
    router.prefetch("/creditors")
    if (has("fund-transfer:read")) {
      router.prefetch("/fund-transfers")
    }
    if (has("expense:read")) {
      router.prefetch("/expenses")
    }
    router.prefetch("/reports")
    if (has("rate-change:approve-standard")) {
      router.prefetch("/approvals")
    }
  }, [router, has])

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

  const filteredNavGroups = getNavGroups(has).filter((group) => group.items.length > 0)

  const initials = user?.name
    ? user.name
        .split(" ")
        .map((n: string) => n[0])
        .slice(0, 2)
        .join("")
        .toUpperCase()
    : "?"

  async function handleSignOut() {
    await signOut()
    window.location.href = "/login"
  }

  return (
    <TooltipProvider delay={300}>
      <aside
        className={cn(
          "flex flex-col h-full bg-sidebar transition-all duration-200",
          collapsed ? "w-[60px]" : "w-[240px]"
        )}
      >
        {/* Navigation */}
        <nav aria-label="Main navigation" data-testid="sidebar-nav" className="flex-1 overflow-y-auto py-3 space-y-4">
          {filteredNavGroups.map((group, groupIndex) => (
            <div key={groupIndex}>
              {group.label && !collapsed && (
                <p className="px-3 mb-1 text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                  {group.label}
                </p>
              )}
              {group.label && collapsed && groupIndex > 0 && (
                <div className="my-2" />
              )}
              <ul className="space-y-0.5 px-2">
                {group.items.map((item) => {
                  const isActive =
                    pathname === item.href || pathname.startsWith(item.href + "/")
                  const Icon = item.icon

                  const navLink = (
                    <>
                      {item.disabled ? (
                        <span
                          className={cn(
                            "flex items-center gap-3 rounded-md px-2 py-2 text-sm transition-colors",
                            "opacity-50 pointer-events-none cursor-default",
                            "text-sidebar-foreground"
                          )}
                        >
                          <Icon className="h-4 w-4 shrink-0" />
                          {!collapsed && <span>{item.label}</span>}
                        </span>
                      ) : (
                        <Link
                          href={item.href}
                          onClick={() => { onClose?.() }}
                          onMouseEnter={() => handlePrefetch(item.href)}
                          onFocus={() => handlePrefetch(item.href)}
                          onMouseLeave={cancelPrefetch}
                          aria-current={isActive ? "page" : undefined}
                          className={cn(
                            "flex items-center gap-3 rounded-md px-2 py-2 text-sm transition-colors",
                            isActive
                              ? "bg-sidebar-accent text-sidebar-accent-foreground font-medium"
                              : "text-sidebar-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
                          )}
                        >
                          <Icon className="h-4 w-4 shrink-0" />
                          {!collapsed && <span>{item.label}</span>}
                        </Link>
                      )}
                    </>
                  )

                  // Always wrap in tooltip when collapsed
                  if (collapsed) {
                    return (
                      <li key={item.href}>
                        <Tooltip>
                          <TooltipTrigger render={<span className="block w-full" />}>
                            {navLink}
                          </TooltipTrigger>
                          <TooltipContent side="right">
                            {item.label}
                            {item.disabled && " (Coming soon)"}
                          </TooltipContent>
                        </Tooltip>
                      </li>
                    )
                  }

                  // Wrap disabled items in tooltip when expanded
                  if (item.disabled && !collapsed) {
                    return (
                      <li key={item.href}>
                        <Tooltip>
                          <TooltipTrigger render={<span className="block w-full" />}>
                            {navLink}
                          </TooltipTrigger>
                          <TooltipContent side="right">Coming soon</TooltipContent>
                        </Tooltip>
                      </li>
                    )
                  }

                  return <li key={item.href}>{navLink}</li>
                })}
              </ul>
            </div>
          ))}
        </nav>

        {/* User section at bottom */}
        <div className="p-2">
          <div
            className={cn(
              "flex items-center gap-2 rounded-md px-2 py-2",
              collapsed ? "justify-center" : ""
            )}
          >
            {/* Avatar + name area — clickable to change name */}
            <button
              type="button"
              className={cn(
                "flex items-center gap-2 min-w-0 rounded-md hover:bg-sidebar-accent transition-colors",
                collapsed ? "" : "flex-1 px-1 py-1 -mx-1"
              )}
              onClick={() => setChangeNameOpen(true)}
              aria-label="Change name"
            >
              <div className="h-8 w-8 rounded-full bg-primary text-primary-foreground flex items-center justify-center text-xs font-semibold shrink-0">
                {initials}
              </div>
              {!collapsed && (
                <div className="flex-1 min-w-0 text-left">
                  <p className="text-sm font-medium text-sidebar-foreground truncate">
                    {user?.name ?? "User"}
                  </p>
                  <p className="text-xs text-muted-foreground truncate">
                    {user?.email ?? ""}
                  </p>
                </div>
              )}
            </button>
            {!collapsed && (
              <Button
                variant="ghost"
                size="icon"
                className="h-8 w-8 shrink-0 text-muted-foreground hover:text-destructive hover:bg-destructive/10"
                onClick={handleSignOut}
                aria-label="Sign out"
              >
                <LogOut className="h-4 w-4" />
              </Button>
            )}
          </div>
          {collapsed && (
            <Tooltip>
              <TooltipTrigger render={<span />} className="w-full block">
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-8 w-full text-muted-foreground hover:text-destructive hover:bg-destructive/10"
                  onClick={handleSignOut}
                  aria-label="Sign out"
                >
                  <LogOut className="h-4 w-4" />
                </Button>
              </TooltipTrigger>
              <TooltipContent side="right">Sign out</TooltipContent>
            </Tooltip>
          )}
        </div>
        <ChangeNameDialog
          open={changeNameOpen}
          onOpenChange={setChangeNameOpen}
          currentName={user?.name ?? ""}
        />
      </aside>
    </TooltipProvider>
  )
}
