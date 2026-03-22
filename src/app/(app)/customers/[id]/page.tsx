"use client"

import { useEffect, useState, useCallback, useTransition } from "react"
import { useParams, useRouter } from "next/navigation"
import Link from "next/link"
import { toast } from "sonner"
import { ChevronDown, ChevronUp, Loader2 } from "lucide-react"
import { getCustomerAction, updateCustomerAction, changeCustomerStatusAction } from "@/actions/customer.actions"
import { listLoansAction } from "@/actions/loan.actions"
import { getPaymentsByLoanAction } from "@/actions/payment.actions"
import { OverdueBadge } from "@/components/watchlist/overdue-badge"
import { calculateDaysOverdue, calculateDailyRate, calculateInterest } from "@/lib/interest"
import BigNumber from "bignumber.js"
import type { Customer, Loan, Payment, CustomerStatus } from "@/types"
import { Badge } from "@/components/ui/badge"
import { Button, buttonVariants } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
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

function loanStatusLabel(status: string): string {
  if (status === "fully_paid") return "Fully Paid"
  return status.charAt(0).toUpperCase() + status.slice(1)
}

function formatDate(date: Date | string): string {
  return new Date(date).toLocaleDateString("en-UG", {
    year: "numeric",
    month: "short",
    day: "numeric",
  })
}

interface LoanWithPayments {
  loan: Loan
  payments: Payment[]
  expanded: boolean
  loadingPayments: boolean
  daysOverdue: number
}

export default function CustomerProfilePage() {
  const params = useParams()
  const router = useRouter()
  const customerId = params.id as string

  const [customer, setCustomer] = useState<Customer | null>(null)
  const [loanItems, setLoanItems] = useState<LoanWithPayments[]>([])
  const [loading, setLoading] = useState(true)
  const [notFound, setNotFound] = useState(false)

  // Edit state
  const [editing, setEditing] = useState(false)
  const [editFullName, setEditFullName] = useState("")
  const [editContact, setEditContact] = useState("")
  const [editAddress, setEditAddress] = useState("")
  const [isEditPending, startEditTransition] = useTransition()

  // Status change state
  const [statusDialogOpen, setStatusDialogOpen] = useState(false)
  const [pendingStatus, setPendingStatus] = useState<CustomerStatus | null>(null)
  const [statusReason, setStatusReason] = useState("")
  const [isStatusPending, startStatusTransition] = useTransition()

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

        const now = new Date()

        const items: LoanWithPayments[] = customerLoans.map((loan) => {
          const totalDaysElapsed = Math.floor(
            (now.getTime() - new Date(loan.startDate).getTime()) / (1000 * 60 * 60 * 24)
          )
          const effectiveRate = loan.interestRateOverride ?? loan.interestRate
          const effectiveMinDays = loan.minPeriodOverride ?? loan.minInterestDays
          const totalInterestAccrued = calculateInterest(
            loan.principalAmount, effectiveRate, totalDaysElapsed, effectiveMinDays
          )
          const dailyRate = calculateDailyRate(effectiveRate)
          const daysOverdueBN = calculateDaysOverdue(
            totalInterestAccrued.toFixed(2), "0", dailyRate.toFixed(10)
          )

          return {
            loan,
            payments: [],
            expanded: false,
            loadingPayments: false,
            daysOverdue: loan.status === "active" ? daysOverdueBN.toNumber() : 0,
          }
        })

        setLoanItems(items)
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

  function handleEditSave() {
    if (!customer) return
    startEditTransition(async () => {
      const result = await updateCustomerAction(customerId, {
        fullName: editFullName.trim() || undefined,
        contact: editContact.trim() || undefined,
        address: editAddress.trim() || undefined,
      })

      if ("error" in result) {
        toast.error(result.error)
        return
      }

      setCustomer(result.data)
      setEditing(false)
      toast.success("Customer updated successfully")
    })
  }

  function handleStatusSelect(newStatus: string | null) {
    if (!newStatus || !customer) return
    if (newStatus === customer.status) return
    setPendingStatus(newStatus as CustomerStatus)
    setStatusReason("")
    setStatusDialogOpen(true)
  }

  function handleStatusConfirm() {
    if (!customer || !pendingStatus || statusReason.trim().length < 10) return
    startStatusTransition(async () => {
      const result = await changeCustomerStatusAction({
        customerId: customer.id,
        newStatus: pendingStatus,
        reason: statusReason,
      })
      if ("error" in result) {
        toast.error(result.error)
        return
      }
      setCustomer(result.data)
      setStatusDialogOpen(false)
      toast.success(`${customer.fullName}'s status updated to ${statusLabel(pendingStatus)}.`)
      setPendingStatus(null)
      setStatusReason("")
    })
  }

  function handleStatusCancel() {
    setStatusDialogOpen(false)
    setPendingStatus(null)
    setStatusReason("")
  }

  async function handleToggleLoan(index: number) {
    const item = loanItems[index]
    if (!item) return

    if (item.expanded) {
      setLoanItems((prev) =>
        prev.map((li, i) => (i === index ? { ...li, expanded: false } : li))
      )
      return
    }

    if (item.payments.length === 0) {
      setLoanItems((prev) =>
        prev.map((li, i) => (i === index ? { ...li, loadingPayments: true, expanded: true } : li))
      )

      const result = await getPaymentsByLoanAction(item.loan.id)
      if ("data" in result && result.data) {
        const fetchedPayments = result.data
        const now = new Date()
        const loan = item.loan
        const effectiveRate = loan.interestRateOverride ?? loan.interestRate
        const effectiveMinDays = loan.minPeriodOverride ?? loan.minInterestDays
        const totalDaysElapsed = Math.floor(
          (now.getTime() - new Date(loan.startDate).getTime()) / (1000 * 60 * 60 * 24)
        )
        const totalInterestAccrued = calculateInterest(
          loan.principalAmount, effectiveRate, totalDaysElapsed, effectiveMinDays
        )
        const activePayments = fetchedPayments.filter((p) => !p.deletedAt)
        const totalInterestPaid = activePayments.reduce(
          (s, p) => s.plus(new BigNumber(p.interestPortion)), new BigNumber(0)
        )
        const dailyRate = calculateDailyRate(effectiveRate)
        const daysOverdueBN = calculateDaysOverdue(
          totalInterestAccrued.toFixed(2), totalInterestPaid.toFixed(2), dailyRate.toFixed(10)
        )

        setLoanItems((prev) =>
          prev.map((li, i) =>
            i === index
              ? {
                  ...li,
                  payments: fetchedPayments,
                  loadingPayments: false,
                  daysOverdue: loan.status === "active" ? daysOverdueBN.toNumber() : 0,
                }
              : li
          )
        )
      } else {
        setLoanItems((prev) =>
          prev.map((li, i) => (i === index ? { ...li, loadingPayments: false } : li))
        )
      }
    } else {
      setLoanItems((prev) =>
        prev.map((li, i) => (i === index ? { ...li, expanded: true } : li))
      )
    }
  }

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

  const isBlacklisted = pendingStatus === "blacklisted"
  const dialogTitle = isBlacklisted
    ? `Blacklist ${customer.fullName}?`
    : `Change status to ${pendingStatus ? statusLabel(pendingStatus) : ""}?`

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
                  disabled={isEditPending}
                />
              </div>
              <div className="space-y-1">
                <Label htmlFor="edit-contact">Contact</Label>
                <Input
                  id="edit-contact"
                  value={editContact}
                  onChange={(e) => setEditContact(e.target.value)}
                  disabled={isEditPending}
                />
              </div>
              <div className="space-y-1">
                <Label htmlFor="edit-address">Physical Address</Label>
                <Input
                  id="edit-address"
                  value={editAddress}
                  onChange={(e) => setEditAddress(e.target.value)}
                  disabled={isEditPending}
                />
              </div>
              <div className="flex gap-3">
                <Button onClick={handleEditSave} disabled={isEditPending}>
                  {isEditPending ? (
                    <>
                      <Loader2 className="animate-spin mr-2 h-4 w-4" />
                      Saving...
                    </>
                  ) : (
                    "Save"
                  )}
                </Button>
                <Button variant="outline" onClick={handleEditCancel} disabled={isEditPending}>
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

      {/* Status — interactive dropdown */}
      <Card>
        <CardHeader>
          <CardTitle>Status</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          <Select value={customer.status} onValueChange={handleStatusSelect}>
            <SelectTrigger className="w-[200px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="active">Active</SelectItem>
              <SelectItem value="blacklisted">Blacklisted</SelectItem>
              <SelectItem value="inactive">Inactive</SelectItem>
            </SelectContent>
          </Select>
        </CardContent>
      </Card>

      {/* Status change confirmation dialog */}
      <Dialog open={statusDialogOpen} onOpenChange={(open) => { if (!open) handleStatusCancel() }}>
        <DialogContent showCloseButton={false}>
          <DialogHeader>
            <DialogTitle className={isBlacklisted ? "text-destructive" : undefined}>
              {dialogTitle}
            </DialogTitle>
            {isBlacklisted && (
              <DialogDescription>
                This will prevent {customer.fullName} from receiving new loans. Active loans will continue. Provide a reason.
              </DialogDescription>
            )}
          </DialogHeader>

          <div className="space-y-2">
            <Label htmlFor="status-reason">Reason (min 10 characters)</Label>
            <Textarea
              id="status-reason"
              value={statusReason}
              onChange={(e) => setStatusReason(e.target.value)}
              placeholder="Provide a reason for this status change..."
              disabled={isStatusPending}
            />
            {statusReason.trim().length > 0 && statusReason.trim().length < 10 && (
              <p className="text-xs text-destructive">Reason must be at least 10 characters</p>
            )}
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={handleStatusCancel} disabled={isStatusPending}>
              Cancel
            </Button>
            <Button
              variant={isBlacklisted ? "destructive" : "default"}
              onClick={handleStatusConfirm}
              disabled={isStatusPending || statusReason.trim().length < 10}
            >
              {isStatusPending ? (
                <>
                  <Loader2 className="animate-spin mr-2 h-4 w-4" />
                  Saving...
                </>
              ) : (
                "Confirm"
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Loan History */}
      <div className="space-y-4">
        <h2 className="text-xl font-semibold">Loan History</h2>

        {loanItems.length === 0 ? (
          <p className="text-sm text-muted-foreground">No loans on record for this customer.</p>
        ) : (
          loanItems.map((item, index) => (
            <Card key={item.loan.id}>
              <CardHeader>
                <div className="flex items-start justify-between gap-4">
                  <div className="space-y-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-sm font-mono text-muted-foreground">
                        LOAN-{item.loan.id.slice(0, 8).toUpperCase()}
                      </span>
                      <Badge variant={loanStatusVariant(item.loan.status)}>
                        {loanStatusLabel(item.loan.status)}
                      </Badge>
                      {item.loan.status === "active" && item.daysOverdue > 0 && (
                        <OverdueBadge daysOverdue={Math.round(item.daysOverdue)} />
                      )}
                    </div>
                    <p className="text-xs text-muted-foreground">
                      Issued {formatDate(item.loan.startDate)}
                    </p>
                  </div>
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    onClick={() => handleToggleLoan(index)}
                    aria-label={item.expanded ? "Collapse" : "Expand"}
                  >
                    {item.expanded ? (
                      <ChevronUp className="h-4 w-4" />
                    ) : (
                      <ChevronDown className="h-4 w-4" />
                    )}
                  </Button>
                </div>
              </CardHeader>
              <CardContent>
                <div className="space-y-1">
                  <p className="text-2xl font-semibold">
                    UGX {formatUGX(item.loan.principalAmount)}
                  </p>
                  <p className="text-sm text-muted-foreground">
                    {(parseFloat(item.loan.interestRate) * 100).toFixed(0)}% per month
                  </p>
                </div>

                {item.expanded && (
                  <div className="mt-4">
                    {item.loadingPayments ? (
                      <p className="text-sm text-muted-foreground">Loading payments...</p>
                    ) : item.payments.length === 0 ? (
                      <p className="text-sm text-muted-foreground">No payments recorded.</p>
                    ) : (
                      <Table>
                        <TableHeader>
                          <TableRow>
                            <TableHead>Date</TableHead>
                            <TableHead className="text-right">Amount</TableHead>
                            <TableHead className="text-right">Interest</TableHead>
                            <TableHead className="text-right">Principal</TableHead>
                            <TableHead className="text-right">Balance After</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {item.payments.map((payment) => (
                            <TableRow
                              key={payment.id}
                              className={cn(payment.deletedAt && "opacity-60")}
                            >
                              <TableCell className={cn(payment.deletedAt && "line-through text-muted-foreground")}>
                                {formatDate(payment.paymentDate)}
                              </TableCell>
                              <TableCell className={cn("text-right", payment.deletedAt && "line-through text-muted-foreground")}>
                                UGX {formatUGX(payment.amount)}
                              </TableCell>
                              <TableCell className={cn("text-right", payment.deletedAt && "line-through text-muted-foreground")}>
                                UGX {formatUGX(payment.interestPortion)}
                              </TableCell>
                              <TableCell className={cn("text-right", payment.deletedAt && "line-through text-muted-foreground")}>
                                UGX {formatUGX(payment.principalPortion)}
                              </TableCell>
                              <TableCell className={cn("text-right", payment.deletedAt && "line-through text-muted-foreground")}>
                                UGX {formatUGX(payment.principalBalanceAfter)}
                              </TableCell>
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                    )}
                  </div>
                )}
              </CardContent>
            </Card>
          ))
        )}
      </div>
    </div>
  )
}
