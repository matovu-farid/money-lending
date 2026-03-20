"use client"

import { useEffect, useState } from "react"
import { useRouter } from "next/navigation"
import Link from "next/link"
import { listCustomersAction } from "@/actions/customer.actions"
import type { Customer } from "@/types"
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

export default function CustomersPage() {
  const router = useRouter()
  const [customers, setCustomers] = useState<Customer[]>([])
  const [loading, setLoading] = useState(true)
  const [fetchError, setFetchError] = useState<string | null>(null)

  useEffect(() => {
    listCustomersAction().then((result) => {
      if ("error" in result) {
        setFetchError(result.error ?? "Unknown error")
      } else {
        setCustomers(result.data)
      }
      setLoading(false)
    })
  }, [])

  if (loading) {
    return (
      <div className="p-6">
        <p className="text-muted-foreground">Loading customers...</p>
      </div>
    )
  }

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

      {customers.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-16 gap-4 text-center">
          <p className="text-muted-foreground">
            No customers yet. Register your first customer.
          </p>
          <Link href="/customers/new" className={cn(buttonVariants())}>
            Register Customer
          </Link>
        </div>
      ) : (
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
      )}
    </div>
  )
}
