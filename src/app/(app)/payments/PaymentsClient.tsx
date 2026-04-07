"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import { useRouter, useSearchParams } from "next/navigation"
import { useMutation, useQueryClient } from "@tanstack/react-query"
import { toast } from "sonner"
import { AlertTriangle, Download, MoreHorizontal } from "lucide-react"
import { ResponsiveTable, type Column } from "@/components/ui/responsive-table"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { DrawerDialog, DrawerDialogContent } from "@/components/ui/drawer-dialog"
import {
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
import { editPaymentAction, deletePaymentAction, markPaymentWrongAction } from "@/actions/payment.actions"
import { InfoPopover } from "@/components/ui/info-popover"
import { PageHeader } from "@/components/ui/page-header"
import { useSession } from "@/lib/auth-client"
import { formatNumberWithCommas, formatDate } from "@/lib/utils"
import { ROLE_LEVELS, type UserRole, type PaymentWithCustomer } from "@/types"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { DailyCollectionsTab } from "./DailyCollectionsTab"
import { QuickRecordDialog } from "./QuickRecordDialog"
import { usePayments } from "@/hooks/use-payments"
import { queryKeys } from "@/hooks/query-keys"
import { FilterPanel } from "@/components/ui/filter-panel"

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

export function PaymentsClient() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const queryClient = useQueryClient()
  const { data: session } = useSession()

  const activeTab = (searchParams.get("tab") as "list" | "daily") ?? "list"

  function handleTabChange(tab: string) {
    const params = new URLSearchParams(searchParams.toString())
    params.set("tab", tab)
    if (tab === "daily") {
      params.delete("page")
      params.delete("customerName")
      params.delete("dateFrom")
      params.delete("dateTo")
      params.delete("amountMin")
      params.delete("amountMax")
    }
    if (tab === "list") {
      params.delete("date")
    }
    router.push(`/payments?${params.toString()}`)
  }

  const userRole = (session?.user?.role ?? "unassigned") as UserRole
  const isAdmin = ROLE_LEVELS[userRole] >= ROLE_LEVELS.admin
  const isSupervisor = ROLE_LEVELS[userRole] >= ROLE_LEVELS.supervisor

  const [quickRecordOpen, setQuickRecordOpen] = useState(false)

  // Filter state (initialized from URL search params)
  const [customerName, setCustomerName] = useState(searchParams.get("customerName") ?? "")
  const [dateFrom, setDateFrom] = useState(searchParams.get("dateFrom") ?? "")
  const [dateTo, setDateTo] = useState(searchParams.get("dateTo") ?? "")
  const [amountMin, setAmountMin] = useState(searchParams.get("amountMin") ?? "")
  const [amountMax, setAmountMax] = useState(searchParams.get("amountMax") ?? "")
  const [page, setPage] = useState(Number(searchParams.get("page") ?? 1))

  // Edit sheet state
  const [editOpen, setEditOpen] = useState(false)
  const [selectedPayment, setSelectedPayment] = useState<PaymentWithCustomer | null>(null)
  const [editAmount, setEditAmount] = useState("")
  const [editDate, setEditDate] = useState("")
  const [editReason, setEditReason] = useState("")

  // Delete dialog state
  const [deleteOpen, setDeleteOpen] = useState(false)
  const [deleteTarget, setDeleteTarget] = useState<PaymentWithCustomer | null>(null)
  const [deleteReason, setDeleteReason] = useState("")

  // Mark as wrong dialog state
  const [markWrongOpen, setMarkWrongOpen] = useState(false)
  const [markWrongTarget, setMarkWrongTarget] = useState<PaymentWithCustomer | null>(null)
  const [markWrongReason, setMarkWrongReason] = useState("")

  // Edit mutation with optimistic update
  const editMutation = useMutation({
    mutationFn: (input: { paymentId: string; amount?: string; paymentDate?: string; reason: string }) =>
      editPaymentAction(input),
    onMutate: async (input) => {
      await queryClient.cancelQueries({ queryKey: queryKeys.payments.all })

      const previousPayments = queryClient.getQueriesData<{ rows: PaymentWithCustomer[]; total: number }>(
        { queryKey: queryKeys.payments.all },
      )

      queryClient.setQueriesData<{ rows: PaymentWithCustomer[]; total: number }>(
        { queryKey: queryKeys.payments.all },
        (old) => {
          if (!old) return old
          return {
            ...old,
            rows: old.rows.map((p) =>
              p.id === input.paymentId
                ? {
                    ...p,
                    ...(input.amount != null ? { amount: input.amount } : {}),
                    ...(input.paymentDate != null ? { paymentDate: new Date(input.paymentDate) } : {}),
                  }
                : p,
            ),
          }
        },
      )

      return { previousPayments }
    },
    onError: (_err, _input, context) => {
      if (context?.previousPayments) {
        for (const [key, data] of context.previousPayments) {
          queryClient.setQueryData(key, data)
        }
      }
      toast.error("Failed to update payment")
    },
    onSuccess: (result, _input, context) => {
      if ("error" in result) {
        if (context?.previousPayments) {
          for (const [key, data] of context.previousPayments) {
            queryClient.setQueryData(key, data)
          }
        }
        toast.error(result.error ?? "Failed to update payment")
        return
      }
      toast.success("Payment updated")
      setEditOpen(false)
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.payments.all })
    },
  })

  // Delete mutation with optimistic update
  const deleteMutation = useMutation({
    mutationFn: (input: { paymentId: string; reason: string }) =>
      deletePaymentAction(input),
    onMutate: async (input) => {
      await queryClient.cancelQueries({ queryKey: queryKeys.payments.all })

      const previousPayments = queryClient.getQueriesData<{ rows: PaymentWithCustomer[]; total: number }>(
        { queryKey: queryKeys.payments.all },
      )

      queryClient.setQueriesData<{ rows: PaymentWithCustomer[]; total: number }>(
        { queryKey: queryKeys.payments.all },
        (old) => {
          if (!old) return old
          return {
            rows: old.rows.filter((p) => p.id !== input.paymentId),
            total: old.total - 1,
          }
        },
      )

      return { previousPayments }
    },
    onError: (_err, _input, context) => {
      if (context?.previousPayments) {
        for (const [key, data] of context.previousPayments) {
          queryClient.setQueryData(key, data)
        }
      }
      toast.error("Failed to delete payment")
    },
    onSuccess: (result, _input, context) => {
      if ("error" in result) {
        if (context?.previousPayments) {
          for (const [key, data] of context.previousPayments) {
            queryClient.setQueryData(key, data)
          }
        }
        toast.error("Failed to delete payment")
        return
      }
      toast.success("Payment deleted")
      setDeleteOpen(false)
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.payments.all })
    },
  })

  // Mark as wrong mutation
  const markWrongMutation = useMutation({
    mutationFn: (input: { paymentId: string; reason: string }) =>
      markPaymentWrongAction(input.paymentId, input.reason),
    onSuccess: (result) => {
      if ("error" in result) {
        toast.error(result.error ?? "Failed to mark payment as wrong")
        return
      }
      toast.success("Payment marked as wrong")
      setMarkWrongOpen(false)
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.payments.all })
    },
  })


  const debounceTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const hasFilters =
    customerName !== "" || dateFrom !== "" || dateTo !== "" || amountMin !== "" || amountMax !== ""

  const activeFilterCount = [
    customerName !== "",
    dateFrom !== "",
    dateTo !== "",
    amountMin !== "",
    amountMax !== "",
  ].filter(Boolean).length

  // TanStack Query for paginated data
  const filterParams = {
    dateFrom: dateFrom || undefined,
    dateTo: dateTo || undefined,
    amountMin: amountMin || undefined,
    amountMax: amountMax || undefined,
    customerName: customerName || undefined,
  }

  const { data, isLoading, isError } = usePayments(filterParams, page)

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
    editMutation.mutate({
      paymentId: selectedPayment.id,
      amount: editAmount || undefined,
      paymentDate: editDate || undefined,
      reason: editReason,
    })
  }

  function handleDeleteSubmit() {
    if (!deleteTarget) return
    deleteMutation.mutate({
      paymentId: deleteTarget.id,
      reason: deleteReason,
    })
  }

  function openMarkWrongDialog(payment: PaymentWithCustomer) {
    setMarkWrongTarget(payment)
    setMarkWrongReason("")
    setMarkWrongOpen(true)
  }

  function handleMarkWrongSubmit() {
    if (!markWrongTarget) return
    markWrongMutation.mutate({
      paymentId: markWrongTarget.id,
      reason: markWrongReason,
    })
  }

  const pageSize = 25
  const start = (page - 1) * pageSize + 1
  const end = Math.min(page * pageSize, total)

  const paymentColumns: Column<PaymentWithCustomer>[] = [
    {
      key: "customerName",
      header: "Customer",
      primary: true,
      render: (row) => row.customerName,
    },
    {
      key: "paymentDate",
      header: "Date",
      render: (row) => <span className="font-mono tabular-nums">{formatDate(row.paymentDate)}</span>,
    },
    {
      key: "loanRef",
      header: "Loan Ref",
      cardLabel: "Loan",
      render: (row) => (
        <span className="text-xs font-mono tabular-nums">
          LOAN-{row.loanId.slice(0, 8).toUpperCase()}
        </span>
      ),
    },
    {
      key: "amount",
      header: "Amount",
      align: "right",
      render: (row) => <>UGX {formatNumberWithCommas(row.amount)}</>,
    },
    {
      key: "interestPortion",
      header: (
        <span className="inline-flex items-center gap-1">
          Interest
          <InfoPopover>
            <p className="font-semibold text-sm mb-1">Interest Portion</p>
            <p className="text-xs text-muted-foreground mb-2">
              The part of this payment that covers accrued interest. Payments always cover interest first before reducing principal.
            </p>
            <p className="text-xs font-mono bg-muted rounded px-2 py-1 mb-2">
              Interest = Balance × (Monthly Rate ÷ 30) × Days
            </p>
          </InfoPopover>
        </span>
      ),
      align: "right",
      hideInCard: true,
      render: (row) => <span className="text-muted-foreground">UGX {formatNumberWithCommas(row.interestPortion)}</span>,
    },
    {
      key: "principalPortion",
      header: (
        <span className="inline-flex items-center gap-1">
          Principal
          <InfoPopover>
            <p className="font-semibold text-sm mb-1">Principal Portion</p>
            <p className="text-xs text-muted-foreground mb-2">
              The amount left over after interest is covered. This reduces the borrower&apos;s outstanding balance.
            </p>
            <p className="text-xs text-muted-foreground">
              If the payment is less than or equal to accrued interest, the principal portion will be zero.
            </p>
          </InfoPopover>
        </span>
      ),
      align: "right",
      hideInCard: true,
      render: (row) => <span className="text-muted-foreground">UGX {formatNumberWithCommas(row.principalPortion)}</span>,
    },
    {
      key: "balanceAfter",
      header: (
        <span className="inline-flex items-center gap-1">
          Balance After
          <InfoPopover>
            <p className="font-semibold text-sm mb-1">Balance After Payment</p>
            <p className="text-xs text-muted-foreground mb-2">
              The remaining principal balance on the loan after this payment was applied. When it reaches zero, the loan is fully paid.
            </p>
          </InfoPopover>
        </span>
      ),
      cardLabel: "Balance",
      align: "right",
      render: (row) => <span className="text-muted-foreground">UGX {formatNumberWithCommas(row.principalBalanceAfter)}</span>,
    },
    ...((isAdmin || isSupervisor) ? [{
      key: "actions",
      header: "",
      hideInCard: false,
      render: (row: PaymentWithCustomer) => (
        <DropdownMenu>
          <DropdownMenuTrigger
            aria-label="Payment actions"
            className="flex h-8 w-8 min-h-[44px] min-w-[44px] md:min-h-0 md:min-w-0 items-center justify-center rounded-md hover:bg-muted transition-colors"
          >
            <MoreHorizontal className="h-4 w-4" />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            {isAdmin && (
              <>
                <DropdownMenuItem onClick={() => openEditSheet(row)}>
                  Edit
                </DropdownMenuItem>
                <DropdownMenuItem
                  variant="destructive"
                  onClick={() => openDeleteDialog(row)}
                >
                  Delete
                </DropdownMenuItem>
              </>
            )}
            {isSupervisor && (
              <DropdownMenuItem onClick={() => openMarkWrongDialog(row)}>
                <AlertTriangle className="h-4 w-4 mr-2 text-amber-500" />
                Mark as Wrong
              </DropdownMenuItem>
            )}
          </DropdownMenuContent>
        </DropdownMenu>
      ),
    } satisfies Column<PaymentWithCustomer>] : []),
  ]

  return (
    <div className="space-y-4">
      {/* Page header */}
      <PageHeader title="Payments" subtitle="Payment history and collections">
        <Button onClick={() => setQuickRecordOpen(true)}>
          Record Payment
        </Button>
        {activeTab === "list" && (
          <Button
            variant="outline"
            disabled={rows.length === 0}
            onClick={() => exportToCsv(rows)}
          >
            <Download className="h-4 w-4 mr-2" />
            Export CSV
          </Button>
        )}
      </PageHeader>

      <Tabs value={activeTab} onValueChange={handleTabChange}>
        <TabsList>
          <TabsTrigger value="list">All Payments</TabsTrigger>
          <TabsTrigger value="daily">Daily</TabsTrigger>
        </TabsList>

        <TabsContent value="list">

      {/* Filter bar */}
      <FilterPanel label="Filters" activeCount={activeFilterCount}>
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
      </FilterPanel>

      {/* Content */}
      {isLoading ? (
        <div className="space-y-3">
          {[1, 2, 3, 4, 5].map((i) => (
            <div key={i} className="h-12 rounded-md bg-muted-foreground/10 animate-pulse" />
          ))}
        </div>
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
          <ResponsiveTable
            columns={paymentColumns}
            rows={rows}
            getRowKey={(row) => row.id}
            getRowProps={() => ({ "data-testid": "data-row" })}
          />

          {/* Pagination */}
          {total > pageSize && (
            <div className="flex items-center justify-between pt-4">
              <p className="text-sm text-muted-foreground">
                Showing <span className="font-mono tabular-nums">{start}&ndash;{end}</span> of <span className="font-mono tabular-nums">{total}</span> payments
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

        </TabsContent>

        <TabsContent value="daily">
          <DailyCollectionsTab />
        </TabsContent>

      </Tabs>

      {/* Edit Payment Sheet */}
      <DrawerDialog open={editOpen} onOpenChange={setEditOpen}>
        <DrawerDialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>Edit Payment</DialogTitle>
          </DialogHeader>
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
          <DialogFooter>
            <Button
              onClick={handleEditSubmit}
              disabled={editMutation.isPending || !editReason.trim()}
            >
              {editMutation.isPending ? "Saving..." : "Save changes"}
            </Button>
          </DialogFooter>
        </DrawerDialogContent>
      </DrawerDialog>

      {/* Delete Payment Dialog */}
      <DrawerDialog open={deleteOpen} onOpenChange={setDeleteOpen}>
        <DrawerDialogContent>
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
              disabled={!deleteReason.trim() || deleteMutation.isPending}
              onClick={handleDeleteSubmit}
            >
              {deleteMutation.isPending ? "Deleting..." : "Delete payment"}
            </Button>
          </DialogFooter>
        </DrawerDialogContent>
      </DrawerDialog>

      {/* Mark as Wrong Dialog */}
      <DrawerDialog open={markWrongOpen} onOpenChange={setMarkWrongOpen}>
        <DrawerDialogContent>
          <DialogHeader>
            <DialogTitle>Mark payment as wrong?</DialogTitle>
            <DialogDescription>
              This flags the payment as incorrectly recorded. It does not delete or reverse the payment.
            </DialogDescription>
          </DialogHeader>
          {markWrongTarget && (
            <div className="rounded-lg border p-3 text-sm space-y-1 mb-2">
              <div className="flex justify-between">
                <span className="text-muted-foreground">Customer</span>
                <span className="font-medium">{markWrongTarget.customerName}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Amount</span>
                <span className="font-mono tabular-nums">UGX {formatNumberWithCommas(markWrongTarget.amount)}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Date</span>
                <span>{formatDate(markWrongTarget.paymentDate)}</span>
              </div>
            </div>
          )}
          <div className="space-y-1.5">
            <Label htmlFor="mark-wrong-reason">Reason</Label>
            <Textarea
              id="mark-wrong-reason"
              value={markWrongReason}
              onChange={(e) => setMarkWrongReason(e.target.value)}
              placeholder="Explain why this payment is wrong..."
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setMarkWrongOpen(false)}>
              Cancel
            </Button>
            <Button
              variant="default"
              disabled={!markWrongReason.trim() || markWrongMutation.isPending}
              onClick={handleMarkWrongSubmit}
            >
              {markWrongMutation.isPending ? "Marking..." : "Mark as Wrong"}
            </Button>
          </DialogFooter>
        </DrawerDialogContent>
      </DrawerDialog>

      {/* Quick Record Payment Dialog */}
      <QuickRecordDialog open={quickRecordOpen} onOpenChange={setQuickRecordOpen} />
    </div>
  )
}
