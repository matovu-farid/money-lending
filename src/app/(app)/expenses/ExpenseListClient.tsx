"use client"

import { useEffect, useState, useTransition } from "react"
import { useMutation } from "@tanstack/react-query"
import { toast } from "sonner"
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
import { formatNumberWithCommas, stripCommas, formatDate } from "@/lib/utils"
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


function formatAmount(amount: string): string {
  const num = parseFloat(amount)
  return `UGX ${num.toLocaleString("en-UG", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}

export function ExpenseListClient({ transactions: initialTransactions, categories: initialCategories }: ExpenseListClientProps) {
  const [isSheetOpen, setIsSheetOpen] = useState(false)
  const [deleteTarget, setDeleteTarget] = useState<string | null>(null)
  const [isAddCategoryOpen, setIsAddCategoryOpen] = useState(false)
  const [newCategoryName, setNewCategoryName] = useState("")
  const [categories, setCategories] = useState<Category[]>(initialCategories)
  const [localTransactions, setLocalTransactions] = useState<Transaction[]>(initialTransactions)
  const [_isCategoryPending, startCategoryTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)

  // Sync with server data when revalidation brings new props
  useEffect(() => {
    setLocalTransactions(initialTransactions)
  }, [initialTransactions])

  useEffect(() => {
    setCategories(initialCategories)
  }, [initialCategories])

  // Form state
  const [formDate, setFormDate] = useState("")
  const [formCategoryId, setFormCategoryId] = useState("")
  const [formAmount, setFormAmount] = useState("")
  const [formNotes, setFormNotes] = useState("")

  function resetForm() {
    setFormDate("")
    setFormCategoryId("")
    setFormAmount("")
    setFormNotes("")
    setError(null)
  }

  const addMutation = useMutation({
    mutationFn: (input: CreateExpenseInput) => recordExpenseAction(input),
    onMutate: async (input) => {
      const category = categories.find((c) => c.id === input.categoryId)
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
      const previous = [...localTransactions]
      setLocalTransactions((prev) => [optimistic, ...prev])
      return { previous, optimisticId: optimistic.id }
    },
    onError: (_err, _input, context) => {
      if (context?.previous) setLocalTransactions(context.previous)
      toast.error("Failed to record expense")
    },
    onSuccess: (_result, _input, context) => {
      // Remove the optimistic row — page revalidation will bring in the real data
      if (context?.optimisticId) {
        setLocalTransactions((prev) =>
          prev.filter((t) => t.id !== context.optimisticId)
        )
      }
      toast.success("Expense recorded")
      setIsSheetOpen(false)
      resetForm()
    },
  })

  const deleteMutation = useMutation({
    mutationFn: (transactionId: string) => deleteExpenseAction(transactionId),
    onMutate: async (transactionId) => {
      const previous = [...localTransactions]
      setLocalTransactions((prev) => prev.filter((t) => t.id !== transactionId))
      setDeleteTarget(null)
      return { previous }
    },
    onError: (_err, _id, context) => {
      if (context?.previous) setLocalTransactions(context.previous)
      toast.error("Failed to delete expense")
    },
    onSuccess: () => {
      toast.success("Expense deleted")
    },
  })

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!formDate || !formCategoryId || !formAmount) {
      setError("Date, category, and amount are required.")
      return
    }
    const input: CreateExpenseInput = {
      categoryId: formCategoryId,
      amount: formAmount,
      transactionDate: formDate,
      notes: formNotes || undefined,
    }
    addMutation.mutate(input)
  }

  async function handleDelete() {
    if (!deleteTarget) return
    deleteMutation.mutate(deleteTarget)
  }

  async function handleAddCategory() {
    if (!newCategoryName.trim()) return
    startCategoryTransition(async () => {
      try {
        const created = await createExpenseCategoryAction({ name: newCategoryName.trim(), type: "expense" })
        const newCat: Category = {
          id: created.id,
          name: created.name,
          type: created.type,
          isDefault: created.isDefault,
        }
        setCategories((prev) => [...prev, newCat])
        setNewCategoryName("")
        setIsAddCategoryOpen(false)
      } catch {
        setError("Failed to add category.")
      }
    })
  }

  return (
    <TooltipProvider>
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">Expenses</h1>
            <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mt-1">Business expenditure tracking</p>
          </div>
          <Button
            onClick={() => { resetForm(); setIsSheetOpen(true) }}
            disabled={addMutation.isPending}
          >
            Add Expense
          </Button>
        </div>

        {localTransactions.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 gap-4 text-center">
            <p className="text-lg font-medium">No expenses recorded</p>
            <p className="text-muted-foreground">
              Record your first expense to start tracking outflows.
            </p>
            <Button
              onClick={() => { resetForm(); setIsSheetOpen(true) }}
              disabled={addMutation.isPending}
            >
              Add Expense
            </Button>
          </div>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Date</TableHead>
                <TableHead>Category</TableHead>
                <TableHead className="text-right">Amount</TableHead>
                <TableHead>Notes</TableHead>
                <TableHead></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {localTransactions.map((tx) => (
                <TableRow
                  key={tx.id}
                  data-testid="data-row"
                  className={tx.isOptimistic ? "opacity-50" : ""}
                >
                  <TableCell className="font-mono tabular-nums">{formatDate(tx.transactionDate)}</TableCell>
                  <TableCell>{tx.categoryName}</TableCell>
                  <TableCell className="text-right font-mono tabular-nums">{formatAmount(tx.amount)}</TableCell>
                  <TableCell className="text-muted-foreground">{tx.description ?? "—"}</TableCell>
                  <TableCell>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="text-destructive hover:text-destructive"
                      onClick={() => setDeleteTarget(tx.id)}
                      disabled={
                        tx.isOptimistic ||
                        deleteMutation.isPending ||
                        (deleteMutation.variables === tx.id && deleteMutation.isPending)
                      }
                    >
                      Delete
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}

        {/* Add Expense Sheet */}
        <Sheet open={isSheetOpen} onOpenChange={(open) => { setIsSheetOpen(open); if (!open) resetForm() }}>
          <SheetContent side="right">
            <SheetHeader>
              <SheetTitle>Add Expense</SheetTitle>
            </SheetHeader>
            <form onSubmit={handleSubmit} className="flex flex-col gap-4 p-4">
              <div className="space-y-1.5">
                <Label htmlFor="expense-date">Date</Label>
                <Input
                  id="expense-date"
                  type="date"
                  value={formDate}
                  onChange={(e) => setFormDate(e.target.value)}
                  required
                />
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="expense-category">Category</Label>
                <Select value={formCategoryId} onValueChange={(value) => { if (value !== null) setFormCategoryId(value) }}>
                  <SelectTrigger id="expense-category" className="w-full">
                    <SelectValue placeholder="Select category" />
                  </SelectTrigger>
                  <SelectContent>
                    {categories.map((cat) => (
                      <SelectItem key={cat.id} value={cat.id}>
                        {cat.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
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

              <div className="space-y-1.5">
                <Label htmlFor="expense-amount">Amount</Label>
                <div className="relative">
                  <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-sm text-muted-foreground">
                    UGX
                  </span>
                  <Input
                    id="expense-amount"
                    type="text"
                    inputMode="numeric"
                    className="pl-12"
                    value={formatNumberWithCommas(formAmount)}
                    onChange={(e) => setFormAmount(stripCommas(e.target.value).replace(/[^0-9.]/g, ""))}
                    required
                  />
                </div>
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="expense-notes">Notes (optional)</Label>
                <Textarea
                  id="expense-notes"
                  value={formNotes}
                  onChange={(e) => setFormNotes(e.target.value)}
                  placeholder="Add any notes..."
                  rows={3}
                />
              </div>

              {error && <p className="text-sm text-destructive">{error}</p>}

              <SheetFooter>
                <Button type="submit" disabled={addMutation.isPending} className="w-full">
                  {addMutation.isPending ? "Saving..." : "Record Expense"}
                </Button>
              </SheetFooter>
            </form>
          </SheetContent>
        </Sheet>

        {/* Delete Confirmation Dialog */}
        <Dialog open={deleteTarget !== null} onOpenChange={(open) => { if (!open) setDeleteTarget(null) }}>
          <DialogContent>
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
          </DialogContent>
        </Dialog>
      </div>
    </TooltipProvider>
  )
}
