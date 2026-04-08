"use client"

import { useCallback, useRef } from "react"
import Link from "next/link"
import { usePathname } from "next/navigation"
import { useQueryClient } from "@tanstack/react-query"
import {
  LayoutDashboard,
  Users,
  Banknote,
  CreditCard,
  Landmark,
  Receipt,
  BarChart3,
  Shield,
  ChevronLeft,
  ChevronRight,
  LogOut,
  ClipboardCheck,
  ArrowRightLeft,
} from "lucide-react"
import { cn } from "@/lib/utils"
import { ROLE_LEVELS, type UserRole } from "@/types"
import { signOut, useSession } from "@/lib/auth-client"
import { queryKeys } from "@/hooks/query-keys"
import { getDashboardAction } from "@/actions/dashboard.actions"
import { listPaymentsAction } from "@/actions/payment.actions"
import { searchCustomersAction } from "@/actions/customer.actions"
import { useSidebarStore } from "@/lib/stores/sidebar"
import { Button } from "@/components/ui/button"
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

function getNavGroups(userRole: UserRole): NavGroup[] {
  const isSupervisorOrAbove = ROLE_LEVELS[userRole] >= ROLE_LEVELS.supervisor

  const operationsItems: NavItem[] = [
    { label: "Customers", href: "/customers", icon: Users },
    { label: "Loans", href: "/loans", icon: Banknote },
    { label: "Payments", href: "/payments", icon: CreditCard },
  ]
  if (isSupervisorOrAbove) {
    operationsItems.push({ label: "Approvals", href: "/approvals", icon: ClipboardCheck })
  }

  return [
    {
      items: [
        { label: "Dashboard", href: "/dashboard", icon: LayoutDashboard },
      ],
    },
    {
      label: "Operations",
      items: operationsItems,
    },
    {
      label: "Capital",
      items: [
        { label: "Creditors", href: "/creditors", icon: Landmark },
        { label: "Expenses & Income", href: "/expenses", icon: Receipt },
        { label: "Fund Transfers", href: "/fund-transfers", icon: ArrowRightLeft },
      ],
    },
    {
      label: "Insights",
      items: [
        { label: "Reports", href: "/reports", icon: BarChart3 },
      ],
    },
    {
      label: "System",
      items: [
        { label: "Admin", href: "/admin", icon: Shield },
      ],
    },
  ]
}

interface SidebarProps {
  open?: boolean
  onClose?: () => void
}

export function Sidebar({ onClose }: SidebarProps) {
  const { collapsed, toggle } = useSidebarStore()
  const pathname = usePathname()
  const { data: session } = useSession()
  const queryClient = useQueryClient()
  const prefetchTimerRef = useRef<ReturnType<typeof setTimeout>>(undefined)

  const user = session?.user
  const userRole = (user?.role ?? "unassigned") as UserRole
  const userLevel = ROLE_LEVELS[userRole] ?? 0

  // Prefetch TanStack Query data on hover with 100ms delay to avoid needless fetches
  const handlePrefetch = useCallback((href: string) => {
    clearTimeout(prefetchTimerRef.current)
    prefetchTimerRef.current = setTimeout(() => {
      const staleTime = 30_000
      if (href === "/dashboard") {
        queryClient.prefetchQuery({
          queryKey: queryKeys.dashboard.kpis(),
          queryFn: () => getDashboardAction().then((r) => { if ("error" in r) throw new Error(r.error); return r.data }),
          staleTime,
        })
      } else if (href === "/payments") {
        queryClient.prefetchQuery({
          queryKey: queryKeys.payments.list({}, 1),
          queryFn: () => listPaymentsAction({ page: 1, pageSize: 25 }).then((r) => { if ("error" in r) throw new Error(r.error); return r.data }),
          staleTime,
        })
      } else if (href === "/customers") {
        queryClient.prefetchQuery({
          queryKey: queryKeys.customers.search({}, 0),
          queryFn: () => searchCustomersAction({ page: 0, pageSize: 20 }).then((r) => { if ("error" in r) throw new Error(r.error); return r.data }),
          staleTime,
        })
      } else if (href === "/loans") {
        queryClient.prefetchQuery({
          queryKey: queryKeys.customers.recent(),
          queryFn: () => searchCustomersAction({ page: 0, pageSize: 3, sortByRecent: true }).then((r) => { if ("error" in r) throw new Error(r.error); return r.data?.rows ?? [] }),
          staleTime,
        })
      }
    }, 100)
  }, [queryClient])

  const cancelPrefetch = useCallback(() => {
    clearTimeout(prefetchTimerRef.current)
  }, [])

  const filteredNavGroups = getNavGroups(userRole).map((group) => {
    if (group.label !== "Capital") return group
    return {
      ...group,
      items: group.items.filter((item) => {
        if (item.href === "/fund-transfers") return userLevel >= ROLE_LEVELS.admin
        return true
      }),
    }
  }).filter((group) => group.items.length > 0)

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
        {/* Collapse toggle */}
        <div className="flex items-center justify-end px-2 py-2">
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8 text-sidebar-foreground hover:bg-sidebar-accent"
            onClick={toggle}
            aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
          >
            {collapsed ? (
              <ChevronRight className="h-4 w-4" />
            ) : (
              <ChevronLeft className="h-4 w-4" />
            )}
          </Button>
        </div>

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
                          onClick={onClose}
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
            {/* Avatar circle with initials */}
            <div className="h-8 w-8 rounded-full bg-primary text-primary-foreground flex items-center justify-center text-xs font-semibold shrink-0">
              {initials}
            </div>
            {!collapsed && (
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-sidebar-foreground truncate">
                  {user?.name ?? "User"}
                </p>
                <p className="text-xs text-muted-foreground truncate">
                  {user?.email ?? ""}
                </p>
              </div>
            )}
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
      </aside>
    </TooltipProvider>
  )
}
