"use client"

import { useCallback, useEffect, useRef, useState, useTransition } from "react"
import { useRouter, useSearchParams } from "next/navigation"
import { useQuery, useQueryClient } from "@tanstack/react-query"
import { toast } from "sonner"
import { Download, MoreHorizontal } from "lucide-react"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetFooter,
} from "@/components/ui/sheet"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { listPaymentsAction, editPaymentAction, deletePaymentAction } from "@/actions/payment.actions"
import { useSession } from "@/lib/auth-client"
import { formatNumberWithCommas, formatDate } from "@/lib/utils"
import { ROLE_LEVELS, type UserRole, type PaymentWithCustomer, type ListPaymentsInput } from "@/types"

interface PaymentsClientProps {
  initialData: { rows: PaymentWithCustomer[]; total: number }
  initialPage: number
  initialFilters: ListPaymentsInput
}

function exportToCsv(rows: PaymentWithCustomer[]) {
  const headers = ["Date", "Customer", "Loan Ref", "Amount", "Interest", "Principal", "Balance After"]
  const csvLines = [
    headers.join(","),
    ...rows.map((r) => [
      formatDate(r.paymentDate),
      `"${r.customerName}"`,
      `LOAN-${r.loanId.slice(0, 8).toUpperCase()}`,
      r.amount,
      r.interestPortion,
      r.principalPortion,
      r.principalBalanceAfter,
    ].join(","))
  ]
  const blob = new Blob([csvLines.join("\n")], { type: "text/csv" })
  const url = URL.createObjectURL(blob)
  const a = document.createElement("a")
  a.href = url
  a.download = `payments-${new Date().toISOString().slice(0, 10)}.csv`
  a.click()
  URL.revokeObjectURL(url)
}

export function PaymentsClient({ initialData, initialPage, initialFilters }: PaymentsClientProps) {
  const router = useRouter()
  const searchParams = useSearchParams()
  const queryClient = useQueryClient()
  const { data: session } = useSession()

  const isAdmin =
    ROLE_LEVELS[(session?.user?.role ?? "unassigned") as UserRole] >= ROLE_LEVELS.admin

  // Filter state (initialized from server-rendered filters)
  const [customerName, setCustomerName] = useState(initialFilters.customerName ?? "")
  const [dateFrom, setDateFrom] = useState(initialFilters.dateFrom ?? "")
  const [dateTo, setDateTo] = useState(initialFilters.dateTo ?? "")
  const [amountMin, setAmountMin] = useState(initialFilters.amountMin ?? "")
  const [amountMax, setAmountMax] = useState(initialFilters.amountMax ?? "")
  const [page, setPage] = useState(initialPage)

  // Edit sheet state
  const [editOpen, setEditOpen] = useState(false)
  const [selectedPayment, setSelectedPayment] = useState<PaymentWithCustomer | null>(null)
  const [editAmount, setEditAmount] = useState("")
  const [editDate, setEditDate] = useState("")
  const [editReason, setEditReason] = useState("")
  const [isEditPending, startEditTransition] = useTransition()

  // Delete dialog state
  const [deleteOpen, setDeleteOpen] = useState(false)
  const [deleteTarget, setDeleteTarget] = useState<PaymentWithCustomer | null>(null)
  const [deleteReason, setDeleteReason] = useState("")
  const [isDeletePending, startDeleteTransition] = useTransition()

  const debounceTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const hasFilters =
    customerName !== "" || dateFrom !== "" || dateTo !== "" || amountMin !== "" || amountMax !== ""

  // TanStack Query for paginated data
  const { data, isLoading, isError } = useQuery({
    queryKey: ["payments", page, dateFrom, dateTo, amountMin, amountMax, customerName],
    queryFn: async () => {
      const result = await listPaymentsAction({
        page,
        pageSize: 25,
        dateFrom: dateFrom || undefined,
        dateTo: dateTo || undefined,
        amountMin: amountMin || undefined,
        amountMax: amountMax || undefined,
        customerName: customerName || undefined,
      })
      if ("error" in result) throw new Error(result.error)
      return result.data
    },
    initialData: page === initialPage &&
      customerName === (initialFilters.customerName ?? "") &&
      dateFrom === (initialFilters.dateFrom ?? "") &&
      dateTo === (initialFilters.dateTo ?? "") &&
      amountMin === (initialFilters.amountMin ?? "") &&
      amountMax === (initialFilters.amountMax ?? "")
      ? initialData
      : undefined,
  })

  const rows = data?.rows ?? []
  const total = data?.total ?? 0

  // Sync filter state with URL after debounce
  const applyFilters = useCallback(
    (
      newCustomerName: string,
      newDateFrom: string,
      newDateTo: string,
      newAmountMin: string,
      newAmountMax: string
    ) => {
      const params = new URLSearchParams(searchParams.toString())
      if (newCustomerName) params.set("customerName", newCustomerName)
      else params.delete("customerName")
      if (newDateFrom) params.set("dateFrom", newDateFrom)
      else params.delete("dateFrom")
      if (newDateTo) params.set("dateTo", newDateTo)
      else params.delete("dateTo")
      if (newAmountMin) params.set("amountMin", newAmountMin)
      else params.delete("amountMin")
      if (newAmountMax) params.set("amountMax", newAmountMax)
      else params.delete("amountMax")
      params.delete("page")
      setPage(1)
      router.push(`/payments?${params.toString()}`)
    },
    [router, searchParams]
  )

  const scheduleApply = useCallback(
    (
      newCustomerName: string,
      newDateFrom: string,
      newDateTo: string,
      newAmountMin: string,
      newAmountMax: string
    ) => {
      if (debounceTimer.current) clearTimeout(debounceTimer.current)
      debounceTimer.current = setTimeout(() => {
        applyFilters(newCustomerName, newDateFrom, newDateTo, newAmountMin, newAmountMax)
      }, 300)
    },
    [applyFilters]
  )

  useEffect(() => {
    return () => {
      if (debounceTimer.current) clearTimeout(debounceTimer.current)
    }
  }, [])

  function handleCustomerNameChange(e: React.ChangeEvent<HTMLInputElement>) {
    const v = e.target.value
    setCustomerName(v)
    scheduleApply(v, dateFrom, dateTo, amountMin, amountMax)
  }

  function handleDateFromChange(e: React.ChangeEvent<HTMLInputElement>) {
    const v = e.target.value
    setDateFrom(v)
    scheduleApply(customerName, v, dateTo, amountMin, amountMax)
  }

  function handleDateToChange(e: React.ChangeEvent<HTMLInputElement>) {
    const v = e.target.value
    setDateTo(v)
    scheduleApply(customerName, dateFrom, v, amountMin, amountMax)
  }

  function handleAmountMinChange(e: React.ChangeEvent<HTMLInputElement>) {
    const v = e.target.value
    setAmountMin(v)
    scheduleApply(customerName, dateFrom, dateTo, v, amountMax)
  }

  function handleAmountMaxChange(e: React.ChangeEvent<HTMLInputElement>) {
    const v = e.target.value
    setAmountMax(v)
    scheduleApply(customerName, dateFrom, dateTo, amountMin, v)
  }

  function handleClearFilters() {
    setCustomerName("")
    setDateFrom("")
    setDateTo("")
    setAmountMin("")
    setAmountMax("")
    setPage(1)
    router.push("/payments")
  }

  function handlePageChange(newPage: number) {
    const params = new URLSearchParams(searchParams.toString())
    params.set("page", String(newPage))
    setPage(newPage)
    router.push(`/payments?${params.toString()}`)
  }

  function openEditSheet(payment: PaymentWithCustomer) {
    setSelectedPayment(payment)
    setEditAmount(payment.amount)
    setEditDate(
      payment.paymentDate instanceof Date
        ? payment.paymentDate.toISOString().slice(0, 10)
        : String(payment.paymentDate).slice(0, 10)
    )
    setEditReason("")
    setEditOpen(true)
  }

  function openDeleteDialog(payment: PaymentWithCustomer) {
    setDeleteTarget(payment)
    setDeleteReason("")
    setDeleteOpen(true)
  }

  function handleEditSubmit() {
    if (!selectedPayment) return
    startEditTransition(async () => {
      const result = await editPaymentAction({
        paymentId: selectedPayment.id,
        amount: editAmount || undefined,
        paymentDate: editDate || undefined,
        reason: editReason,
      })
      if ("error" in result) {
        toast.error(result.error ?? "Failed to update payment")
        return
      }
      toast.success("Payment updated")
      setEditOpen(false)
      queryClient.invalidateQueries({ queryKey: ["payments"] })
    })
  }

  function handleDeleteSubmit() {
    if (!deleteTarget) return
    startDeleteTransition(async () => {
      const result = await deletePaymentAction({
        paymentId: deleteTarget.id,
        reason: deleteReason,
      })
      if ("error" in result) {
        toast.error("Failed to delete payment")
        return
      }
      toast.success("Payment deleted")
      setDeleteOpen(false)
      queryClient.invalidateQueries({ queryKey: ["payments"] })
    })
  }

  const pageSize = 25
  const start = (page - 1) * pageSize + 1
  const end = Math.min(page * pageSize, total)

  return (
    <div className="space-y-4">
      {/* Page header */}
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Payments</h1>
        <Button
          variant="outline"
          disabled={rows.length === 0}
          onClick={() => exportToCsv(rows)}
        >
          <Download className="h-4 w-4 mr-2" />
          Export CSV
        </Button>
      </div>

      {/* Filter bar */}
      <div className="flex flex-wrap items-end gap-3">
        <div>
          <Label className="text-sm">Search by customer name...</Label>
          <Input
            placeholder="Search by customer name..."
            value={customerName}
            onChange={handleCustomerNameChange}
            className="w-[220px]"
          />
        </div>
        <div>
          <Label className="text-sm">From</Label>
          <input
            type="date"
            className="h-8 w-[160px] rounded-md border border-input bg-background px-3 text-sm"
            value={dateFrom}
            onChange={handleDateFromChange}
          />
        </div>
        <div>
          <Label className="text-sm">To</Label>
          <input
            type="date"
            className="h-8 w-[160px] rounded-md border border-input bg-background px-3 text-sm"
            value={dateTo}
            onChange={handleDateToChange}
          />
        </div>
        <div>
          <Label className="text-sm">Min amount</Label>
          <Input
            type="text"
            inputMode="numeric"
            className="w-[120px]"
            value={amountMin}
            onChange={handleAmountMinChange}
            placeholder="0"
          />
        </div>
        <div>
          <Label className="text-sm">Max amount</Label>
          <Input
            type="text"
            inputMode="numeric"
            className="w-[120px]"
            value={amountMax}
            onChange={handleAmountMaxChange}
            placeholder="Any"
          />
        </div>
        {hasFilters && (
          <Button
            variant="ghost"
            size="sm"
            className="text-muted-foreground"
            onClick={handleClearFilters}
          >
            Clear filters
          </Button>
        )}
      </div>

      {/* Content */}
      {isLoading ? (
        <p className="text-muted-foreground p-6">Loading payments...</p>
      ) : isError ? (
        <p className="text-muted-foreground p-6">
          Failed to load payments. Refresh the page or contact support if the problem persists.
        </p>
      ) : total === 0 ? (
        hasFilters ? (
          <div className="py-16 flex flex-col items-center text-center">
            <p className="text-lg font-medium">No payments match your filters</p>
            <p className="text-muted-foreground mt-2">
              Try adjusting the date range, amount range, or customer name search.
            </p>
            <Button variant="outline" className="mt-4" onClick={handleClearFilters}>
              Clear filters
            </Button>
          </div>
        ) : (
          <div className="py-16 flex flex-col items-center text-center">
            <p className="text-lg font-medium">No payments recorded</p>
            <p className="text-muted-foreground mt-2">
              Payments appear here once loans are active and payments are collected.
            </p>
          </div>
        )
      ) : (
        <>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Date</TableHead>
                <TableHead>Customer</TableHead>
                <TableHead>Loan Ref</TableHead>
                <TableHead>Amount</TableHead>
                <TableHead>Interest</TableHead>
                <TableHead>Principal</TableHead>
                <TableHead>Balance After</TableHead>
                {isAdmin && <TableHead className="w-12"></TableHead>}
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((row) => (
                <TableRow key={row.id}>
                  <TableCell>{formatDate(row.paymentDate)}</TableCell>
                  <TableCell>{row.customerName}</TableCell>
                  <TableCell>
                    <span className="text-xs font-mono">
                      LOAN-{row.loanId.slice(0, 8).toUpperCase()}
                    </span>
                  </TableCell>
                  <TableCell>UGX {formatNumberWithCommas(row.amount)}</TableCell>
                  <TableCell>
                    <span className="text-muted-foreground">
                      UGX {formatNumberWithCommas(row.interestPortion)}
                    </span>
                  </TableCell>
                  <TableCell>
                    <span className="text-muted-foreground">
                      UGX {formatNumberWithCommas(row.principalPortion)}
                    </span>
                  </TableCell>
                  <TableCell>
                    <span className="text-muted-foreground">
                      UGX {formatNumberWithCommas(row.principalBalanceAfter)}
                    </span>
                  </TableCell>
                  {isAdmin && (
                    <TableCell>
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button
                            variant="ghost"
                            className="h-8 w-8 p-0"
                            aria-label="Payment actions"
                          >
                            <MoreHorizontal className="h-4 w-4" />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          <DropdownMenuItem onClick={() => openEditSheet(row)}>
                            Edit
                          </DropdownMenuItem>
                          <DropdownMenuItem
                            variant="destructive"
                            onClick={() => openDeleteDialog(row)}
                          >
                            Delete
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </TableCell>
                  )}
                </TableRow>
              ))}
            </TableBody>
          </Table>

          {/* Pagination */}
          {total > pageSize && (
            <div className="flex items-center justify-between pt-4">
              <p className="text-sm text-muted-foreground">
                Showing {start}&ndash;{end} of {total} payments
              </p>
              <div className="flex gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  disabled={page === 1}
                  onClick={() => handlePageChange(page - 1)}
                >
                  Previous
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  disabled={page * pageSize >= total}
                  onClick={() => handlePageChange(page + 1)}
                >
                  Next
                </Button>
              </div>
            </div>
          )}
        </>
      )}

      {/* Edit Payment Sheet */}
      <Sheet open={editOpen} onOpenChange={setEditOpen}>
        <SheetContent side="right">
          <SheetHeader>
            <SheetTitle>Edit Payment</SheetTitle>
          </SheetHeader>
          <div className="flex flex-col gap-4 p-4">
            <div className="space-y-1.5">
              <Label htmlFor="edit-payment-date">Date</Label>
              <input
                id="edit-payment-date"
                type="date"
                className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
                value={editDate}
                onChange={(e) => setEditDate(e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="edit-payment-amount">Amount</Label>
              <div className="relative">
                <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-sm text-muted-foreground">
                  UGX
                </span>
                <Input
                  id="edit-payment-amount"
                  type="text"
                  inputMode="numeric"
                  className="pl-12"
                  value={editAmount}
                  onChange={(e) => setEditAmount(e.target.value)}
                />
              </div>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="edit-payment-reason">Reason for edit</Label>
              <Textarea
                id="edit-payment-reason"
                value={editReason}
                onChange={(e) => setEditReason(e.target.value)}
                placeholder="Explain why this payment is being edited..."
                required
              />
            </div>
          </div>
          <SheetFooter className="px-4">
            <Button
              onClick={handleEditSubmit}
              disabled={isEditPending || !editReason.trim()}
            >
              {isEditPending ? "Saving..." : "Save changes"}
            </Button>
          </SheetFooter>
        </SheetContent>
      </Sheet>

      {/* Delete Payment Dialog */}
      <Dialog open={deleteOpen} onOpenChange={setDeleteOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete payment?</DialogTitle>
            <DialogDescription>
              This payment and its cascade recalculations will be reversed. This cannot be undone.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-1.5">
            <Label htmlFor="delete-payment-reason">Reason for deletion</Label>
            <Textarea
              id="delete-payment-reason"
              value={deleteReason}
              onChange={(e) => setDeleteReason(e.target.value)}
              placeholder="Explain why this payment is being deleted..."
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteOpen(false)}>
              Keep payment
            </Button>
            <Button
              variant="destructive"
              disabled={!deleteReason.trim() || isDeletePending}
              onClick={handleDeleteSubmit}
            >
              {isDeletePending ? "Deleting..." : "Delete payment"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
