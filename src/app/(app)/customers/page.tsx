"use client"

import { useEffect, useState, useCallback } from "react"
import { useRouter } from "next/navigation"
import Link from "next/link"
import { searchCustomersAction } from "@/actions/customer.actions"
import { CustomerSearchBar } from "@/components/customers/customer-search-bar"
import type { Customer, CustomerSearchParams } from "@/types"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
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
  const [customers, setCustomers] = useState<Customer[]>([])
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(0)
  const [searchParams, setSearchParams] = useState<CustomerSearchParams>({})
  const [loading, setLoading] = useState(true)
  const [fetchError, setFetchError] = useState<string | null>(null)

  const fetchCustomers = useCallback(async (params: CustomerSearchParams, currentPage: number) => {
    setLoading(true)
    setFetchError(null)
    const result = await searchCustomersAction({ ...params, page: currentPage, pageSize: PAGE_SIZE })
    if ("error" in result) {
      setFetchError(result.error ?? "Unknown error")
    } else {
      setCustomers(result.data.rows)
      setTotal(result.data.total)
    }
    setLoading(false)
  }, [])

  // Initial load
  useEffect(() => {
    fetchCustomers({}, 0)
  }, [fetchCustomers])

  // Re-fetch when page changes
  useEffect(() => {
    fetchCustomers(searchParams, page)
  }, [page, searchParams, fetchCustomers])

  const handleSearch = useCallback((params: CustomerSearchParams) => {
    setPage(0)
    setSearchParams(params)
  }, [])

  const handleClearFilters = useCallback(() => {
    setPage(0)
    setSearchParams({})
  }, [])

  if (fetchError) {
    return (
      <div className="p-6">
        <p className="text-destructive">Error: {fetchError}</p>
      </div>
    )
  }

  return (
    <div className="p-6 space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Customers</h1>
        <Link href="/customers/new" className={cn(buttonVariants())}>
          Add Customer
        </Link>
      </div>

      <CustomerSearchBar onSearch={handleSearch} loading={loading} />

      {loading ? (
        <div>
          <p className="text-muted-foreground">Loading customers...</p>
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
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Contact</TableHead>
                <TableHead>Status</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {customers.map((customer) => (
                <TableRow
                  key={customer.id}
                  className="cursor-pointer"
                  onClick={() => router.push(`/customers/${customer.id}`)}
                >
                  <TableCell className="font-medium">{customer.fullName}</TableCell>
                  <TableCell>{customer.contact}</TableCell>
                  <TableCell>
                    <Badge variant={statusVariant(customer.status)}>
                      {statusLabel(customer.status)}
                    </Badge>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>

          <div className="flex items-center justify-between pt-4">
            <p className="text-sm text-muted-foreground">
              Showing {page * PAGE_SIZE + 1}&ndash;{Math.min((page + 1) * PAGE_SIZE, total)} of {total} customers
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
