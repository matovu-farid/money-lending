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
import {
  TooltipProvider,
} from "@/components/ui/tooltip"
import {
  recordExpenseAction,
  deleteExpenseAction,
  createExpenseCategoryAction,
} from "./actions"
import { MoneyInput } from "@/components/ui/money-input"
import { formatDate, formatCurrency } from "@/lib/utils"
import { PageHeader } from "@/components/ui/page-header"
import { queryKeys } from "@/hooks/query-keys"
import type { CreateExpenseInput } from "@/types"

type Transaction = {
  id: string
  type: string
  amount: string
  categoryId: string
  categoryName: string
  description: string | null
  transactionDate: Date
  recordedBy: string
  referenceType: string | null
  referenceId: string | null
  createdAt: Date
  isOptimistic?: boolean
}

type Category = {
  id: string
  name: string
  type: string
  isDefault: boolean
}

interface ExpenseListClientProps {
  transactions: Transaction[]
  categories: Category[]
}

type ExpenseFormValues = {
  date: string
  categoryId: string
  amount: string
  notes: string
}

export function ExpenseListClient({ transactions: initialTransactions, categories: initialCategories }: ExpenseListClientProps) {
  const queryClient = useQueryClient()
  const [isSheetOpen, setIsSheetOpen] = useState(false)
  const [deleteTarget, setDeleteTarget] = useState<string | null>(null)
  const [isAddCategoryOpen, setIsAddCategoryOpen] = useState(false)
  const [newCategoryName, setNewCategoryName] = useState("")
  const [optimisticTransactions, setOptimisticTransactions] = useState<Transaction[]>([])
  const [removedTransactionIds, setRemovedTransactionIds] = useState<Set<string>>(new Set())
  const [optimisticCategories, setOptimisticCategories] = useState<Category[]>([])
  const [location, setLocation] = useState<"cash" | "bank" | "strong_room">("cash")
  const [_isCategoryPending, startCategoryTransition] = useTransition()

  const {
    register,
    handleSubmit,
    setValue,
    watch,
    reset,
    control,
    formState: { errors },
  } = useForm<ExpenseFormValues>({
    defaultValues: {
      date: "",
      categoryId: "",
      amount: "",
      notes: "",
    },
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
    mutationFn: (input: CreateExpenseInput) => recordExpenseAction(input),
    onMutate: async (input) => {
      const category = displayedCategories.find((c) => c.id === input.categoryId)
      const optimistic: Transaction = {
        id: `optimistic-${Date.now()}`,
        type: "debit",
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
      toast.error("Failed to record expense")
    },
    onSuccess: (result, _input, context) => {
      if (context?.optimisticId) {
        setOptimisticTransactions((prev) => prev.filter((t) => t.id !== context.optimisticId))
      }
      if (result && "error" in result) {
        toast.error(result.error)
        return
      }
      toast.success("Expense recorded")
      setIsSheetOpen(false)
      reset()
      setLocation("cash")
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.expenses.all })
      queryClient.invalidateQueries({ queryKey: queryKeys.dashboard.all })
    },
  })

  const deleteMutation = useMutation({
    mutationFn: (transactionId: string) => deleteExpenseAction(transactionId),
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
      toast.error("Failed to delete expense")
    },
    onSuccess: () => {
      toast.success("Expense deleted")
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.expenses.all })
      queryClient.invalidateQueries({ queryKey: queryKeys.dashboard.all })
    },
  })

  function onFormSubmit(data: ExpenseFormValues) {
    const input: CreateExpenseInput = {
      categoryId: data.categoryId,
      amount: data.amount,
      transactionDate: data.date,
      notes: data.notes || undefined,
      location,
    }
    addMutation.mutate(input)
  }

  function handleDelete() {
    if (!deleteTarget) return
    deleteMutation.mutate(deleteTarget)
  }

  function handleAddCategory() {
    if (!newCategoryName.trim()) return
    startCategoryTransition(async () => {
      try {
        const created = await createExpenseCategoryAction({ name: newCategoryName.trim(), type: "expense" })
        if ("error" in created) {
          toast.error(created.error)
          return
        }
        const newCat: Category = {
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
        <PageHeader title="Expenses" subtitle="Business expenditure tracking">
          <Button
            onClick={() => { reset(); setIsSheetOpen(true) }}
            disabled={addMutation.isPending}
          >
            Add Expense
          </Button>
        </PageHeader>

        <ResponsiveTable<Transaction>
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
              <p className="text-lg font-medium">No expenses recorded</p>
              <p className="text-muted-foreground">
                Record your first expense to start tracking outflows.
              </p>
              <Button
                onClick={() => { reset(); setIsSheetOpen(true) }}
                disabled={addMutation.isPending}
              >
                Add Expense
              </Button>
            </div>
          }
        />

        <DrawerDialog open={isSheetOpen} onOpenChange={(open) => { setIsSheetOpen(open); if (!open) { reset(); setLocation("cash") } }}>
          <DrawerDialogContent className="sm:max-w-sm">
            <DialogHeader>
              <DialogTitle>Add Expense</DialogTitle>
            </DialogHeader>
            <form onSubmit={handleSubmit(onFormSubmit)} className="flex flex-col gap-4 p-4">
              <div className="space-y-1.5">
                <Label htmlFor="expense-date">Date</Label>
                <Input
                  id="expense-date"
                  type="date"
                  {...register("date", { required: "Date is required" })}
                />
                {errors.date && <p className="text-sm text-destructive">{errors.date.message}</p>}
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="expense-category">Category</Label>
                <Select
                  value={watchedCategoryId}
                  onValueChange={(value) => { if (value !== null) setValue("categoryId", value, { shouldValidate: true }) }}
                >
                  <SelectTrigger id="expense-category" className="w-full">
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
                      <Label htmlFor="new-category-name">New category name</Label>
                      <Input
                        id="new-category-name"
                        value={newCategoryName}
                        onChange={(e) => setNewCategoryName(e.target.value)}
                        placeholder="e.g. Utilities"
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
                id="expense-amount"
              />

              <div className="space-y-1.5">
                <Label htmlFor="expense-notes">Notes (optional)</Label>
                <Textarea
                  id="expense-notes"
                  {...register("notes")}
                  placeholder="Add any notes..."
                  rows={3}
                />
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="expense-location">Source Location</Label>
                <Select value={location} onValueChange={(v) => setLocation(v as "cash" | "bank" | "strong_room")}>
                  <SelectTrigger id="expense-location" className="w-full">
                    <SelectValue placeholder="Source location" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="cash">Cash on Hand</SelectItem>
                    <SelectItem value="bank">Bank</SelectItem>
                    <SelectItem value="strong_room">Strong Room</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              {errors.root && <p className="text-sm text-destructive">{errors.root.message}</p>}

              <DialogFooter>
                <Button type="submit" disabled={addMutation.isPending} className="w-full">
                  {addMutation.isPending ? "Saving..." : "Record Expense"}
                </Button>
              </DialogFooter>
            </form>
          </DrawerDialogContent>
        </DrawerDialog>

        <DrawerDialog open={deleteTarget !== null} onOpenChange={(open) => { if (!open) setDeleteTarget(null) }}>
          <DrawerDialogContent>
            <DialogHeader>
              <DialogTitle>Delete expense?</DialogTitle>
              <DialogDescription>
                This expense entry will be permanently removed. This cannot be undone.
              </DialogDescription>
            </DialogHeader>
            <DialogFooter>
              <Button
                variant="outline"
                onClick={() => setDeleteTarget(null)}
                disabled={deleteMutation.isPending}
              >
                Keep expense
              </Button>
              <Button
                variant="destructive"
                onClick={handleDelete}
                disabled={deleteMutation.isPending}
              >
                {deleteMutation.isPending ? "Deleting..." : "Delete expense"}
              </Button>
            </DialogFooter>
          </DrawerDialogContent>
        </DrawerDialog>
      </div>
    </TooltipProvider>
  )
}
