"use client"

import { useMemo, useState, useTransition } from "react"
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover"
import { TooltipProvider } from "@/components/ui/tooltip"
import { MoneyInput } from "@/components/ui/money-input"
import { formatDate, formatCurrency } from "@/lib/utils"
import { PageHeader } from "@/components/ui/page-header"
import { DEPOSIT_LOCATION_OPTIONS } from "@/lib/constants"
import type { CreateCategoryInput, CreateTransactionInput, TransactionRow, CategoryRow, DepositLocation } from "@/types"

interface TransactionFormValues {
  date: string
  categoryId: string
  amount: string
  notes: string
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
  const [isAddCategoryOpen, setIsAddCategoryOpen] = useState(false)
  const [newCategoryName, setNewCategoryName] = useState("")
  const [optimisticTransactions, setOptimisticTransactions] = useState<TransactionRow[]>([])
  const [removedTransactionIds, setRemovedTransactionIds] = useState<Set<string>>(new Set())
  const [optimisticCategories, setOptimisticCategories] = useState<CategoryRow[]>([])
  const [location, setLocation] = useState<DepositLocation>("cash")
  const [_isCategoryPending, startCategoryTransition] = useTransition()

  const {
    register,
    handleSubmit,
    setValue,
    watch,
    reset,
    control,
    formState: { errors },
  } = useForm<TransactionFormValues>({
    defaultValues: { date: "", categoryId: "", amount: "", notes: "" },
  })

  const watchedCategoryId = watch("categoryId")

  const displayedTransactions = useMemo(() => {
    const filtered = initialTransactions.filter(t => !removedTransactionIds.has(t.id))
    return [...optimisticTransactions, ...filtered]
  }, [initialTransactions, optimisticTransactions, removedTransactionIds])

  const displayedCategories = useMemo(
    () => [...initialCategories, ...optimisticCategories],
    [initialCategories, optimisticCategories],
  )

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
      setLocation("cash")
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
      location,
    })
  }

  function handleDelete() {
    if (!deleteTarget) return
    deleteMutation.mutate(deleteTarget)
  }

  function handleAddCategory() {
    if (!newCategoryName.trim()) return
    startCategoryTransition(async () => {
      try {
        const created = await createCategoryAction({ name: newCategoryName.trim(), type: labels.categoryType as CreateCategoryInput["type"] })
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
        setNewCategoryName("")
        setIsAddCategoryOpen(false)
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
        <DrawerDialog open={isSheetOpen} onOpenChange={(open) => { setIsSheetOpen(open); if (!open) { reset(); setLocation("cash") } }}>
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
                  {...register("date", { required: "Date is required" })}
                />
                {errors.date && <p className="text-sm text-destructive">{errors.date.message}</p>}
              </div>

              <div className="space-y-1.5">
                <Label htmlFor={`${idPrefix}-category`}>Category</Label>
                <Select
                  value={watchedCategoryId}
                  onValueChange={(value) => { if (value !== null) setValue("categoryId", value, { shouldValidate: true }) }}
                >
                  <SelectTrigger id={`${idPrefix}-category`} className="w-full">
                    <SelectValue placeholder="Select category" />
                  </SelectTrigger>
                  <SelectContent>
                    {displayedCategories.map((cat) => (
                      <SelectItem key={cat.id} value={cat.id}>
                        {cat.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <input
                  type="hidden"
                  {...register("categoryId", { required: "Category is required" })}
                />
                {errors.categoryId && <p className="text-sm text-destructive">{errors.categoryId.message}</p>}
                <Popover open={isAddCategoryOpen} onOpenChange={setIsAddCategoryOpen}>
                  <PopoverTrigger
                    render={
                      <button
                        type="button"
                        className="text-sm text-primary underline-offset-4 hover:underline"
                      />
                    }
                  >
                    + Add Category
                  </PopoverTrigger>
                  <PopoverContent side="bottom" align="start">
                    <div className="flex flex-col gap-2">
                      <Label htmlFor={`new-${idPrefix}-category-name`}>New category name</Label>
                      <Input
                        id={`new-${idPrefix}-category-name`}
                        value={newCategoryName}
                        onChange={(e) => setNewCategoryName(e.target.value)}
                        placeholder={labels.categoryPlaceholder}
                      />
                      <Button
                        type="button"
                        size="sm"
                        onClick={handleAddCategory}
                        disabled={!newCategoryName.trim() || _isCategoryPending}
                      >
                        Add
                      </Button>
                    </div>
                  </PopoverContent>
                </Popover>
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

              <div className="space-y-1.5">
                <Label htmlFor={`${idPrefix}-location`}>Source Location</Label>
                <Select value={location} onValueChange={(v) => setLocation(v as DepositLocation)}>
                  <SelectTrigger id={`${idPrefix}-location`} className="w-full">
                    <SelectValue placeholder="Source location" />
                  </SelectTrigger>
                  <SelectContent>
                    {DEPOSIT_LOCATION_OPTIONS.map((opt) => (
                      <SelectItem key={opt.value} value={opt.value}>{opt.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

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
