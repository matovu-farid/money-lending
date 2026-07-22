"use client"

import { useState, useCallback, useMemo } from "react"
import { useRouter } from "next/navigation"
import Link from "next/link"
import { useLiveQuery } from "@tanstack/react-db"
import { useQuery } from "@tanstack/react-query"
import { customerCollection } from "@/collections/customers"
import { searchCustomersAction } from "@/actions/customer.actions"
import { CustomerSearchBar } from "@/components/customers/customer-search-bar"
import type { Customer, CustomerSearchParams } from "@/types"
import { ResponsiveTable, type Column } from "@/components/ui/responsive-table"
import { Badge } from "@/components/ui/badge"
import { Button, buttonVariants } from "@/components/ui/button"
import { cn } from "@/lib/utils"
import { InfoPopover } from "@/components/ui/info-popover"
import { PageHeader } from "@/components/ui/page-header"
import { customerStatusVariant, customerStatusLabel } from "@/lib/status"
import { normalizeUgandanPhone } from "@/lib/validators"

const PAGE_SIZE = 20

function usesServerLoanFilters(params: CustomerSearchParams): boolean {
  return (
    !!params.loanStatus?.length ||
    (!!params.daysRemainingFilter && params.daysRemainingFilter !== "any")
  )
}

export default function CustomersPage() {
  const router = useRouter()
  const [page, setPage] = useState(0)
  const [searchParams, setSearchParams] = useState<CustomerSearchParams>({})

  const needsServerSearch = usesServerLoanFilters(searchParams)

  const { data: allCustomers, isLoading: customersLoading } = useLiveQuery((q) =>
    q.from({ c: customerCollection }).select(({ c }) => c),
  )

  // Loan-based filters must hit uncapped server search (R17-5 / R19-2) —
  // do not join capped customerCollection × loan collections client-side.
  const { data: serverSearch, isLoading: serverLoading } = useQuery({
    queryKey: ["customers", "search", searchParams, page],
    queryFn: async () => {
      const result = await searchCustomersAction({
        ...searchParams,
        page,
        pageSize: PAGE_SIZE,
      })
      if ("error" in result) throw new Error(String(result.error))
      return result.data as { rows: Customer[]; total: number }
    },
    enabled: needsServerSearch,
    staleTime: 15_000,
  })

  // Client-side filtering for name/status-only modes (fast path on synced collection)
  const filtered = useMemo(() => {
    if (needsServerSearch) return []
    let result = allCustomers ?? []
    if (searchParams.name) {
      const term = searchParams.name.trim().toLowerCase()
      const normalizedPhone = normalizeUgandanPhone(searchParams.name)
      result = result.filter(
        (c) =>
          c.fullName.toLowerCase().includes(term) ||
          c.nin.toLowerCase().includes(term) ||
          c.contact.toLowerCase().includes(term) ||
          (normalizedPhone ? c.contact === normalizedPhone : false),
      )
    }
    if (searchParams.status?.length) {
      result = result.filter((c) => searchParams.status!.includes(c.status))
    }
    return result
  }, [allCustomers, searchParams, needsServerSearch])

  const customers = needsServerSearch
    ? (serverSearch?.rows ?? [])
    : filtered.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE)
  const total = needsServerSearch ? (serverSearch?.total ?? 0) : filtered.length

  const handleSearch = useCallback((params: CustomerSearchParams) => {
    setPage(0)
    setSearchParams(params)
  }, [])

  const handleClearFilters = useCallback(() => {
    setPage(0)
    setSearchParams({})
  }, [])

  const isLoading = needsServerSearch
    ? serverLoading
    : customersLoading

  const hasActiveFilters = Object.keys(searchParams).some(
    (k) => searchParams[k as keyof CustomerSearchParams] !== undefined,
  )

  return (
    <div className="p-4 md:p-6 space-y-4">
      <PageHeader title="Customers" subtitle="Customer portfolio overview">
        <Link href="/customers/new" className={cn(buttonVariants())}>
          Add Customer
        </Link>
      </PageHeader>

      <CustomerSearchBar onSearch={handleSearch} loading={isLoading} />

      {isLoading ? (
        <div className="space-y-3">
          {[1, 2, 3, 4, 5].map((i) => (
            <div key={i} className="h-12 rounded-md bg-muted-foreground/10 animate-pulse" />
          ))}
        </div>
      ) : customers.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-16 gap-4 text-center">
          {hasActiveFilters ? (
            <>
              <p className="text-muted-foreground">No customers match your search.</p>
              <Button variant="ghost" size="sm" onClick={handleClearFilters}>
                Clear filters
              </Button>
            </>
          ) : (
            <>
              <p className="text-muted-foreground">
                No customers yet. Register your first customer.
              </p>
              <Link href="/customers/new" className={cn(buttonVariants())}>
                Register Customer
              </Link>
            </>
          )}
        </div>
      ) : (
        <div className="transition-opacity">
          <ResponsiveTable
            columns={[
              {
                key: "fullName",
                header: "Name",
                primary: true,
                render: (c) => (
                  <span className="font-medium group-hover/row:underline">
                    {c.fullName}
                  </span>
                ),
              },
              {
                key: "contact",
                header: "Contact",
                render: (c) => c.contact,
              },
              {
                key: "status",
                header: (
                  <span className="inline-flex items-center gap-1">
                    Status
                    <InfoPopover>
                      <p className="font-semibold text-sm mb-1">Customer Status</p>
                      <p className="text-xs text-muted-foreground mb-2">
                        <span className="font-semibold">Active</span> &mdash; Customer
                        is in good standing and eligible for new loans.
                      </p>
                      <p className="text-xs text-muted-foreground mb-2">
                        <span className="font-semibold">Blacklisted</span> &mdash;
                        Customer has been flagged and cannot receive new loans. This
                        is set manually by an admin or loan officer.
                      </p>
                      <p className="text-xs text-muted-foreground">
                        <span className="font-semibold">Inactive</span> &mdash; Customer
                        has no active loans and hasn&apos;t had activity recently.
                      </p>
                    </InfoPopover>
                  </span>
                ),
                render: (c) => (
                  <Badge variant={customerStatusVariant(c.status)}>
                    {customerStatusLabel(c.status)}
                  </Badge>
                ),
              },
            ] as Column<(typeof customers)[number]>[]}
            rows={customers}
            getRowKey={(c) => c.id}
            getRowProps={(c) => ({
              "data-testid": "data-row",
              className: c.id.startsWith("optimistic-")
                ? "opacity-50 cursor-default"
                : "cursor-pointer group/row",
              onClick: c.id.startsWith("optimistic-")
                ? undefined
                : () => router.push(`/customers/${c.id}`),
            })}
          />

          <div className="flex items-center justify-between pt-4">
            <p className="text-sm text-muted-foreground">
              Showing{" "}
              <span className="font-mono tabular-nums">
                {total === 0 ? 0 : page * PAGE_SIZE + 1}&ndash;
                {Math.min((page + 1) * PAGE_SIZE, total)}
              </span>{" "}
              of <span className="font-mono tabular-nums">{total}</span> customers
            </p>
            <div className="flex gap-2">
              <Button
                variant="outline"
                size="sm"
                disabled={page === 0}
                onClick={() => setPage((p) => p - 1)}
              >
                Previous
              </Button>
              <Button
                variant="outline"
                size="sm"
                disabled={(page + 1) * PAGE_SIZE >= total}
                onClick={() => setPage((p) => p + 1)}
              >
                Next
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
