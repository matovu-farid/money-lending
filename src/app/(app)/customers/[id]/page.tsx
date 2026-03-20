"use client"

import { useEffect, useState } from "react"
import { useParams, useRouter } from "next/navigation"
import Link from "next/link"
import { toast } from "sonner"
import { getCustomerAction, updateCustomerAction } from "@/actions/customer.actions"
import { listLoansAction } from "@/actions/loan.actions"
import type { Customer, Loan } from "@/types"
import { Badge } from "@/components/ui/badge"
import { Button, buttonVariants } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { cn } from "@/lib/utils"

function formatUGX(amount: string | number): string {
  const num = typeof amount === "string" ? parseFloat(amount) : amount
  return new Intl.NumberFormat("en-UG", { style: "decimal", maximumFractionDigits: 0 }).format(num)
}

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

function loanStatusVariant(status: string): "default" | "secondary" | "outline" {
  if (status === "active") return "default"
  if (status === "pending") return "secondary"
  return "outline"
}

export default function CustomerProfilePage() {
  const params = useParams()
  const router = useRouter()
  const customerId = params.id as string

  const [customer, setCustomer] = useState<Customer | null>(null)
  const [loans, setLoans] = useState<Loan[]>([])
  const [loading, setLoading] = useState(true)
  const [notFound, setNotFound] = useState(false)

  // Edit state
  const [editing, setEditing] = useState(false)
  const [editFullName, setEditFullName] = useState("")
  const [editContact, setEditContact] = useState("")
  const [editAddress, setEditAddress] = useState("")
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    async function fetchData() {
      const [customerResult, loansResult] = await Promise.all([
        getCustomerAction(customerId),
        listLoansAction(),
      ])

      if ("error" in customerResult) {
        setNotFound(true)
        setLoading(false)
        return
      }

      const fetchedCustomer = customerResult.data
      setCustomer(fetchedCustomer)
      setEditFullName(fetchedCustomer.fullName)
      setEditContact(fetchedCustomer.contact)
      setEditAddress(fetchedCustomer.address)

      if ("data" in loansResult && loansResult.data) {
        const customerLoans = loansResult.data.filter(
          (l) => l.customerId === customerId
        )
        setLoans(customerLoans)
      }

      setLoading(false)
    }

    fetchData()
  }, [customerId])

  function handleEditStart() {
    if (!customer) return
    setEditFullName(customer.fullName)
    setEditContact(customer.contact)
    setEditAddress(customer.address)
    setEditing(true)
  }

  function handleEditCancel() {
    setEditing(false)
  }

  async function handleEditSave() {
    if (!customer) return
    setSaving(true)

    const result = await updateCustomerAction(customerId, {
      fullName: editFullName.trim() || undefined,
      contact: editContact.trim() || undefined,
      address: editAddress.trim() || undefined,
    })

    setSaving(false)

    if ("error" in result) {
      toast.error(result.error)
      return
    }

    setCustomer(result.data)
    setEditing(false)
    toast.success("Customer updated successfully")
  }

  const activeLoan = loans.find((l) => l.status === "active")

  if (loading) {
    return (
      <div className="p-6">
        <p className="text-muted-foreground">Loading customer...</p>
      </div>
    )
  }

  if (notFound || !customer) {
    return (
      <div className="p-6 space-y-4">
        <p className="text-destructive">Customer not found.</p>
        <Button variant="outline" onClick={() => router.push("/customers")}>
          Back to Customers
        </Button>
      </div>
    )
  }

  return (
    <div className="p-6 space-y-6 max-w-2xl">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">{customer.fullName}</h1>
          <p className="text-muted-foreground text-sm mt-0.5">Customer Profile</p>
        </div>
        <Link
          href={`/loans/new?customerId=${customerId}`}
          className={cn(buttonVariants())}
        >
          Issue New Loan
        </Link>
      </div>

      {/* Basic Info */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle>Basic Information</CardTitle>
            {!editing && (
              <Button variant="outline" size="sm" onClick={handleEditStart}>
                Edit
              </Button>
            )}
          </div>
        </CardHeader>
        <CardContent>
          {editing ? (
            <div className="space-y-4">
              <div className="space-y-1">
                <Label htmlFor="edit-fullName">Full Name</Label>
                <Input
                  id="edit-fullName"
                  value={editFullName}
                  onChange={(e) => setEditFullName(e.target.value)}
                  disabled={saving}
                />
              </div>
              <div className="space-y-1">
                <Label htmlFor="edit-contact">Contact</Label>
                <Input
                  id="edit-contact"
                  value={editContact}
                  onChange={(e) => setEditContact(e.target.value)}
                  disabled={saving}
                />
              </div>
              <div className="space-y-1">
                <Label htmlFor="edit-address">Physical Address</Label>
                <Input
                  id="edit-address"
                  value={editAddress}
                  onChange={(e) => setEditAddress(e.target.value)}
                  disabled={saving}
                />
              </div>
              <div className="flex gap-3">
                <Button onClick={handleEditSave} disabled={saving}>
                  {saving ? "Saving..." : "Save"}
                </Button>
                <Button variant="outline" onClick={handleEditCancel} disabled={saving}>
                  Cancel
                </Button>
              </div>
            </div>
          ) : (
            <dl className="space-y-3 text-sm">
              <div>
                <dt className="text-muted-foreground">Full Name</dt>
                <dd className="font-medium">{customer.fullName}</dd>
              </div>
              <div>
                <dt className="text-muted-foreground">Contact</dt>
                <dd className="font-medium">{customer.contact}</dd>
              </div>
              <div>
                <dt className="text-muted-foreground">Physical Address</dt>
                <dd className="font-medium">{customer.address}</dd>
              </div>
            </dl>
          )}
        </CardContent>
      </Card>

      {/* Status Badge */}
      <Card>
        <CardHeader>
          <CardTitle>Status</CardTitle>
        </CardHeader>
        <CardContent>
          <Badge variant={statusVariant(customer.status)}>
            {statusLabel(customer.status)}
          </Badge>
          <p className="text-xs text-muted-foreground mt-2">
            Status management is available in a future update.
          </p>
        </CardContent>
      </Card>

      {/* Active Loan Summary */}
      <Card>
        <CardHeader>
          <CardTitle>Active Loan</CardTitle>
        </CardHeader>
        <CardContent>
          {activeLoan ? (
            <dl className="space-y-3 text-sm">
              <div>
                <dt className="text-muted-foreground">Principal Amount</dt>
                <dd className="font-medium">UGX {formatUGX(activeLoan.principalAmount)}</dd>
              </div>
              <div>
                <dt className="text-muted-foreground">Outstanding Balance</dt>
                <dd className="font-medium">UGX {formatUGX(activeLoan.principalAmount)}</dd>
              </div>
              <div>
                <dt className="text-muted-foreground">Status</dt>
                <dd>
                  <Badge variant={loanStatusVariant(activeLoan.status)}>
                    {activeLoan.status === "fully_paid"
                      ? "Fully Paid"
                      : activeLoan.status.charAt(0).toUpperCase() + activeLoan.status.slice(1)}
                  </Badge>
                </dd>
              </div>
              <div>
                <dt className="text-muted-foreground">Interest Rate</dt>
                <dd className="font-medium">
                  {(parseFloat(activeLoan.interestRate) * 100).toFixed(0)}% per month
                </dd>
              </div>
            </dl>
          ) : (
            <p className="text-sm text-muted-foreground">No active loans.</p>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
