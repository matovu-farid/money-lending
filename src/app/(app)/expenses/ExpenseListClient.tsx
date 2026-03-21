"use client"

import { useState, useTransition } from "react"
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
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip"
import {
  recordExpenseAction,
  deleteExpenseAction,
  createExpenseCategoryAction,
  deleteExpenseCategoryAction,
} from "./actions"
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

function formatDate(date: Date): string {
  const d = new Date(date)
  const day = String(d.getDate()).padStart(2, "0")
  const month = String(d.getMonth() + 1).padStart(2, "0")
  const year = d.getFullYear()
  return `${day}/${month}/${year}`
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
  const [transactions, setTransactions] = useState<Transaction[]>(initialTransactions)
  const [isPending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)

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
    startTransition(async () => {
      try {
        await recordExpenseAction(input)
        setIsSheetOpen(false)
        resetForm()
        // Refresh by reloading page data
        window.location.reload()
      } catch {
        setError("Failed to record expense. Please try again.")
      }
    })
  }

  async function handleDelete() {
    if (!deleteTarget) return
    startTransition(async () => {
      try {
        await deleteExpenseAction(deleteTarget)
        setDeleteTarget(null)
        window.location.reload()
      } catch {
        setError("Failed to delete expense. Please try again.")
      }
    })
  }

  async function handleAddCategory() {
    if (!newCategoryName.trim()) return
    startTransition(async () => {
      try {
        await createExpenseCategoryAction({ name: newCategoryName.trim(), type: "expense" })
        setNewCategoryName("")
        setIsAddCategoryOpen(false)
        window.location.reload()
      } catch {
        setError("Failed to add category.")
      }
    })
  }

  return (
    <TooltipProvider>
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <h1 className="text-2xl font-semibold">Expenses</h1>
          <Button onClick={() => { resetForm(); setIsSheetOpen(true) }}>
            Add Expense
          </Button>
        </div>

        {transactions.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 gap-4 text-center">
            <p className="text-lg font-medium">No expenses recorded</p>
            <p className="text-muted-foreground">
              Record your first expense to start tracking outflows.
            </p>
            <Button onClick={() => { resetForm(); setIsSheetOpen(true) }}>
              Add Expense
            </Button>
          </div>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Date</TableHead>
                <TableHead>Category</TableHead>
                <TableHead>Amount</TableHead>
                <TableHead>Notes</TableHead>
                <TableHead></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {transactions.map((tx) => (
                <TableRow key={tx.id}>
                  <TableCell>{formatDate(tx.transactionDate)}</TableCell>
                  <TableCell>{tx.categoryName}</TableCell>
                  <TableCell>{formatAmount(tx.amount)}</TableCell>
                  <TableCell className="text-muted-foreground">{tx.description ?? "—"}</TableCell>
                  <TableCell>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="text-destructive hover:text-destructive"
                      onClick={() => setDeleteTarget(tx.id)}
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
                        disabled={!newCategoryName.trim() || isPending}
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
                    type="number"
                    min="0"
                    step="0.01"
                    className="pl-12"
                    value={formAmount}
                    onChange={(e) => setFormAmount(e.target.value)}
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
                <Button type="submit" disabled={isPending} className="w-full">
                  {isPending ? "Saving..." : "Record Expense"}
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
                disabled={isPending}
              >
                Keep expense
              </Button>
              <Button
                variant="destructive"
                onClick={handleDelete}
                disabled={isPending}
              >
                {isPending ? "Deleting..." : "Delete expense"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>
    </TooltipProvider>
  )
}
