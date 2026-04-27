"use client"

import { useState, useCallback, useMemo } from "react"
import { useRouter } from "next/navigation"
import Link from "next/link"
import { useLiveQuery } from "@tanstack/react-db"
import { customerCollection } from "@/collections/customers"
import { loanCollection } from "@/collections/loans"
import { CustomerSearchBar } from "@/components/customers/customer-search-bar"
import type { CustomerSearchParams } from "@/types"
import { ResponsiveTable, type Column } from "@/components/ui/responsive-table"
import { Badge } from "@/components/ui/badge"
import { Button, buttonVariants } from "@/components/ui/button"
import { cn } from "@/lib/utils"
import { InfoPopover } from "@/components/ui/info-popover"
import { PageHeader } from "@/components/ui/page-header"
import { customerStatusVariant, customerStatusLabel } from "@/lib/status"

const PAGE_SIZE = 20

export default function CustomersPage() {
  const router = useRouter()
  const [page, setPage] = useState(0)
  const [searchParams, setSearchParams] = useState<CustomerSearchParams>({})

  const { data: allCustomers, isLoading: customersLoading } = useLiveQuery((q) =>
    q.from({ c: customerCollection }).select(({ c }) => c)
  )

  // Only sync the loan collection when a loan-based filter is active. The
  // loan collection is backed by a slow server action (listLoansWithOverdueAction);
  // pulling it on every customers-page visit was the main source of latency.
  const needsLoans =
    !!searchParams.loanStatus?.length ||
    (!!searchParams.daysRemainingFilter && searchParams.daysRemainingFilter !== "any")

  const { data: allLoans, isLoading: loansLoading } = useLiveQuery(
    (q) =>
      needsLoans
        ? q.from({ l: loanCollection }).select(({ l }) => l)
        : undefined,
    [needsLoans]
  )

  // Client-side filtering
  const filtered = useMemo(() => {
    let result = allCustomers ?? []
    if (searchParams.name) {
      const term = searchParams.name.toLowerCase()
      result = result.filter((c) =>
        c.fullName.toLowerCase().includes(term)
      )
    }
    if (searchParams.status?.length) {
      result = result.filter((c) => searchParams.status!.includes(c.status))
    }

    // Cross-reference with loans for loan-based filters
    const loans = allLoans ?? []
    if (searchParams.loanStatus?.length) {
      const customerIdsWithMatchingLoans = new Set(
        loans
          .filter((l) => searchParams.loanStatus!.includes(l.status))
          .map((l) => l.customerId)
      )
      result = result.filter((c) => customerIdsWithMatchingLoans.has(c.id))
    }
    if (searchParams.daysRemainingFilter && searchParams.daysRemainingFilter !== "any") {
      const matchingCustomerIds = new Set(
        loans
          .filter((l) => {
            if (l.status !== "active") return false
            if (searchParams.daysRemainingFilter === "due_within_30") {
              return l.daysOverdue === 0
            }
            if (searchParams.daysRemainingFilter === "overdue_30_plus") {
              return l.daysOverdue >= 30
            }
            return false
          })
          .map((l) => l.customerId)
      )
      result = result.filter((c) => matchingCustomerIds.has(c.id))
    }

    return result
  }, [allCustomers, allLoans, searchParams])

  // Client-side pagination
  const customers = filtered.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE)
  const total = filtered.length

  const handleSearch = useCallback((params: CustomerSearchParams) => {
    setPage(0)
    setSearchParams(params)
  }, [])

  const handleClearFilters = useCallback(() => {
    setPage(0)
    setSearchParams({})
  }, [])

  const isLoading = customersLoading || (needsLoans && loansLoading)

  const handlePrefetch = useCallback((customerId: string) => {
    if (customerId.startsWith("optimistic-")) return
    router.prefetch(`/customers/${customerId}`)
  }, [router])

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
          {Object.keys(searchParams).some((k) => searchParams[k as keyof CustomerSearchParams] !== undefined) ? (
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
                render: (c) => <span className="font-medium group-hover/row:underline">{c.fullName}</span>,
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
                        <span className="font-semibold">Active</span> &mdash; Customer is in good standing and eligible for new loans.
                      </p>
                      <p className="text-xs text-muted-foreground mb-2">
                        <span className="font-semibold">Blacklisted</span> &mdash; Customer has been flagged and cannot receive new loans. This is set manually by an admin or loan officer.
                      </p>
                      <p className="text-xs text-muted-foreground">
                        <span className="font-semibold">Inactive</span> &mdash; Customer has no active loans and hasn&apos;t had activity recently.
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
            ] as Column<typeof customers[number]>[]}
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
              onMouseEnter: () => handlePrefetch(c.id),
              onFocus: () => handlePrefetch(c.id),
            })}
          />

          <div className="flex items-center justify-between pt-4">
            <p className="text-sm text-muted-foreground">
              Showing <span className="font-mono tabular-nums">{page * PAGE_SIZE + 1}&ndash;{Math.min((page + 1) * PAGE_SIZE, total)}</span> of <span className="font-mono tabular-nums">{total}</span> customers
            </p>
            <div className="flex gap-2">
              <Button variant="outline" size="sm" disabled={page === 0} onClick={() => setPage(p => p - 1)}>
                Previous
              </Button>
              <Button variant="outline" size="sm" disabled={(page + 1) * PAGE_SIZE >= total} onClick={() => setPage(p => p + 1)}>
                Next
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
