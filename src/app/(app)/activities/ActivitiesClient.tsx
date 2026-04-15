"use client"

import { Suspense } from "react"
import { ExternalLink } from "lucide-react"
import Link from "next/link"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { ResponsiveTable, type Column } from "@/components/ui/responsive-table"
import { FilterPanel } from "@/components/ui/filter-panel"
import { PageHeader } from "@/components/ui/page-header"
import { useUrlFilters } from "@/hooks/use-url-filters"
import { useActivities, ACTIVITIES_PAGE_SIZE } from "@/hooks/use-activities"
import { useAdminUsers } from "@/hooks/use-admin-users"
import { formatDate } from "@/lib/utils"
import type { ActivityItem } from "@/types/activity"

const ENTITY_TYPES = [
  { value: "", label: "All types" },
  { value: "loan", label: "Loan" },
  { value: "payment", label: "Payment" },
  { value: "customer", label: "Customer" },
  { value: "creditor", label: "Creditor" },
  { value: "fund_transfer", label: "Fund Transfer" },
  { value: "rate_change_request", label: "Rate Change" },
  { value: "collateral_settlement", label: "Settlement" },
  { value: "transaction_category", label: "Category" },
  { value: "transaction", label: "Transaction" },
]

const ACTION_BADGE_COLORS: Record<string, string> = {
  loan: "bg-indigo-500/15 text-indigo-400",
  payment: "bg-green-500/15 text-green-400",
  customer: "bg-amber-500/15 text-amber-400",
  creditor: "bg-blue-500/15 text-blue-400",
  fund_transfer: "bg-purple-500/15 text-purple-400",
  rate_change_request: "bg-rose-500/15 text-rose-400",
  collateral_settlement: "bg-orange-500/15 text-orange-400",
}

function ActionBadge({ action, entityType }: { action: string; entityType: string }) {
  const color = ACTION_BADGE_COLORS[entityType] ?? "bg-muted text-muted-foreground"
  const label = action.split(".").at(-1) ?? action
  return (
    <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${color}`}>
      {label}
    </span>
  )
}

function formatTime(date: Date): string {
  const d = new Date(date)
  const today = new Date()
  const isToday =
    d.getFullYear() === today.getFullYear() &&
    d.getMonth() === today.getMonth() &&
    d.getDate() === today.getDate()

  if (isToday) {
    return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
  }
  return `${formatDate(d)} ${d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`
}

function LoadingSkeleton() {
  return (
    <div className="space-y-4">
      <div className="h-8 w-48 rounded bg-muted-foreground/10 animate-pulse" />
      <div className="space-y-3">
        {[1, 2, 3, 4, 5].map((i) => (
          <div key={i} className="h-12 rounded-md bg-muted-foreground/10 animate-pulse" />
        ))}
      </div>
    </div>
  )
}

interface ActivitiesContentProps {
  filters: { actorId: string; entityType: string; dateFrom: string; dateTo: string }
  page: number
  setFilter: (key: "actorId" | "entityType" | "dateFrom" | "dateTo", value: string) => void
  clearFilters: () => void
  setPage: (page: number) => void
  hasFilters: boolean
  activeFilterCount: number
}

function ActivitiesContent({
  filters,
  page,
  setFilter,
  clearFilters,
  setPage,
  hasFilters,
  activeFilterCount,
}: ActivitiesContentProps) {
  const { data } = useActivities(filters, page)
  const { data: adminUsers } = useAdminUsers()

  const items = data?.items ?? []
  const total = data?.total ?? 0

  const start = (page - 1) * ACTIVITIES_PAGE_SIZE + 1
  const end = Math.min(page * ACTIVITIES_PAGE_SIZE, total)

  const columns: Column<ActivityItem>[] = [
    {
      key: "occurredAt",
      header: "Time",
      render: (row) => (
        <span className="font-mono tabular-nums text-xs text-muted-foreground whitespace-nowrap">
          {formatTime(row.occurredAt)}
        </span>
      ),
    },
    {
      key: "actorName",
      header: "User",
      render: (row) => (
        <span className="font-medium">{row.actorName}</span>
      ),
    },
    {
      key: "action",
      header: "Action",
      render: (row) => (
        <ActionBadge action={row.action} entityType={row.entityType} />
      ),
    },
    {
      key: "description",
      header: "Details",
      render: (row) => (
        <span className="text-sm text-muted-foreground">{row.description}</span>
      ),
    },
    {
      key: "href",
      header: "",
      hideInCard: true,
      align: "right",
      render: (row) =>
        row.href ? (
          <Link
            href={row.href}
            className="inline-flex items-center text-muted-foreground hover:text-foreground"
            onClick={(e) => e.stopPropagation()}
          >
            <ExternalLink className="h-4 w-4" />
          </Link>
        ) : null,
    },
  ]

  return (
    <>
      <FilterPanel label="Filters" activeCount={activeFilterCount}>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          <div className="space-y-1.5">
            <Label className="text-sm">User</Label>
            <Select
              value={filters.actorId}
              onValueChange={(v: string | null) => setFilter("actorId", !v || v === "__all__" ? "" : v)}
            >
              <SelectTrigger>
                <SelectValue placeholder="All users" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="__all__">All users</SelectItem>
                {(adminUsers ?? []).map((u) => (
                  <SelectItem key={u.id} value={u.id}>
                    {u.name} ({u.role})
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1.5">
            <Label className="text-sm">Entity Type</Label>
            <Select
              value={filters.entityType}
              onValueChange={(v: string | null) => setFilter("entityType", !v || v === "__all__" ? "" : v)}
            >
              <SelectTrigger>
                <SelectValue placeholder="All types" />
              </SelectTrigger>
              <SelectContent>
                {ENTITY_TYPES.map((t) => (
                  <SelectItem key={t.value || "__all__"} value={t.value || "__all__"}>
                    {t.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1.5">
            <Label className="text-sm">Date From</Label>
            <Input
              type="date"
              value={filters.dateFrom}
              onChange={(e) => setFilter("dateFrom", e.target.value)}
            />
          </div>

          <div className="space-y-1.5">
            <Label className="text-sm">Date To</Label>
            <Input
              type="date"
              value={filters.dateTo}
              onChange={(e) => setFilter("dateTo", e.target.value)}
            />
          </div>
        </div>

        {hasFilters && (
          <Button
            variant="ghost"
            size="sm"
            className="text-muted-foreground mt-2"
            onClick={clearFilters}
          >
            Clear filters
          </Button>
        )}
      </FilterPanel>

      {total === 0 ? (
        <div className="py-16 flex flex-col items-center text-center">
          <p className="text-lg font-medium">
            {hasFilters ? "No activities found." : "No team activity recorded yet."}
          </p>
          {hasFilters && (
            <p className="text-muted-foreground mt-2">Try adjusting your filters.</p>
          )}
        </div>
      ) : (
        <>
          <ResponsiveTable
            columns={columns}
            rows={items}
            getRowKey={(row) => row.id}
          />

          {total > ACTIVITIES_PAGE_SIZE && (
            <div className="flex items-center justify-between pt-4">
              <p className="text-sm text-muted-foreground">
                Showing{" "}
                <span className="font-mono tabular-nums">{start}&ndash;{end}</span> of{" "}
                <span className="font-mono tabular-nums">{total}</span>
              </p>
              <div className="flex gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  disabled={page === 1}
                  onClick={() => setPage(page - 1)}
                >
                  Previous
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  disabled={page * ACTIVITIES_PAGE_SIZE >= total}
                  onClick={() => setPage(page + 1)}
                >
                  Next
                </Button>
              </div>
            </div>
          )}
        </>
      )}
    </>
  )
}

export function ActivitiesClient() {
  const { filters, page, setFilter, clearFilters, setPage, hasFilters, activeFilterCount } =
    useUrlFilters({
      basePath: "/activities",
      defaults: { actorId: "", entityType: "", dateFrom: "", dateTo: "" },
    })

  return (
    <div className="space-y-4">
      <PageHeader title="Activity" subtitle="Team actions and audit trail" />

      <Suspense fallback={<LoadingSkeleton />}>
        <ActivitiesContent
          filters={filters}
          page={page}
          setFilter={setFilter}
          clearFilters={clearFilters}
          setPage={setPage}
          hasFilters={hasFilters}
          activeFilterCount={activeFilterCount}
        />
      </Suspense>
    </div>
  )
}
