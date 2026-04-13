"use client"

import { useMemo, useRef, useState, useTransition } from "react"
import { useForm } from "react-hook-form"
import { useMutation, useQueryClient } from "@tanstack/react-query"
import { toast } from "sonner"
import { ResponsiveTable } from "@/components/ui/responsive-table"
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
import { TooltipProvider } from "@/components/ui/tooltip"
import { MoneyInput } from "@/components/ui/money-input"
import { DepositLocationSelect } from "@/components/ui/deposit-location-select"
import { formatDate, formatCurrency, todayDateString } from "@/lib/utils"
import { PageHeader } from "@/components/ui/page-header"
import type { CreateCategoryInput, CreateTransactionInput, TransactionRow, CategoryRow, DepositLocation } from "@/types"

interface TransactionFormValues {
  date: string
  categoryId: string
  amount: string
  notes: string
  backdateNote: string
  location: DepositLocation
}

interface TransactionListClientProps {
  transactions: TransactionRow[]
  categories: CategoryRow[]
  /** "income" or "expense" — drives labels and optimistic transaction type */
  variant: "income" | "expense"
  /** Server action to record a transaction */
  recordAction: (input: CreateTransactionInput) => Promise<Record<string, unknown>>
  /** Server action to delete a transaction */
  deleteAction: (id: string) => Promise<Record<string, unknown>>
  /** Server action to create a category */
  createCategoryAction: (input: CreateCategoryInput) => Promise<
    { error: string } | { data: { id: string; name: string; type: string; isDefault: boolean; [key: string]: unknown } }
  >
  /** Query keys to invalidate on mutation */
  invalidateKeys: readonly (readonly unknown[])[]
}

const LABELS = {
  income: {
    title: "Income",
    subtitle: "Revenue and other income",
    addButton: "Add Income",
    recordButton: "Record Income",
    emptyTitle: "No income recorded",
    emptyDescription: "Record your first income entry to start tracking inflows.",
    deleteTitle: "Delete income entry?",
    deleteDescription: "This income entry will be permanently removed. This cannot be undone.",
    keepButton: "Keep entry",
    deleteButton: "Delete entry",
    successRecord: "Income recorded",
    successDelete: "Income deleted",
    failRecord: "Failed to record income",
    failDelete: "Failed to delete income",
    txType: "credit" as const,
    categoryType: "revenue",
    categoryPlaceholder: "e.g. Rental Income",
  },
  expense: {
    title: "Expenses",
    subtitle: "Business expenditure tracking",
    addButton: "Add Expense",
    recordButton: "Record Expense",
    emptyTitle: "No expenses recorded",
    emptyDescription: "Record your first expense to start tracking outflows.",
    deleteTitle: "Delete expense?",
    deleteDescription: "This expense entry will be permanently removed. This cannot be undone.",
    keepButton: "Keep expense",
    deleteButton: "Delete expense",
    successRecord: "Expense recorded",
    successDelete: "Expense deleted",
    failRecord: "Failed to record expense",
    failDelete: "Failed to delete expense",
    txType: "debit" as const,
    categoryType: "expense",
    categoryPlaceholder: "e.g. Utilities",
  },
} as const

export function TransactionListClient({
  transactions: initialTransactions,
  categories: initialCategories,
  variant,
  recordAction,
  deleteAction,
  createCategoryAction,
  invalidateKeys,
}: TransactionListClientProps) {
  const queryClient = useQueryClient()
  const labels = LABELS[variant]
  const idPrefix = variant === "income" ? "income" : "expense"

  const [isSheetOpen, setIsSheetOpen] = useState(false)
  const [deleteTarget, setDeleteTarget] = useState<string | null>(null)
  const [optimisticTransactions, setOptimisticTransactions] = useState<TransactionRow[]>([])
  const [removedTransactionIds, setRemovedTransactionIds] = useState<Set<string>>(new Set())
  const [optimisticCategories, setOptimisticCategories] = useState<CategoryRow[]>([])
  const [_isCategoryPending, startCategoryTransition] = useTransition()

  // Category combobox state
  const [categoryQuery, setCategoryQuery] = useState("")
  const [categoryDropdownOpen, setCategoryDropdownOpen] = useState(false)
  const categoryInputRef = useRef<HTMLInputElement>(null)

  const {
    register,
    handleSubmit,
    setValue,
    watch,
    reset,
    control,
    formState: { errors },
  } = useForm<TransactionFormValues>({
    defaultValues: { date: "", categoryId: "", amount: "", notes: "", backdateNote: "", location: "cash" as DepositLocation },
  })

  const watchedCategoryId = watch("categoryId")
  const watchedDate = watch("date")

  const displayedTransactions = useMemo(() => {
    const filtered = initialTransactions.filter(t => !removedTransactionIds.has(t.id))
    return [...optimisticTransactions, ...filtered]
  }, [initialTransactions, optimisticTransactions, removedTransactionIds])

  const displayedCategories = useMemo(
    () => [...initialCategories, ...optimisticCategories],
    [initialCategories, optimisticCategories],
  )

  // Compute backdating info
  const backdateDays = useMemo(() => {
    if (!watchedDate) return 0
    const selected = new Date(watchedDate)
    const today = new Date()
    selected.setHours(0, 0, 0, 0)
    today.setHours(0, 0, 0, 0)
    return Math.round((today.getTime() - selected.getTime()) / (1000 * 60 * 60 * 24))
  }, [watchedDate])
  const isBackdated = backdateDays > 0

  // Filtered categories for combobox
  const filteredCategories = useMemo(() => {
    if (!categoryQuery.trim()) return displayedCategories
    const q = categoryQuery.toLowerCase()
    return displayedCategories.filter((c) => c.name.toLowerCase().includes(q))
  }, [displayedCategories, categoryQuery])

  const exactMatchExists = useMemo(() => {
    const q = categoryQuery.trim().toLowerCase()
    return q !== "" && displayedCategories.some((c) => c.name.toLowerCase() === q)
  }, [displayedCategories, categoryQuery])

  // The name shown in the category input
  const selectedCategoryName = useMemo(() => {
    if (!watchedCategoryId) return ""
    return displayedCategories.find((c) => c.id === watchedCategoryId)?.name ?? ""
  }, [watchedCategoryId, displayedCategories])

  const addMutation = useMutation({
    mutationFn: (input: CreateTransactionInput) => recordAction(input),
    onMutate: async (input) => {
      const category = displayedCategories.find((c) => c.id === input.categoryId)
      const optimistic: TransactionRow= {
        id: `optimistic-${Date.now()}`,
        type: labels.txType,
        amount: input.amount,
        categoryId: input.categoryId,
        categoryName: category?.name ?? "Unknown",
        description: input.notes ?? null,
        transactionDate: new Date(input.transactionDate),
        recordedBy: "",
        referenceType: null,
        referenceId: null,
        createdAt: new Date().toISOString() as unknown as Date,
        isOptimistic: true,
      }
      setOptimisticTransactions((prev) => [optimistic, ...prev])
      return { optimisticId: optimistic.id }
    },
    onError: (_err, _input, context) => {
      if (context?.optimisticId) {
        setOptimisticTransactions((prev) => prev.filter((t) => t.id !== context.optimisticId))
      }
      toast.error(labels.failRecord)
    },
    onSuccess: (result, _input, context) => {
      if (context?.optimisticId) {
        setOptimisticTransactions((prev) => prev.filter((t) => t.id !== context.optimisticId))
      }
      if (result && "error" in result) {
        toast.error((result as { error: string }).error)
        return
      }
      toast.success(labels.successRecord)
      setIsSheetOpen(false)
      reset()
      setCategoryQuery("")
    },
    onSettled: () => {
      for (const key of invalidateKeys) {
        queryClient.invalidateQueries({ queryKey: key })
      }
    },
  })

  const deleteMutation = useMutation({
    mutationFn: (transactionId: string) => deleteAction(transactionId),
    onMutate: async (transactionId) => {
      setRemovedTransactionIds((prev) => new Set(prev).add(transactionId))
      setDeleteTarget(null)
      return { transactionId }
    },
    onError: (_err, _id, context) => {
      if (context?.transactionId) {
        setRemovedTransactionIds((prev) => {
          const next = new Set(prev)
          next.delete(context.transactionId)
          return next
        })
      }
      toast.error(labels.failDelete)
    },
    onSuccess: () => {
      toast.success(labels.successDelete)
    },
    onSettled: () => {
      for (const key of invalidateKeys) {
        queryClient.invalidateQueries({ queryKey: key })
      }
    },
  })

  function onFormSubmit(data: TransactionFormValues) {
    addMutation.mutate({
      categoryId: data.categoryId,
      amount: data.amount,
      transactionDate: data.date,
      notes: data.notes || undefined,
      location: data.location,
      backdateNote: data.backdateNote?.trim() || undefined,
    })
  }

  function handleDelete() {
    if (!deleteTarget) return
    deleteMutation.mutate(deleteTarget)
  }

  function handleSelectCategory(cat: CategoryRow) {
    setValue("categoryId", cat.id, { shouldValidate: true })
    setCategoryQuery("")
    setCategoryDropdownOpen(false)
  }

  function handleCreateAndSelectCategory(name: string) {
    startCategoryTransition(async () => {
      try {
        const created = await createCategoryAction({ name: name.trim(), type: labels.categoryType as CreateCategoryInput["type"] })
        if ("error" in created) {
          toast.error(created.error)
          return
        }
        const newCat: CategoryRow = {
          id: created.data.id,
          name: created.data.name,
          type: created.data.type,
          isDefault: created.data.isDefault,
        }
        setOptimisticCategories((prev) => [...prev, newCat])
        setValue("categoryId", newCat.id, { shouldValidate: true })
        setCategoryQuery("")
        setCategoryDropdownOpen(false)
      } catch {
        toast.error("Failed to add category.")
      }
    })
  }

  return (
    <TooltipProvider>
      <div className="space-y-4">
        <PageHeader title={labels.title} subtitle={labels.subtitle}>
          <Button
            onClick={() => { reset(); setIsSheetOpen(true) }}
            disabled={addMutation.isPending}
          >
            {labels.addButton}
          </Button>
        </PageHeader>

        <ResponsiveTable<TransactionRow>
          columns={[
            {
              key: "date",
              header: "Date",
              render: (tx) => <span className="font-mono tabular-nums">{formatDate(tx.transactionDate)}</span>,
            },
            {
              key: "category",
              header: "Category",
              primary: true,
              render: (tx) => tx.categoryName,
            },
            {
              key: "amount",
              header: "Amount",
              align: "right",
              render: (tx) => formatCurrency(tx.amount),
            },
            {
              key: "notes",
              header: "Notes",
              hideInCard: true,
              render: (tx) => <span className="text-muted-foreground">{tx.description ?? "\u2014"}</span>,
            },
            {
              key: "actions",
              header: "",
              hideInCard: false,
              render: (tx) => (
                <Button
                  variant="ghost"
                  size="sm"
                  className="text-destructive hover:text-destructive"
                  onClick={() => setDeleteTarget(tx.id)}
                  disabled={tx.isOptimistic || deleteMutation.isPending}
                >
                  Delete
                </Button>
              ),
            },
          ]}
          rows={displayedTransactions}
          getRowKey={(tx) => tx.id}
          getRowProps={(tx) => ({
            "data-testid": "data-row",
            className: tx.isOptimistic ? "opacity-50" : "",
          })}
          emptyState={
            <div className="flex flex-col items-center justify-center py-16 gap-4 text-center">
              <p className="text-lg font-medium">{labels.emptyTitle}</p>
              <p className="text-muted-foreground">{labels.emptyDescription}</p>
              <Button
                onClick={() => { reset(); setIsSheetOpen(true) }}
                disabled={addMutation.isPending}
              >
                {labels.addButton}
              </Button>
            </div>
          }
        />

        {/* Add Form Dialog */}
        <DrawerDialog open={isSheetOpen} onOpenChange={(open) => { setIsSheetOpen(open); if (!open) { reset(); setCategoryQuery("") } }}>
          <DrawerDialogContent className="sm:max-w-sm">
            <DialogHeader>
              <DialogTitle>{labels.addButton}</DialogTitle>
            </DialogHeader>
            <form onSubmit={handleSubmit(onFormSubmit)} className="flex flex-col gap-4 p-4">
              <div className="space-y-1.5">
                <Label htmlFor={`${idPrefix}-date`}>Date</Label>
                <Input
                  id={`${idPrefix}-date`}
                  type="date"
                  max={todayDateString()}
                  {...register("date", { required: "Date is required" })}
                />
                {errors.date && <p className="text-sm text-destructive">{errors.date.message}</p>}
              </div>

              {isBackdated && (
                <div className="rounded-lg border border-amber-300 bg-amber-50 p-3 space-y-2">
                  <p className="text-sm text-amber-800">
                    This entry is backdated by <strong>{backdateDays} day{backdateDays > 1 ? "s" : ""}</strong>.
                    {backdateDays > 3 && " Supervisor permission required."}
                  </p>
                  <div className="space-y-1">
                    <Label htmlFor={`${idPrefix}-backdateNote`} className="font-semibold text-sm">Backdate Reason</Label>
                    <textarea
                      id={`${idPrefix}-backdateNote`}
                      className="w-full rounded-lg border border-input bg-transparent px-3 py-2 text-sm outline-none focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:border-ring min-h-[60px] resize-y"
                      placeholder="Explain why this entry is being backdated..."
                      maxLength={500}
                      {...register("backdateNote", {
                        validate: (v) => {
                          if (!watchedDate) return true
                          const sel = new Date(watchedDate)
                          const now = new Date()
                          sel.setHours(0, 0, 0, 0)
                          now.setHours(0, 0, 0, 0)
                          if (sel < now && !v?.trim()) return "A reason is required when backdating"
                          return true
                        },
                      })}
                    />
                    {errors.backdateNote && (
                      <p className="text-sm text-destructive">{errors.backdateNote.message}</p>
                    )}
                  </div>
                </div>
              )}

              <div className="space-y-1.5">
                <Label htmlFor={`${idPrefix}-category`}>Category</Label>
                <div className="relative">
                  <Input
                    ref={categoryInputRef}
                    id={`${idPrefix}-category`}
                    autoComplete="off"
                    placeholder={watchedCategoryId ? selectedCategoryName : labels.categoryPlaceholder}
                    value={categoryDropdownOpen ? categoryQuery : selectedCategoryName}
                    onChange={(e) => {
                      setCategoryQuery(e.target.value)
                      setCategoryDropdownOpen(true)
                      // Clear selection when user starts typing something new
                      if (watchedCategoryId && e.target.value !== selectedCategoryName) {
                        setValue("categoryId", "", { shouldValidate: false })
                      }
                    }}
                    onFocus={() => setCategoryDropdownOpen(true)}
                    onBlur={() => {
                      // Delay so click on dropdown item registers first
                      setTimeout(() => {
                        setCategoryDropdownOpen(false)
                        // If nothing selected, revert query
                        if (!watchedCategoryId) setCategoryQuery("")
                      }, 150)
                    }}
                  />
                  {watchedCategoryId && !categoryDropdownOpen && (
                    <button
                      type="button"
                      className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground text-xs"
                      onClick={() => {
                        setValue("categoryId", "", { shouldValidate: false })
                        setCategoryQuery("")
                        categoryInputRef.current?.focus()
                      }}
                    >
                      &times;
                    </button>
                  )}
                  {categoryDropdownOpen && (
                    <div
                      className="absolute left-0 right-0 z-[9999] mt-1 max-h-48 overflow-y-auto rounded-lg border bg-popover text-popover-foreground shadow-md"
                      onMouseDown={(e) => e.preventDefault()}
                    >
                      {filteredCategories.length > 0 ? (
                        <ul className="py-1">
                          {filteredCategories.map((cat) => (
                            <li key={cat.id}>
                              <button
                                type="button"
                                className="w-full text-left px-3 py-2 text-sm hover:bg-muted transition-colors"
                                onClick={() => handleSelectCategory(cat)}
                              >
                                {cat.name}
                              </button>
                            </li>
                          ))}
                        </ul>
                      ) : categoryQuery.trim() && !exactMatchExists ? (
                        <button
                          type="button"
                          className="w-full text-left px-3 py-2 text-sm text-primary hover:bg-muted transition-colors"
                          onClick={() => handleCreateAndSelectCategory(categoryQuery)}
                          disabled={_isCategoryPending}
                        >
                          {_isCategoryPending ? "Creating..." : `+ Create "${categoryQuery.trim()}"`}
                        </button>
                      ) : (
                        <p className="px-3 py-2 text-sm text-muted-foreground">No categories found</p>
                      )}
                    </div>
                  )}
                </div>
                <input
                  type="hidden"
                  {...register("categoryId", { required: "Category is required" })}
                />
                {errors.categoryId && <p className="text-sm text-destructive">{errors.categoryId.message}</p>}
              </div>

              <MoneyInput
                name="amount"
                control={control}
                label="Amount"
                required="Amount is required"
                id={`${idPrefix}-amount`}
              />

              <div className="space-y-1.5">
                <Label htmlFor={`${idPrefix}-notes`}>Notes (optional)</Label>
                <Textarea
                  id={`${idPrefix}-notes`}
                  {...register("notes")}
                  placeholder="Add any notes..."
                  maxLength={2500}
                  rows={3}
                />
              </div>

              <DepositLocationSelect
                name="location"
                control={control}
                id={`${idPrefix}-location`}
              />

              {errors.root && <p className="text-sm text-destructive">{errors.root.message}</p>}

              <DialogFooter>
                <Button type="submit" disabled={addMutation.isPending} className="w-full">
                  {addMutation.isPending ? "Saving..." : labels.recordButton}
                </Button>
              </DialogFooter>
            </form>
          </DrawerDialogContent>
        </DrawerDialog>

        {/* Delete Confirmation */}
        <DrawerDialog open={deleteTarget !== null} onOpenChange={(open) => { if (!open) setDeleteTarget(null) }}>
          <DrawerDialogContent>
            <DialogHeader>
              <DialogTitle>{labels.deleteTitle}</DialogTitle>
              <DialogDescription>{labels.deleteDescription}</DialogDescription>
            </DialogHeader>
            <DialogFooter>
              <Button
                variant="outline"
                onClick={() => setDeleteTarget(null)}
                disabled={deleteMutation.isPending}
              >
                {labels.keepButton}
              </Button>
              <Button
                variant="destructive"
                onClick={handleDelete}
                disabled={deleteMutation.isPending}
              >
                {deleteMutation.isPending ? "Deleting..." : labels.deleteButton}
              </Button>
            </DialogFooter>
          </DrawerDialogContent>
        </DrawerDialog>
      </div>
    </TooltipProvider>
  )
}
