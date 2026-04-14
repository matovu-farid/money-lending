"use client"

import { useCallback, useEffect, useRef } from "react"
import Link from "next/link"
import { usePathname, useRouter } from "next/navigation"
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
  LogOut,
  ClipboardCheck,
  ArrowRightLeft,
  Activity,
} from "lucide-react"
import { cn } from "@/lib/utils"
import type { Permission } from "@/types"
import { usePermissions } from "@/hooks/use-permissions"
import { signOut, useSession } from "@/lib/auth-client"
import { queryKeys } from "@/hooks/query-keys"
import { getDashboardAction } from "@/actions/dashboard.actions"
import { listPaymentsAction } from "@/actions/payment.actions"
import { searchCustomersAction } from "@/actions/customer.actions"
import { listLoansWithOverdueAction } from "@/actions/loan.actions"
import { listAllRequestsAction } from "@/actions/rate-change-request.actions"
import { listFundTransfersAction } from "@/actions/fund-transfer.actions"
import { listCreditorsAction, getSystemCapitalAction } from "@/actions/creditor.actions"
import { getActivitiesAction } from "@/actions/activity.actions"
import { listExpenseTransactionsAction, listExpenseCategoriesAction } from "@/actions/expense.actions"
import {
  getPortfolioReportAction,
  getPnlReportAction,
  getBalanceSheetReportAction,
} from "@/actions/report.actions"
import { getCurrentMonth } from "@/lib/utils"
import { useSidebarStore } from "@/lib/stores/sidebar"
import { prefetchQueue, Priority } from "@/lib/prefetch-queue"
import { usePrefetchAwareLink } from "@/hooks/use-prefetch-navigate"
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
  const queryClient = useQueryClient()
  const prefetchTimerRef = useRef<ReturnType<typeof setTimeout>>(undefined)
  const { onLinkClick } = usePrefetchAwareLink()

  const user = session?.user
  const { has } = usePermissions()

  // Prefetch all pages via the global priority queue on mount
  useEffect(() => {
    const staleTime = 30_000
    const { HIGH, NORMAL, LOW } = Priority

    // HIGH — Core operations pages (user will visit these first)
    if (has("dashboard:read")) {
      prefetchQueue.add(() => router.prefetch("/dashboard"), HIGH, "route:/dashboard")
      prefetchQueue.add(() =>
        queryClient.prefetchQuery({
          queryKey: queryKeys.dashboard.kpis(),
          queryFn: () => getDashboardAction().then((r) => { if ("error" in r) throw new Error(r.error); return r.data }),
          staleTime,
        }), HIGH, "data:dashboard-kpis")
    }
    prefetchQueue.add(() => router.prefetch("/customers"), HIGH, "route:/customers")
    prefetchQueue.add(() => router.prefetch("/loans"), HIGH, "route:/loans")
    prefetchQueue.add(() => router.prefetch("/payments"), HIGH, "route:/payments")

    prefetchQueue.add(() =>
      queryClient.prefetchQuery({
        queryKey: queryKeys.customers.search({}, 0),
        queryFn: () => searchCustomersAction({ page: 0, pageSize: 20 }).then((r) => { if ("error" in r) throw new Error(r.error); return r.data }),
        staleTime,
      }), HIGH, "data:customers-search-0")

    prefetchQueue.add(() =>
      queryClient.prefetchQuery({
        queryKey: queryKeys.loans.all,
        queryFn: () => listLoansWithOverdueAction().then((r) => { if ("error" in r) throw new Error(r.error); return r.data }),
        staleTime,
      }), HIGH, "data:loans-all")

    prefetchQueue.add(() =>
      queryClient.prefetchQuery({
        queryKey: queryKeys.payments.list({}, 1),
        queryFn: () => listPaymentsAction({ page: 1, pageSize: 25 }).then((r) => { if ("error" in r) throw new Error(r.error); return r.data }),
        staleTime,
      }), HIGH, "data:payments-list-1")

    // NORMAL — Secondary pages
    prefetchQueue.add(() => router.prefetch("/creditors"), NORMAL, "route:/creditors")
    prefetchQueue.add(() => router.prefetch("/fund-transfers"), NORMAL, "route:/fund-transfers")

    prefetchQueue.add(() =>
      queryClient.prefetchQuery({
        queryKey: queryKeys.fundTransfers.all,
        queryFn: () => listFundTransfersAction().then((r) => { if ("error" in r) throw new Error(r.error); return r.data }),
        staleTime,
      }), NORMAL, "data:fund-transfers-all")

    prefetchQueue.add(() =>
      queryClient.prefetchQuery({
        queryKey: queryKeys.creditors.all,
        queryFn: () => listCreditorsAction().then((r) => { if ("error" in r) throw new Error(r.error); return r.data }),
        staleTime,
      }), NORMAL, "data:creditors-all")

    prefetchQueue.add(() =>
      queryClient.prefetchQuery({
        queryKey: queryKeys.creditors.capital(),
        queryFn: () => getSystemCapitalAction().then((r) => { if ("error" in r) throw new Error(r.error); return r.data }),
        staleTime,
      }), NORMAL, "data:creditors-capital")

    if (has("expense:read")) {
      prefetchQueue.add(() => router.prefetch("/expenses"), NORMAL, "route:/expenses")
      prefetchQueue.add(() =>
        queryClient.prefetchQuery({
          queryKey: queryKeys.expenses.list({}, 1),
          queryFn: () => listExpenseTransactionsAction().then((r) => { if ("error" in r) throw new Error(r.error); return r.data }),
          staleTime,
        }), NORMAL, "data:expenses-list-1")

      prefetchQueue.add(() =>
        queryClient.prefetchQuery({
          queryKey: queryKeys.expenses.categories(),
          queryFn: () => listExpenseCategoriesAction().then((r) => { if ("error" in r) throw new Error(r.error); return r.data }),
          staleTime,
        }), NORMAL, "data:expenses-categories")
    }

    // LOW — Report data (prefetch so exports are instant)
    const currentMonth = getCurrentMonth()
    prefetchQueue.add(() => router.prefetch("/reports"), LOW, "route:/reports")
    prefetchQueue.add(() =>
      queryClient.prefetchQuery({
        queryKey: queryKeys.reports.portfolio(),
        queryFn: () => getPortfolioReportAction().then((r) => { if ("error" in r) throw new Error(r.error); return r.data }),
        staleTime,
      }), LOW, "data:reports-portfolio")
    prefetchQueue.add(() =>
      queryClient.prefetchQuery({
        queryKey: queryKeys.reports.pnl(currentMonth),
        queryFn: () => getPnlReportAction({ period: currentMonth }).then((r) => { if ("error" in r) throw new Error(r.error); return r.data }),
        staleTime,
      }), LOW, `data:reports-pnl-${currentMonth}`)
    prefetchQueue.add(() =>
      queryClient.prefetchQuery({
        queryKey: queryKeys.reports.balanceSheet(currentMonth),
        queryFn: () => getBalanceSheetReportAction({ period: currentMonth }).then((r) => { if ("error" in r) throw new Error(r.error); return r.data }),
        staleTime,
      }), LOW, `data:reports-balance-sheet-${currentMonth}`)
    // Skip prefetching transaction report data — it fetches up to 10K rows
    // and is only needed for client-side export, not page display.

    // LOW — Conditional pages
    if (has("activity:read")) {
      prefetchQueue.add(
        () => queryClient.prefetchQuery({
          queryKey: queryKeys.activities.list({ actorId: "", entityType: "", dateFrom: "", dateTo: "" }, 1),
          queryFn: () => getActivitiesAction({ page: 1, pageSize: 25 }).then((r) => ("data" in r ? r.data : Promise.reject(r.error))),
          staleTime,
        }), LOW, "data:activities-list-1")
    }
    if (has("rate-change:approve-standard")) {
      prefetchQueue.add(() => router.prefetch("/approvals"), LOW, "route:/approvals")
      prefetchQueue.add(() =>
        queryClient.prefetchQuery({
          queryKey: queryKeys.rateChangeRequests.pending(),
          queryFn: () => listAllRequestsAction().then((r) => { if ("error" in r) throw new Error(r.error); return r.data }),
          staleTime,
        }), LOW, "data:rate-change-requests-pending")
    }
  }, [router, queryClient, has])

  // Prefetch TanStack Query data on hover — uses CRITICAL priority via the queue
  // so dedup and debounce apply, and idle scheduling is respected
  const handlePrefetch = useCallback((href: string) => {
    clearTimeout(prefetchTimerRef.current)
    prefetchTimerRef.current = setTimeout(() => {
      const staleTime = 30_000
      prefetchQueue.add(() => router.prefetch(href), Priority.CRITICAL, `route:${href}`)
      if (href === "/dashboard") {
        prefetchQueue.add(() =>
          queryClient.prefetchQuery({
            queryKey: queryKeys.dashboard.kpis(),
            queryFn: () => getDashboardAction().then((r) => { if ("error" in r) throw new Error(r.error); return r.data }),
            staleTime,
          }), Priority.CRITICAL, "data:dashboard-kpis")
      } else if (href === "/payments") {
        prefetchQueue.add(() =>
          queryClient.prefetchQuery({
            queryKey: queryKeys.payments.list({}, 1),
            queryFn: () => listPaymentsAction({ page: 1, pageSize: 25 }).then((r) => { if ("error" in r) throw new Error(r.error); return r.data }),
            staleTime,
          }), Priority.CRITICAL, "data:payments-list-1")
      } else if (href === "/customers") {
        prefetchQueue.add(() =>
          queryClient.prefetchQuery({
            queryKey: queryKeys.customers.search({}, 0),
            queryFn: () => searchCustomersAction({ page: 0, pageSize: 20 }).then((r) => { if ("error" in r) throw new Error(r.error); return r.data }),
            staleTime,
          }), Priority.CRITICAL, "data:customers-search-0")
      } else if (href === "/loans") {
        prefetchQueue.add(() =>
          queryClient.prefetchQuery({
            queryKey: queryKeys.customers.recent(),
            queryFn: () => searchCustomersAction({ page: 0, pageSize: 3, sortByRecent: true }).then((r) => { if ("error" in r) throw new Error(r.error); return r.data?.rows ?? [] }),
            staleTime,
          }), Priority.CRITICAL, "data:customers-recent")
      }
    }, 100)
  }, [queryClient, router])

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
                          onClick={() => { onLinkClick(); onClose?.() }}
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
