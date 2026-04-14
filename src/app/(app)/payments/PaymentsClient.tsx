"use client"

import { useMemo, useState, useTransition } from "react"
import Link from "next/link"
import { useRouter, useSearchParams } from "next/navigation"
import { useLiveQuery } from "@tanstack/react-db"
import { paymentCollection, updatePaymentWithInput } from "@/collections"
import { toast } from "sonner"
import { AlertTriangle, Download, MoreHorizontal } from "lucide-react"
import { PaymentReceiptButton } from "@/components/receipts/payment-receipt-button"
import { ResponsiveTable, type Column } from "@/components/ui/responsive-table"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
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
import { markPaymentWrongAction } from "@/actions/payment.actions"
import { InfoPopover } from "@/components/ui/info-popover"
import { PageHeader } from "@/components/ui/page-header"
import { useSession } from "@/lib/auth-client"
import { formatNumberWithCommas, formatDate, shortId } from "@/lib/utils"
import type { PaymentWithCustomer } from "@/types"
import { usePermissions } from "@/hooks/use-permissions"
import { usePaymentsPageStore } from "@/lib/stores/payments-page"
import { useUrlFilters } from "@/hooks/use-url-filters"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { DailyCollectionsTab } from "./DailyCollectionsTab"
import { QuickRecordDialog } from "./QuickRecordDialog"
import { FilterPanel } from "@/components/ui/filter-panel"
import { downloadBlob } from "@/lib/download"

function exportToCsv(rows: PaymentWithCustomer[]) {
  const headers = ["Date", "Customer", "Amount", "Interest", "Principal", "Principal Balance"]
  const csvLines = [
    headers.join(","),
    ...rows.map((r) => [
      `"${formatDate(r.paymentDate)}"`,
      `"${r.customerName}"`,
      r.amount,
      r.interestPortion,
      r.principalPortion,
      r.principalBalanceAfter,
    ].join(","))
  ]
  const blob = new Blob([csvLines.join("\n")], { type: "text/csv" })
  downloadBlob(blob, `payments-${new Date().toISOString().slice(0, 10)}.csv`)
}

export function PaymentsClient() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const { data: session } = useSession()
  const [isEditPending, setIsEditPending] = useState(false)
  const [isMarkWrongPending, startMarkWrongTransition] = useTransition()

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

  const { has } = usePermissions()
  const isAdmin = has("payment:edit-any")
  const isSupervisor = has("payment:edit-any")

  const {
    quickRecordOpen, openQuickRecord, closeQuickRecord,
    editOpen, editTarget: selectedPayment, editAmount, editDate, editReason,
    openEdit: openEditSheet, closeEdit, setEditAmount, setEditDate, setEditReason,
    markWrongOpen, markWrongTarget, markWrongReason,
    openMarkWrong: openMarkWrongDialog, closeMarkWrong, setMarkWrongReason,
  } = usePaymentsPageStore()

  const { filters, page, setFilter, clearFilters, setPage, hasFilters, activeFilterCount } =
    useUrlFilters({
      basePath: "/payments",
      defaults: { customerName: "", dateFrom: "", dateTo: "", amountMin: "", amountMax: "" },
    })
  const { customerName, dateFrom, dateTo, amountMin, amountMax } = filters

  // Edit and markWrong — collection-based update and server action respectively


  const pageSize = 25

  // TanStack DB live query for all payments
  const { data: allPayments, isLoading } = useLiveQuery((q) =>
    q.from({ p: paymentCollection }).select(({ p }) => p)
  )

  // Client-side filtering
  const filtered = useMemo(() => {
    let result = allPayments ?? []
    if (customerName) {
      const term = customerName.toLowerCase()
      result = result.filter((p) => p.customerName.toLowerCase().includes(term))
    }
    if (dateFrom) {
      const from = new Date(dateFrom)
      result = result.filter((p) => new Date(p.paymentDate) >= from)
    }
    if (dateTo) {
      const to = new Date(dateTo)
      result = result.filter((p) => new Date(p.paymentDate) <= to)
    }
    if (amountMin) {
      const min = parseFloat(amountMin)
      if (!isNaN(min)) result = result.filter((p) => parseFloat(p.amount) >= min)
    }
    if (amountMax) {
      const max = parseFloat(amountMax)
      if (!isNaN(max)) result = result.filter((p) => parseFloat(p.amount) <= max)
    }
    return result
  }, [allPayments, customerName, dateFrom, dateTo, amountMin, amountMax])

  const total = filtered.length
  const rows = filtered.slice((page - 1) * pageSize, page * pageSize)
  const isError = false

  function handleEditSubmit() {
    if (!selectedPayment) return
    try {
      setIsEditPending(true)
      const input = {
        paymentId: selectedPayment.id,
        amount: editAmount || undefined,
        paymentDate: editDate || undefined,
        reason: editReason,
      }
      updatePaymentWithInput(selectedPayment.id, input, (draft) => {
        if (editAmount) draft.amount = editAmount
        if (editDate) draft.paymentDate = new Date(editDate) as unknown as typeof draft.paymentDate
      })
      toast.success("Payment updated")
      closeEdit()
    } catch {
      toast.error("Failed to update payment")
    } finally {
      setIsEditPending(false)
    }
  }

  function handleMarkWrongSubmit() {
    if (!markWrongTarget) return
    startMarkWrongTransition(async () => {
      const result = await markPaymentWrongAction(markWrongTarget.id, markWrongReason)
      if ("error" in result) {
        toast.error(result.error ?? "Failed to mark payment as wrong")
        return
      }
      toast.success("Payment marked as wrong")
      closeMarkWrong()
    })
  }

  const start = (page - 1) * pageSize + 1
  const end = Math.min(page * pageSize, total)

  const paymentColumns: Column<PaymentWithCustomer>[] = [
    {
      key: "customerName",
      header: "Customer",
      primary: true,
      render: (row) => (
        <Link
          href={`/customers/${row.customerId}`}
          className="font-medium hover:underline"
          onClick={(e) => e.stopPropagation()}
        >
          {row.customerName}
        </Link>
      ),
    },
    {
      key: "paymentDate",
      header: "Date",
      render: (row) => <span className="font-mono tabular-nums">{formatDate(row.paymentDate)}</span>,
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
              The part of this payment that covers accrued interest. Interest is always deducted first before any principal reduction.
            </p>
            <p className="text-xs font-mono bg-muted rounded px-2 py-1">
              Interest Owed = Balance &times; (Rate &divide; 30) &times; Days Since Last Payment
            </p>
          </InfoPopover>
        </span>
      ),
      align: "right",
      render: (row) => <>UGX {formatNumberWithCommas(row.interestPortion)}</>,
    },
    {
      key: "principalPortion",
      header: (
        <span className="inline-flex items-center gap-1">
          Principal
          <InfoPopover>
            <p className="font-semibold text-sm mb-1">Principal Portion</p>
            <p className="text-xs text-muted-foreground mb-2">
              The part of this payment that reduces the outstanding loan balance. Only applied after all accrued interest is covered.
            </p>
            <p className="text-xs font-mono bg-muted rounded px-2 py-1">
              Principal Portion = Payment Amount &minus; Interest Portion
            </p>
          </InfoPopover>
        </span>
      ),
      align: "right",
      render: (row) => <>UGX {formatNumberWithCommas(row.principalPortion)}</>,
    },
    {
      key: "principalBalanceAfter",
      header: (
        <span className="inline-flex items-center gap-1">
          Principal Balance
          <InfoPopover>
            <p className="font-semibold text-sm mb-1">Principal Balance</p>
            <p className="text-xs text-muted-foreground">
              The remaining principal balance on the loan after this payment was applied. When this reaches zero, the loan is fully paid.
            </p>
          </InfoPopover>
        </span>
      ),
      align: "right",
      render: (row) => <>UGX {formatNumberWithCommas(row.principalBalanceAfter)}</>,
    },
    {
      key: "receipt",
      header: "",
      hideInCard: true,
      render: (row: PaymentWithCustomer) => (
        <PaymentReceiptButton
          data={{
            paymentDate: row.paymentDate,
            customerName: row.customerName,
            loanReference: `LOAN-${shortId(row.loanId).toUpperCase()}`,
            amountPaid: row.amount,
            interestPortion: row.interestPortion,
            principalPortion: row.principalPortion,
            balanceAfter: row.principalBalanceAfter,
            outstandingBalance: row.outstandingBalance,
            depositLocation: row.depositLocation,
            officerName: row.recorderName,
          }}
        />
      ),
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
              <DropdownMenuItem onClick={() => openEditSheet(row)}>
                Edit
              </DropdownMenuItem>
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
        <Button onClick={openQuickRecord}>
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
              onChange={(e) => setFilter("customerName", e.target.value)}
              className="w-[220px]"
            />
          </div>
          <div>
            <Label className="text-sm">From</Label>
            <input
              type="date"
              className="h-8 w-[160px] rounded-md border border-input bg-background px-3 text-sm"
              value={dateFrom}
              onChange={(e) => setFilter("dateFrom", e.target.value)}
            />
          </div>
          <div>
            <Label className="text-sm">To</Label>
            <input
              type="date"
              className="h-8 w-[160px] rounded-md border border-input bg-background px-3 text-sm"
              value={dateTo}
              onChange={(e) => setFilter("dateTo", e.target.value)}
            />
          </div>
          <div>
            <Label className="text-sm">Min amount</Label>
            <Input
              type="text"
              inputMode="numeric"
              className="w-[120px]"
              value={amountMin}
              onChange={(e) => setFilter("amountMin", e.target.value)}
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
              onChange={(e) => setFilter("amountMax", e.target.value)}
              placeholder="Any"
            />
          </div>
          {hasFilters && (
            <Button
              variant="ghost"
              size="sm"
              className="text-muted-foreground"
              onClick={clearFilters}
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
            <Button variant="outline" className="mt-4" onClick={clearFilters}>
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
        <div className="transition-opacity">
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
                  onClick={() => setPage(page - 1)}
                >
                  Previous
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  disabled={page * pageSize >= total}
                  onClick={() => setPage(page + 1)}
                >
                  Next
                </Button>
              </div>
            </div>
          )}
        </div>
      )}

        </TabsContent>

        <TabsContent value="daily">
          <DailyCollectionsTab />
        </TabsContent>

      </Tabs>

      {/* Edit Payment Sheet */}
      <DrawerDialog open={editOpen} onOpenChange={(v) => { if (!v) closeEdit() }}>
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
                maxLength={2500}
                placeholder="Explain why this payment is being edited..."
                required
              />
            </div>
          </div>
          <DialogFooter>
            <Button
              onClick={handleEditSubmit}
              disabled={isEditPending || !editReason.trim()}
            >
              {isEditPending ? "Saving..." : "Save changes"}
            </Button>
          </DialogFooter>
        </DrawerDialogContent>
      </DrawerDialog>

      {/* Mark as Wrong Dialog */}
      <DrawerDialog open={markWrongOpen} onOpenChange={(v) => { if (!v) closeMarkWrong() }}>
        <DrawerDialogContent>
          <DialogHeader>
            <DialogTitle>
              <span className="inline-flex items-center gap-1.5">
                Mark payment as wrong?
                <InfoPopover>
                  <p className="font-semibold text-sm mb-1">Mark as Wrong vs Delete</p>
                  <p className="text-xs text-muted-foreground mb-2">
                    <strong>Mark as Wrong</strong> reverses this payment&apos;s ledger entries and flags it for review, but keeps the record visible for audit purposes. The loan balance is recalculated as if this payment never happened.
                  </p>
                  <p className="text-xs text-muted-foreground">
                    <strong>Delete</strong> (Admin only) permanently removes the payment record entirely.
                  </p>
                </InfoPopover>
              </span>
            </DialogTitle>
            <DialogDescription>
              This reverses the payment&apos;s effect on the loan balance and flags it for review. The record is kept for audit purposes.
            </DialogDescription>
          </DialogHeader>
          {markWrongTarget && (
            <Card className="mb-2">
              <CardContent className="p-3 text-sm space-y-1">
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
              </CardContent>
            </Card>
          )}
          <div className="space-y-1.5">
            <Label htmlFor="mark-wrong-reason">Reason</Label>
            <Textarea
              id="mark-wrong-reason"
              value={markWrongReason}
              onChange={(e) => setMarkWrongReason(e.target.value)}
              maxLength={2500}
              placeholder="Explain why this payment is wrong..."
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={closeMarkWrong}>
              Cancel
            </Button>
            <Button
              variant="default"
              disabled={!markWrongReason.trim() || isMarkWrongPending}
              onClick={handleMarkWrongSubmit}
            >
              {isMarkWrongPending ? "Marking..." : "Mark as Wrong"}
            </Button>
          </DialogFooter>
        </DrawerDialogContent>
      </DrawerDialog>

      {/* Quick Record Payment Dialog */}
      <QuickRecordDialog open={quickRecordOpen} onOpenChange={(v) => v ? openQuickRecord() : closeQuickRecord()} />
    </div>
  )
}
