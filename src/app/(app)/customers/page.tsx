"use client"

import { useState, useCallback } from "react"
import { useRouter } from "next/navigation"
import Link from "next/link"
import { useCustomers } from "@/hooks/use-customers"
import { CustomerSearchBar } from "@/components/customers/customer-search-bar"
import type { CustomerSearchParams } from "@/types"
import { ResponsiveTable, type Column } from "@/components/ui/responsive-table"
import { Badge } from "@/components/ui/badge"
import { Button, buttonVariants } from "@/components/ui/button"
import { cn } from "@/lib/utils"

function statusVariant(status: string): "default" | "destructive" | "secondary" {
  if (status === "active") return "default"
  if (status === "blacklisted") return "destructive"
  return "secondary"
}

function statusLabel(status: string): string {
  if (status === "active") return "Active"
  if (status === "blacklisted") return "Blacklisted"
  return "Inactive"
}

const PAGE_SIZE = 20

export default function CustomersPage() {
  const router = useRouter()
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

  if (error) {
    return (
      <div className="p-4 md:p-6">
        <p className="text-destructive">Error: {error.message}</p>
      </div>
    )
  }

  return (
    <div className="p-4 md:p-6 space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Customers</h1>
          <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mt-1">Customer portfolio overview</p>
        </div>
        <Link href="/customers/new" className={cn(buttonVariants())}>
          Add Customer
        </Link>
      </div>

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
                render: (c) => <span className="font-medium">{c.fullName}</span>,
              },
              {
                key: "contact",
                header: "Contact",
                render: (c) => c.contact,
              },
              {
                key: "status",
                header: "Status",
                render: (c) => (
                  <Badge variant={statusVariant(c.status)}>
                    {statusLabel(c.status)}
                  </Badge>
                ),
              },
            ] as Column<typeof customers[number]>[]}
            rows={customers}
            getRowKey={(c) => c.id}
            getRowProps={(c) => ({
              "data-testid": "data-row",
              className: "cursor-pointer",
              onClick: () => router.push(`/customers/${c.id}`),
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
