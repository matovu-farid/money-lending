"use client"

import { useState, useCallback, useEffect } from "react"
import { useRouter } from "next/navigation"
import { useQueryClient } from "@tanstack/react-query"
import Link from "next/link"
import { useCustomers } from "@/hooks/use-customers"
import { getCustomerAction } from "@/actions/customer.actions"
import { getCustomerLoansWithOverdueAction } from "@/actions/loan.actions"
import { queryKeys } from "@/hooks/query-keys"
import { unwrapAction } from "@/hooks/query-utils"
import { CustomerSearchBar } from "@/components/customers/customer-search-bar"
import type { CustomerSearchParams, Customer } from "@/types"
import { ResponsiveTable, type Column } from "@/components/ui/responsive-table"
import { Badge } from "@/components/ui/badge"
import { Button, buttonVariants } from "@/components/ui/button"
import { cn } from "@/lib/utils"
import { InfoPopover } from "@/components/ui/info-popover"
import { PageHeader } from "@/components/ui/page-header"
import { customerStatusVariant, customerStatusLabel } from "@/lib/status"
import { prefetchQueue, Priority } from "@/lib/prefetch-queue"

const PAGE_SIZE = 20

export default function CustomersPage() {
  const router = useRouter()
  const queryClient = useQueryClient()
  const [page, setPage] = useState(0)
  const [searchParams, setSearchParams] = useState<CustomerSearchParams>({})

  const { data, isLoading, error } = useCustomers(searchParams, page)
  const customers = data?.rows ?? []
  const total = data?.total ?? 0

  const handleSearch = useCallback((params: CustomerSearchParams) => {
    setPage(0)
    setSearchParams(params)
  }, [])

  const handleClearFilters = useCallback(() => {
    setPage(0)
    setSearchParams({})
  }, [])

  const handlePrefetch = useCallback((customerId: string) => {
    if (customerId.startsWith("optimistic-")) return
    router.prefetch(`/customers/${customerId}`)
    const staleTime = 30_000
    queryClient.prefetchQuery({
      queryKey: queryKeys.customers.detail(customerId),
      queryFn: async () => {
        const result = await getCustomerAction(customerId)
        return unwrapAction(result as { data: Customer } | { error: string })
      },
      staleTime,
    })
    queryClient.prefetchQuery({
      queryKey: queryKeys.loans.byCustomer(customerId),
      queryFn: async () => {
        const result = await getCustomerLoansWithOverdueAction(customerId)
        if (!("data" in result) || !result.data) return []
        return result.data.map((item: any) => ({
          loan: item,
          daysOverdue: item.daysOverdue,
        }))
      },
      staleTime,
    })
  }, [queryClient])

  // Background prefetch each customer's detail + loans via the global queue
  const customerIds = customers
    .filter((c) => !c.id.startsWith("optimistic-"))
    .map((c) => c.id)
    .join(",")
  useEffect(() => {
    if (!customerIds) return
    const ids = customerIds.split(",")
    const staleTime = 30_000

    const timer = setTimeout(() => {
      for (const id of ids) {
        if (queryClient.getQueryData(queryKeys.customers.detail(id))) continue
        prefetchQueue.add(() =>
          queryClient.prefetchQuery({
            queryKey: queryKeys.customers.detail(id),
            queryFn: async () => {
              const result = await getCustomerAction(id)
              return unwrapAction(result as { data: Customer } | { error: string })
            },
            staleTime,
          }), Priority.LOW)
        prefetchQueue.add(() =>
          queryClient.prefetchQuery({
            queryKey: queryKeys.loans.byCustomer(id),
            queryFn: async () => {
              const result = await getCustomerLoansWithOverdueAction(id)
              if (!("data" in result) || !result.data) return []
              return result.data.map((item: any) => ({
                loan: item,
                daysOverdue: item.daysOverdue,
              }))
            },
            staleTime,
          }), Priority.LOW)
      }
    }, 1_000)

    return () => clearTimeout(timer)
  }, [customerIds, queryClient])

  if (error) {
    return (
      <div className="p-4 md:p-6">
        <p className="text-destructive">Error: {error.message}</p>
      </div>
    )
  }

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
        <>
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
        </>
      )}
    </div>
  )
}
